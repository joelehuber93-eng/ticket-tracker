import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { parsePriceFromText } from "./types";
import { launchStealthContext, NAV_TIMEOUT_MS } from "./stealthBrowser";

export interface CheckoutConfig {
  /**
   * Selector for a clickable date/time link on the base show page (the first
   * match is used — assumed to be the earliest available date). Its `href`
   * leads to the dated ticket page that actually carries the ticket row; the
   * base show page only shows a date picker, not ticket selection itself.
   */
  dateLinkSelector: string;
  /** Attribute on a dateLinkSelector match holding its date, e.g. "data-date" -> "2026-08-29 20:00:00" (date, then time). Used to pick a specific date when one is requested. */
  dateAttribute: string;
  /** Selector for a ticket-type row on the dated ticket page (the first match is used — usually "ADULT"). */
  ticketRowSelector: string;
  /** Selector, relative to the ticket row, for the "+" quantity button — clicked `quantity` times. */
  incrementButtonSelector: string;
  /** Selector, relative to the ticket row, for the quantity `<input>` — read back to confirm clicks landed. */
  quantityInputSelector: string;
  /** Page-level selector for the "add to cart" button. */
  addToCartButtonSelector: string;
  /** Visible text used to disambiguate the add-to-cart button from other buttons matching the selector. */
  addToCartButtonText: string;
  /** Path (relative to the show URL's origin) to load after adding, to read the order summary. */
  cartPath: string;
  /** Selector scoping the order-summary block on the cart page. */
  orderSummarySelector: string;
  /** Substring identifying the row with the all-in total, e.g. "Cart Total". */
  totalLabel: string;
  /** Substring identifying the row with taxes/fees, e.g. "Taxes and Conv. Fees Total". */
  feesLabel: string;
}

// Selectors below are built from real markup pasted by the operator on
// 2026-08-24/25 (date picker, show page, cart page, and the cart page's
// order-summary block) for ibranson.com's Hughes Music Show. The order-
// summary block lives on the cart page itself (its form posts back to
// /cart/?changed=1) — reaching it doesn't require stepping into an actual
// payment page. "a[data-date]" is the one confirmed date-link element; if
// other unrelated links on the show page ever carry a data-date attribute
// too, this will need to get more specific (e.g. scoped to a calendar
// container class).
export const IBRANSON_CHECKOUT_CONFIG: CheckoutConfig = {
  dateLinkSelector: "a[data-date]",
  dateAttribute: "data-date",
  ticketRowSelector: ".order-container-row",
  incrementButtonSelector: ".js-input-factor.ib-plus",
  quantityInputSelector: "input.js-default-rate",
  addToCartButtonSelector: "button.btn-loading-need",
  addToCartButtonText: "Add to cart",
  cartPath: "/cart/",
  orderSummarySelector: ".order-resume",
  totalLabel: "Cart Total",
  feesLabel: "Taxes and Conv. Fees Total",
};

const CHECKOUT_CONFIG_KEYS: (keyof CheckoutConfig)[] = [
  "dateLinkSelector",
  "dateAttribute",
  "ticketRowSelector",
  "incrementButtonSelector",
  "quantityInputSelector",
  "addToCartButtonSelector",
  "addToCartButtonText",
  "cartPath",
  "orderSummarySelector",
  "totalLabel",
  "feesLabel",
];

/** Parses a CompetitorSite.checkoutSelector JSON string into a CheckoutConfig, or null if invalid/incomplete. */
export function parseCheckoutConfig(raw: string): CheckoutConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const key of CHECKOUT_CONFIG_KEYS) {
      if (typeof (parsed as Record<string, unknown>)[key] !== "string") return null;
    }
    return parsed as CheckoutConfig;
  } catch {
    return null;
  }
}

export interface CheckoutQuoteResult {
  ok: boolean;
  /** The showtime date actually used ("YYYY-MM-DD"), whether requested or auto-picked as the earliest available. Null only on failure before a date was resolved. */
  date: string | null;
  subtotal: number | null;
  taxesFees: number | null;
  total: number | null;
  currency: string;
  error: string | null;
}

const MAX_QUANTITY = 20;

/**
 * Drives a real add-to-cart -> cart checkout flow for `quantity` tickets and
 * reads back the all-in total (plus its subtotal/taxes-fees breakdown) from
 * the cart page's order summary, instead of the "starting at" rate shown on
 * a listing page. Manually triggered (see routes/checkoutQuotes.ts) — not
 * part of the regular cron price-check cycle, since a multi-step checkout
 * run per quantity is much heavier than a listing scrape.
 *
 * `showUrl` is the base show page (no date), e.g.
 * "https://ibranson.com/shows-in-branson-missouri/hughes-music-show/". If
 * `targetDate` ("YYYY-MM-DD") is given, only that date's showtime is used —
 * failing clearly (with the dates that ARE available) if it's not offered.
 * Left undefined, the earliest available date/time is picked automatically.
 */
export async function fetchCheckoutTotal(
  showUrl: string,
  quantity: number,
  config: CheckoutConfig = IBRANSON_CHECKOUT_CONFIG,
  targetDate?: string
): Promise<CheckoutQuoteResult> {
  const failure = (error: string, date: string | null = null): CheckoutQuoteResult => ({
    ok: false,
    date,
    subtotal: null,
    taxesFees: null,
    total: null,
    currency: "USD",
    error,
  });

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return failure(`Quantity must be a whole number between 1 and ${MAX_QUANTITY}`);
  }

  let browser;
  try {
    const launched = await launchStealthContext();
    browser = launched.browser;
    const page = await launched.context.newPage();

    // "networkidle" (no network activity for 500ms) is unreliable on real
    // commercial pages — a chat widget, ad tag, or analytics beacon polling
    // in the background can keep the page from ever going idle, timing out
    // a goto() even though the content we actually need has long since
    // rendered. Use the much lighter "domcontentloaded" for navigation and
    // let the explicit waitForSelector/waitFor calls below (which already
    // exist for exactly this reason) be the real signal that the page is
    // ready, rather than waiting on network activity we don't care about.
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // The base show page only shows a date/time picker — the ticket row
    // lives on the dated ticket page that a date link's href points to.
    await page
      .waitForSelector(config.dateLinkSelector, { state: "attached", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});
    const dateLinks = page.locator(config.dateLinkSelector);
    const dateLinkCount = await dateLinks.count();
    if (dateLinkCount === 0) {
      return failure(
        `No selectable date/time ("${config.dateLinkSelector}") found on the show page — may be sold out`
      );
    }

    let chosenIndex = 0;
    let chosenDate: string | null = null;
    if (targetDate) {
      let matchIndex = -1;
      const availableDates = new Set<string>();
      for (let i = 0; i < dateLinkCount; i++) {
        const raw = await dateLinks.nth(i).getAttribute(config.dateAttribute).catch(() => null);
        const date = raw?.split(" ")[0] ?? null;
        if (date) availableDates.add(date);
        if (matchIndex === -1 && date === targetDate) matchIndex = i;
      }
      if (matchIndex === -1) {
        return failure(
          `No showtime on ${targetDate} — dates currently offered: ${[...availableDates].sort().join(", ") || "none found"}`
        );
      }
      chosenIndex = matchIndex;
      chosenDate = targetDate;
    } else {
      const raw = await dateLinks.first().getAttribute(config.dateAttribute).catch(() => null);
      chosenDate = raw?.split(" ")[0] ?? null;
    }

    const ticketHref = await dateLinks.nth(chosenIndex).getAttribute("href").catch(() => null);
    if (!ticketHref) {
      return failure(`Date/time link had no href`, chosenDate);
    }
    const ticketPageUrl = new URL(ticketHref, showUrl).toString();
    await page.goto(ticketPageUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    const row = page.locator(config.ticketRowSelector).first();
    const rowVisible = await row
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!rowVisible) {
      return failure(`No ticket row ("${config.ticketRowSelector}") found on the dated ticket page`, chosenDate);
    }

    const increment = row.locator(config.incrementButtonSelector);
    for (let i = 0; i < quantity; i++) {
      await increment.click();
      // Small pause between clicks so their JS's per-click recalculation
      // (running subtotal, enabling the add-to-cart button) keeps up —
      // clicking a real button N times mirrors an actual visitor rather than
      // guessing at their onChange logic by writing the input value directly.
      await page.waitForTimeout(150);
    }

    const quantityInput = row.locator(config.quantityInputSelector).first();
    const actualQuantity = await quantityInput.inputValue().catch(() => "");
    if (actualQuantity !== String(quantity)) {
      return failure(
        `Quantity selector mismatch: clicked "+" ${quantity} time(s) but the quantity field reads "${actualQuantity}"`,
        chosenDate
      );
    }

    const addToCart = page.locator(config.addToCartButtonSelector).filter({ hasText: config.addToCartButtonText }).first();
    const canAddToCart = await addToCart.isVisible().catch(() => false);
    if (!canAddToCart) {
      return failure(`No "${config.addToCartButtonText}" button found`, chosenDate);
    }
    await addToCart.click();
    // "Add to cart" may itself redirect to the cart page (rather than just
    // an AJAX call) — let whatever that click triggers settle first. "load"
    // rather than "networkidle": background scripts (chat widgets, ad tags,
    // analytics) can keep a real page from ever going network-idle.
    await page.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

    // Derived from the page's *current* URL rather than the original
    // showUrl string — a www/https canonicalization redirect anywhere along
    // the way (base show page, date link, add-to-cart) would otherwise leave
    // us constructing a cart URL on the wrong host/origin.
    const origin = new URL(page.url()).origin;
    const cartUrl = new URL(config.cartPath, origin).toString();
    const CART_NAV_ATTEMPTS = 3;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= CART_NAV_ATTEMPTS && !page.url().startsWith(cartUrl); attempt++) {
      try {
        await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      } catch (err) {
        // Real production pages carry background scripts (analytics, chat
        // widgets, ad tags — nothing a local mock reproduces) that can fire
        // their own navigation at the same moment ours lands, which
        // Chromium reports as our goto() being aborted (net::ERR_ABORTED).
        // That's transient, not a real failure, so retry a couple of times
        // before giving up — a collision like this rarely repeats.
        lastError = err;
        await page.waitForTimeout(500);
      }
    }
    if (!page.url().startsWith(cartUrl)) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      return failure(
        `Could not reach the cart page after ${CART_NAV_ATTEMPTS} attempts (ended up at "${page.url()}" instead): ${message}`,
        chosenDate
      );
    }

    // domcontentloaded doesn't guarantee any client-side-rendered content has
    // appeared yet — give the order summary a chance to show up before
    // reading the page, same reasoning as the earlier waitForSelector calls.
    await page
      .waitForSelector(config.orderSummarySelector, { state: "attached", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    const html = await page.content();
    const $ = cheerio.load(html);
    const summary = $(config.orderSummarySelector).first();
    if (summary.length === 0) {
      // Can't browse the live site to see why the cart came back empty, so
      // fold in what the page actually says — a quick "your cart is empty"
      // message vs. some other unexpected state are very different bugs,
      // and this saves a round trip either way.
      return failure(
        `No "${config.orderSummarySelector}" order summary found on the cart page — cart may be empty. ` +
          `Page shows: "${summarizeBodyText($)}"`,
        chosenDate
      );
    }

    const total = findRowCost($, summary, config.totalLabel);
    const taxesFees = findRowCost($, summary, config.feesLabel);
    if (total == null) {
      return failure(`Could not find a "${config.totalLabel}" row in the order summary`, chosenDate);
    }
    const subtotal = taxesFees != null ? Math.round((total - taxesFees) * 100) / 100 : null;

    return { ok: true, date: chosenDate, subtotal, taxesFees, total, currency: "USD", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return failure(message);
  } finally {
    await browser?.close().catch(() => {});
  }
}

const BODY_TEXT_SNIPPET_LENGTH = 400;

/** Collapsed, truncated visible body text — for diagnosing an unexpected page state without another live round trip. */
function summarizeBodyText($: cheerio.CheerioAPI): string {
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length > BODY_TEXT_SNIPPET_LENGTH ? `${text.slice(0, BODY_TEXT_SNIPPET_LENGTH)}…` : text;
}

/** Finds the `.cost` value inside whichever `.row` under `root` mentions `labelSubstring`. */
function findRowCost(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
  labelSubstring: string
): number | null {
  let found: number | null = null;
  root.find(".row").each((_i, el) => {
    if (!$(el).text().includes(labelSubstring)) return;
    const price = parsePriceFromText($(el).find(".cost").first().text());
    if (price != null) found = price;
  });
  return found;
}
