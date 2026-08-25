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

export interface CheckoutQuoteResult {
  ok: boolean;
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
 * "https://ibranson.com/shows-in-branson-missouri/hughes-music-show/" — the
 * earliest available date/time is picked automatically (see
 * CheckoutConfig.dateLinkSelector).
 */
export async function fetchCheckoutTotal(
  showUrl: string,
  quantity: number,
  config: CheckoutConfig = IBRANSON_CHECKOUT_CONFIG
): Promise<CheckoutQuoteResult> {
  const failure = (error: string): CheckoutQuoteResult => ({
    ok: false,
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

    await page.goto(showUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });

    // The base show page only shows a date/time picker — the ticket row
    // lives on the dated ticket page that a date link's href points to, so
    // follow the earliest one (see CheckoutConfig.dateLinkSelector).
    await page
      .waitForSelector(config.dateLinkSelector, { state: "attached", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});
    const dateLink = page.locator(config.dateLinkSelector).first();
    const ticketHref = await dateLink.getAttribute("href").catch(() => null);
    if (!ticketHref) {
      return failure(
        `No selectable date/time ("${config.dateLinkSelector}") found on the show page — may be sold out`
      );
    }
    const ticketPageUrl = new URL(ticketHref, showUrl).toString();
    await page.goto(ticketPageUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });

    const row = page.locator(config.ticketRowSelector).first();
    const rowVisible = await row
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!rowVisible) {
      return failure(`No ticket row ("${config.ticketRowSelector}") found on the dated ticket page`);
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
        `Quantity selector mismatch: clicked "+" ${quantity} time(s) but the quantity field reads "${actualQuantity}"`
      );
    }

    const addToCart = page.locator(config.addToCartButtonSelector).filter({ hasText: config.addToCartButtonText }).first();
    const canAddToCart = await addToCart.isVisible().catch(() => false);
    if (!canAddToCart) {
      return failure(`No "${config.addToCartButtonText}" button found`);
    }
    await addToCart.click();
    // "Add to cart" may itself redirect to the cart page (rather than just
    // an AJAX call) — let whatever that click triggers settle first.
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

    const origin = new URL(showUrl).origin;
    const cartUrl = new URL(config.cartPath, origin).toString();
    if (!page.url().startsWith(cartUrl)) {
      try {
        await page.goto(cartUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      } catch (err) {
        // A goto() racing against a navigation the click already started can
        // get reported as net::ERR_ABORTED even though that navigation lands
        // on the cart page anyway — only treat it as a real failure if we
        // didn't actually end up there.
        if (!page.url().startsWith(cartUrl)) throw err;
      }
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const summary = $(config.orderSummarySelector).first();
    if (summary.length === 0) {
      return failure(`No "${config.orderSummarySelector}" order summary found on the cart page — cart may be empty`);
    }

    const total = findRowCost($, summary, config.totalLabel);
    const taxesFees = findRowCost($, summary, config.feesLabel);
    if (total == null) {
      return failure(`Could not find a "${config.totalLabel}" row in the order summary`);
    }
    const subtotal = taxesFees != null ? Math.round((total - taxesFees) * 100) / 100 : null;

    return { ok: true, subtotal, taxesFees, total, currency: "USD", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return failure(message);
  } finally {
    await browser?.close().catch(() => {});
  }
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
