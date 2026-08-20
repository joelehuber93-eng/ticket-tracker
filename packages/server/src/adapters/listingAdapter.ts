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
  return text
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Matches a product name against listing entries: exact match on normalized
 * text first, then falls back to a substring match in either direction (e.g.
 * our "SIX" vs. their "SIX (The Trogdon Brothers)").
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
  return partial ?? null;
}
