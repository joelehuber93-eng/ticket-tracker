import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { HTML_FETCH_HEADERS, parsePriceFromText } from "./types";

const FETCH_TIMEOUT_MS = 10000;

export interface ListingConfig {
  /** CSS selector for each show's "card" container on the listing page. */
  card: string;
  /**
   * Where to read the show's name from, relative to a card. Either a CSS
   * selector (text content is used) or, for markup that puts the value in
   * an attribute instead of text (e.g. data-prod-name="..."), one of:
   *   "@attr"        - read `attr` off the card element itself
   *   "selector@attr" - read `attr` off the first element matching selector
   */
  name: string;
  /** Same lookup rules as `name`, but for the show's price. */
  price: string;
}

export interface ListingEntry {
  name: string;
  price: number;
}

export interface ListingResult {
  ok: boolean;
  entries: ListingEntry[];
  error: string | null;
}

export function parseListingConfig(raw: string): ListingConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.card === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.price === "string"
    ) {
      return parsed as ListingConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts every (name, price) entry from already-fetched listing-page HTML,
 * one per "card" element. Shared by both fetchListing (plain HTTP fetch) and
 * the "browser" adapter (headless-browser render) — same card/name/price
 * config, same matching, the only difference is how the HTML was obtained.
 */
export function parseListingEntries(html: string, config: ListingConfig): ListingEntry[] {
  const $ = cheerio.load(html);
  const entries: ListingEntry[] = [];

  $(config.card).each((_i, card) => {
    const name = extractField($, card, config.name).trim();
    const priceText = extractField($, card, config.price);
    const price = parsePriceFromText(priceText);
    if (name && price != null) {
      entries.push({ name, price });
    }
  });

  return entries;
}

/**
 * Fetches a page that lists many shows at once (e.g. a competitor's "/shows/"
 * page) and extracts every (name, price) pair on it, one per "card" element.
 * Fetched once per check cycle regardless of how many of our products are
 * linked to this site — see priceChecker, which groups "listing" sites and
 * calls this once, then matches each linked product by name.
 */
export async function fetchListing(url: string, config: ListingConfig): Promise<ListingResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: HTML_FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, entries: [], error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const entries = parseListingEntries(html, config);

    if (entries.length === 0) {
      return { ok: false, entries: [], error: "No cards matched — check card/name/price selectors" };
    }
    return { ok: true, entries, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, entries: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolves a `name`/`price` field lookup (see ListingConfig) against one card. */
function extractField($: cheerio.CheerioAPI, card: AnyNode, field: string): string {
  if (field.startsWith("@")) {
    return $(card).attr(field.slice(1)) ?? "";
  }
  const at = field.lastIndexOf("@");
  if (at > 0) {
    const selector = field.slice(0, at);
    const attr = field.slice(at + 1);
    return $(card).find(selector).first().attr(attr) ?? "";
  }
  return $(card).find(field).first().text();
}

function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      // Strip a possessive "'s" as a whole unit (not just the apostrophe) —
      // otherwise "Wagner's" normalizes to "wagners", which no longer
      // substring-matches our own "Wagner", breaking an otherwise-identical
      // show name over a single stray letter.
      .replace(/['’]s\b/g, "")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

const STOPWORDS = new Set(["a", "an", "and", "of", "the"]);

/** Words used for fuzzy token-overlap matching — same as normalize(), plus
 * dropping short connector words that don't help disambiguate one show from
 * another (and, in practice, are exactly where two otherwise-identical show
 * names tend to diverge: "Dinner & Show" vs "Dinner and Show"). */
function significantWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

/** Fraction of the shorter name's significant words found in the other. */
function tokenOverlapScore(a: string, b: string): number {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);
  const overlap = shorter.filter((w) => longerSet.has(w)).length;
  return overlap / shorter.length;
}

const FUZZY_MATCH_THRESHOLD = 0.8;

/**
 * Matches a product name against listing entries: exact match on normalized
 * text first, then a substring match in either direction (e.g. our "SIX" vs.
 * their "SIX (The Trogdon Brothers)"), then a fuzzy word-overlap fallback for
 * the same show listed with reordered, inserted, or dropped words (e.g. our
 * "Hits on Route 66 The Heatherlys" vs. a competitor's "The Heatherlys Hits
 * on Route 66", or our "Hughes Music Show" vs. "Hughes Brothers Music Show").
 *
 * The 80% overlap threshold is deliberately strict — it's what lets it catch
 * genuine reorderings/insertions while still rejecting a different show in
 * the same family (e.g. "Hughes Brothers Music Show" only shares 2 of our
 * 3 words with "Hughes Brothers Christmas Show", so it's correctly rejected
 * rather than cross-matched to the wrong variant).
 */
export function matchListingEntry(productName: string, entries: ListingEntry[]): ListingEntry | null {
  const target = normalize(productName);
  if (!target) return null;

  const exact = entries.find((e) => normalize(e.name) === target);
  if (exact) return exact;

  const partial = entries.find((e) => {
    const candidate = normalize(e.name);
    return candidate.includes(target) || target.includes(candidate);
  });
  if (partial) return partial;

  let best: ListingEntry | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    const score = tokenOverlapScore(productName, entry.name);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= FUZZY_MATCH_THRESHOLD ? best : null;
}

/**
 * Same as matchListingEntry, but falls through to try each of `aliases` (in
 * order) if the primary name doesn't match — see nameAliases.ts for when
 * and why a manual alias gets added.
 */
export function matchListingEntryWithAliases(
  productName: string,
  aliases: string[],
  entries: ListingEntry[]
): ListingEntry | null {
  for (const name of [productName, ...aliases]) {
    const hit = matchListingEntry(name, entries);
    if (hit) return hit;
  }
  return null;
}
