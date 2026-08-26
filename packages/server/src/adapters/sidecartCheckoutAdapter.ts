import * as cheerio from "cheerio";
import { parsePriceFromText } from "./types";
import { launchStealthContext, NAV_TIMEOUT_MS } from "./stealthBrowser";
import type { AvailableDatesResult, CheckoutQuoteResult } from "./checkoutAdapter";

/**
 * A second checkout-automation shape, distinct from CheckoutConfig
 * (checkoutAdapter.ts). That one assumes a site built like ibranson.com:
 * separate page navigations for date -> ticket page -> cart. Sites built on
 * a "sidecart" widget (confirmed on branson.com) instead do everything in
 * one in-page panel with no navigation at all: click a calendar event to
 * open it, pick a quantity from a <select>, click add-to-cart, and the same
 * panel updates in place to show the order totals. Different enough
 * (select-based quantity, event-based date picking, no page loads to wait
 * on) that forcing it into CheckoutConfig's shape would just leave half the
 * fields unused — a distinct type is clearer than one bloated one.
 */
export interface SidecartCheckoutConfig {
  /** Selector for a clickable, bookable calendar event on the show page — the first (earliest) match is used. */
  eventSelector: string;
  /**
   * Attribute holding a day cell's date ("YYYY-MM-DD"), e.g. "data-date".
   * Assumes a FullCalendar-style DOM: a `<td [dateAttribute]="...">` day
   * cell that each event element is nested inside — confirmed on
   * branson.com, the only sidecart site so far. If a future sidecart site
   * uses a differently-structured calendar, date-picking will need to stop
   * assuming that shape.
   */
  dateAttribute: string;
  /** Selector, page-level, for the ticket type's quantity <select> to set (e.g. the "adult" ticket type). */
  quantitySelectSelector: string;
  /** Page-level selector for the "add to cart" button. */
  addToCartButtonSelector: string;
  /** Selector for one order-total line within the cart panel (each line has a label + a value). */
  totalLineSelector: string;
  /** Selector, relative to a total line, for its label text. */
  totalLineLabelSelector: string;
  /** Selector, relative to a total line, for its value text. */
  totalLineValueSelector: string;
  /** Substring identifying the all-in total's line label, e.g. "Order Total". */
  totalLabel: string;
  /** Substring identifying the taxes/fees line's label, e.g. "Taxes & Fees". */
  feesLabel: string;
}

const SIDECART_CONFIG_KEYS: (keyof SidecartCheckoutConfig)[] = [
  "eventSelector",
  "dateAttribute",
  "quantitySelectSelector",
  "addToCartButtonSelector",
  "totalLineSelector",
  "totalLineLabelSelector",
  "totalLineValueSelector",
  "totalLabel",
  "feesLabel",
];

/** Parses a CompetitorSite.checkoutSelector JSON string into a SidecartCheckoutConfig, or null if invalid/incomplete. */
export function parseSidecartCheckoutConfig(raw: string): SidecartCheckoutConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const key of SIDECART_CONFIG_KEYS) {
      if (typeof (parsed as Record<string, unknown>)[key] !== "string") return null;
    }
    return parsed as SidecartCheckoutConfig;
  } catch {
    return null;
  }
}

// Built from real markup pasted by the operator on 2026-08-25 for
// branson.com's Hughes Music Show (a "sidecart" ticketing widget, "sc-"
// class prefix). The calendar is a FullCalendar instance embedded directly
// on the show page — no button needed to reveal it. Past dates carry an
// "-past" class variant on both the day cell and its events; excluding
// ".fc-event-past" is what keeps the first match from landing on a date
// that's already gone by.
export const BRANSON_COM_CHECKOUT_CONFIG: SidecartCheckoutConfig = {
  eventSelector: "#fullcalendar a.fc-event:not(.fc-event-past)",
  dateAttribute: "data-date",
  quantitySelectSelector: 'select[data-type="adult"]',
  addToCartButtonSelector: "button.sc-add-to-cart",
  totalLineSelector: ".sc-order-total-line",
  totalLineLabelSelector: ".sc-order-total-label",
  totalLineValueSelector: ".sc-order-total-value",
  totalLabel: "Order Total",
  feesLabel: "Taxes & Fees",
};

const MAX_QUANTITY = 20;

/**
 * Drives a sidecart-widget checkout (see SidecartCheckoutConfig) for
 * `quantity` tickets and reads back the all-in total plus its
 * subtotal/taxes-fees breakdown from the same in-page panel — no cart page
 * to navigate to, unlike checkoutAdapter.ts's fetchCheckoutTotal. Manually
 * triggered (see routes/checkoutQuotes.ts), not part of the cron cycle.
 *
 * If `targetDate` ("YYYY-MM-DD") is given, only that date's showtime is
 * used — failing clearly (with the dates that ARE available, from the
 * calendar's currently-displayed month) if it's not offered. Left
 * undefined, the earliest available date/time is picked automatically.
 */
export async function fetchSidecartCheckoutTotal(
  showUrl: string,
  quantity: number,
  config: SidecartCheckoutConfig,
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

    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // Scoped to a specific day cell when a date is requested — see
    // SidecartCheckoutConfig.dateAttribute for the FullCalendar-shaped
    // assumption this relies on. The tail selector here
    // ("a.fc-event:not(.fc-event-past)") must stay in sync with
    // config.eventSelector's own suffix.
    const eventSelector = targetDate
      ? `#fullcalendar td[${config.dateAttribute}="${targetDate}"] a.fc-event:not(.fc-event-past)`
      : config.eventSelector;
    const event = page.locator(eventSelector).first();
    const hasEvent = await event
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!hasEvent) {
      if (targetDate) {
        const availableDates = await page
          .locator(`#fullcalendar td[${config.dateAttribute}]`)
          .evaluateAll(
            (cells, attr) =>
              cells
                .filter((td) => td.querySelector("a.fc-event:not(.fc-event-past)"))
                .map((td) => td.getAttribute(attr))
                .filter((d): d is string => !!d),
            config.dateAttribute
          )
          .catch(() => [] as string[]);
        return failure(
          `No showtime on ${targetDate} — dates currently offered (this calendar view): ${
            availableDates.sort().join(", ") || "none found"
          }`
        );
      }
      return failure(`No bookable date/time ("${config.eventSelector}") found on the show page`);
    }

    const chosenDate =
      targetDate ??
      (await event
        .evaluate(
          (el, attr) => (el.closest(`td[${attr}]`) as HTMLElement | null)?.getAttribute(attr) ?? null,
          config.dateAttribute
        )
        .catch(() => null));

    await event.click();

    // The widget opens in place (no navigation) — wait for the quantity
    // select to actually be interactable rather than guessing a fixed delay.
    const quantitySelect = page.locator(config.quantitySelectSelector).first();
    const selectReady = await quantitySelect
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!selectReady) {
      return failure(
        `No quantity selector ("${config.quantitySelectSelector}") appeared after picking a date/time`,
        chosenDate
      );
    }
    await quantitySelect.selectOption(String(quantity));

    const addToCart = page.locator(config.addToCartButtonSelector).first();
    const canAddToCart = await addToCart.isVisible().catch(() => false);
    if (!canAddToCart) {
      return failure(`No add-to-cart button ("${config.addToCartButtonSelector}") found`, chosenDate);
    }
    await addToCart.click();

    // Same panel updates in place to the cart screen — wait for the totals
    // to actually render before reading the page.
    await page
      .locator(config.totalLineSelector)
      .first()
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    const html = await page.content();
    const $ = cheerio.load(html);

    const total = findLabeledValue($, config, config.totalLabel);
    const taxesFees = findLabeledValue($, config, config.feesLabel);
    if (total == null) {
      return failure(`Could not find a "${config.totalLabel}" line in the cart totals`, chosenDate);
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

/**
 * Lists the showtime dates currently offered (this calendar view), without
 * running a full checkout — the sidecart-site equivalent of
 * fetchAvailableDates in checkoutAdapter.ts. Same FullCalendar-shaped
 * assumption as SidecartCheckoutConfig.dateAttribute, and the same
 * ".fc-event:not(.fc-event-past)" tail used to keep past dates out.
 */
export async function fetchAvailableSidecartDates(
  showUrl: string,
  config: SidecartCheckoutConfig
): Promise<AvailableDatesResult> {
  let browser;
  try {
    const launched = await launchStealthContext();
    browser = launched.browser;
    const page = await launched.context.newPage();
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page
      .waitForSelector(`#fullcalendar td[${config.dateAttribute}]`, { state: "attached", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});
    const dates = await page
      .locator(`#fullcalendar td[${config.dateAttribute}]`)
      .evaluateAll(
        (cells, attr) =>
          cells
            .filter((td) => td.querySelector("a.fc-event:not(.fc-event-past)"))
            .map((td) => td.getAttribute(attr))
            .filter((d): d is string => !!d),
        config.dateAttribute
      )
      .catch(() => [] as string[]);
    return { ok: true, dates: [...new Set(dates)].sort(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, dates: [], error: message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Finds the value of whichever total line's label contains `labelSubstring`. */
function findLabeledValue(
  $: cheerio.CheerioAPI,
  config: SidecartCheckoutConfig,
  labelSubstring: string
): number | null {
  let found: number | null = null;
  $(config.totalLineSelector).each((_i, el) => {
    const label = $(el).find(config.totalLineLabelSelector).first().text();
    if (!label.includes(labelSubstring)) return;
    const price = parsePriceFromText($(el).find(config.totalLineValueSelector).first().text());
    if (price != null) found = price;
  });
  return found;
}
