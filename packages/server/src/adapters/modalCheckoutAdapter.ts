import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Page } from "playwright";
import { parsePriceFromText } from "./types";
import { launchStealthContext, NAV_TIMEOUT_MS } from "./stealthBrowser";
import type { AvailableDatesResult, CheckoutQuoteResult } from "./checkoutAdapter";

/**
 * A third checkout-automation shape, distinct from CheckoutConfig
 * (page-navigation, ibranson.com) and SidecartCheckoutConfig (in-page
 * widget, branson.com). Confirmed on saveonbranson.com: a FullCalendar
 * picker on the show page opens a Bootstrap MODAL when a bookable date/time
 * is clicked. The modal lists one row per ticket TYPE (Adult, Child, Adult
 * w/ Dinner, ...), each with a per-show, per-ticket-type numeric element id
 * (e.g. "7636879999") — there's no stable selector for "the adult ticket",
 * so the right row has to be found by matching its visible label text
 * instead. Adding to cart closes the modal and renders order totals into a
 * summary panel already present on the same page (no navigation, like the
 * sidecart shape, but reached through a modal rather than an
 * inline-expanding panel).
 */
export interface ModalCheckoutConfig {
  /** Selector scoping the FullCalendar-style date/time picker on the show page. */
  calendarSelector: string;
  /** Selector, relative to calendarSelector, for a clickable bookable event — the first (earliest) match is used. */
  eventSelector: string;
  /** Attribute on a day cell holding its date ("YYYY-MM-DD"), e.g. "data-date". */
  dateAttribute: string;
  /** Selector scoping the ticket-selection modal that opens after clicking a date/time. */
  ticketModalSelector: string;
  /** Selector, within the modal, for one ticket-type row (label + quantity select). */
  ticketRowSelector: string;
  /** Selector, relative to a ticket row, for its label text. */
  ticketLabelSelector: string;
  /** Substring identifying the ticket type to book, e.g. "Adult" — the FIRST matching row is used (the base/standard tier is listed before add-on tiers like a dinner upgrade). */
  ticketLabelMatch: string;
  /** Selector, relative to a ticket row, for its quantity <select>. */
  ticketQuantitySelectSelector: string;
  /** Page-level selector for the "add to cart" button. */
  addToCartButtonSelector: string;
  /** Page-level selector scoping the order-totals panel that appears after adding to cart. */
  totalsPanelSelector: string;
  /** Substring identifying the all-in total's row label, e.g. "Order Total". */
  totalLabel: string;
  /** Substring identifying the taxes/fees row's label, e.g. "Tax Recovery". */
  feesLabel: string;
}

const MODAL_CONFIG_KEYS: (keyof ModalCheckoutConfig)[] = [
  "calendarSelector",
  "eventSelector",
  "dateAttribute",
  "ticketModalSelector",
  "ticketRowSelector",
  "ticketLabelSelector",
  "ticketLabelMatch",
  "ticketQuantitySelectSelector",
  "addToCartButtonSelector",
  "totalsPanelSelector",
  "totalLabel",
  "feesLabel",
];

/** Parses a CompetitorSite.checkoutSelector JSON string into a ModalCheckoutConfig, or null if invalid/incomplete. */
export function parseModalCheckoutConfig(raw: string): ModalCheckoutConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const key of MODAL_CONFIG_KEYS) {
      if (typeof (parsed as Record<string, unknown>)[key] !== "string") return null;
    }
    return parsed as ModalCheckoutConfig;
  } catch {
    return null;
  }
}

// Built from real markup pasted by the operator on 2026-08-26 for
// saveonbranson.com's Hughes Music Show. The calendar is a FullCalendar
// instance ("fc-event-available" is the positive marker for a bookable
// date/time, unlike branson.com's negative ".fc-event-past" exclusion).
// Ticket rows are matched by label text ("Adult" — the first/standard
// tier, listed before the dinner-inclusive upgrade tier for the same
// ticket type) since each row's <select> id is a per-show random number.
export const SAVEONBRANSON_CHECKOUT_CONFIG: ModalCheckoutConfig = {
  calendarSelector: "#BodyContent_CalendarBlock",
  eventSelector: "a.fc-event.fc-event-available",
  dateAttribute: "data-date",
  ticketModalSelector: "#BodyContent_TicketsModal",
  ticketRowSelector: ".form-group",
  ticketLabelSelector: "label",
  ticketLabelMatch: "Adult",
  ticketQuantitySelectSelector: "select",
  addToCartButtonSelector: "#BodyContent_AddToCart",
  totalsPanelSelector: "#BodyContent_CheckOutBlock",
  totalLabel: "Order Total",
  feesLabel: "Tax Recovery",
};

const MAX_QUANTITY = 20;

// Same FullCalendar month-view limitation as sidecartCheckoutAdapter.ts:
// only one month's day cells exist in the DOM at a time. The "next month"
// control and toolbar title are FullCalendar's own generated markup, so —
// like the calendar body itself — they're addressed via calendarSelector
// rather than being part of ModalCheckoutConfig.
const MAX_CALENDAR_MONTHS = 3;
const MONTH_ADVANCE_CHECK_TIMEOUT_MS = 3000;

async function collectCurrentMonthDates(page: Page, config: ModalCheckoutConfig): Promise<string[]> {
  return page
    .locator(`${config.calendarSelector} td[${config.dateAttribute}]`)
    .evaluateAll(
      (cells, args) =>
        cells
          .filter((td) => td.querySelector(args.eventSelector))
          .map((td) => td.getAttribute(args.attr))
          .filter((d): d is string => !!d),
      { eventSelector: config.eventSelector, attr: config.dateAttribute }
    )
    .catch(() => [] as string[]);
}

async function waitForCalendarAdvance(page: Page, config: ModalCheckoutConfig, previousTitle: string | null): Promise<void> {
  const titleSelector = `${config.calendarSelector} .fc-toolbar-title`;
  const deadline = Date.now() + MONTH_ADVANCE_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await page.locator(titleSelector).first().textContent().catch(() => null);
    if (current !== previousTitle) return;
    await page.waitForTimeout(100);
  }
}

async function advanceCalendarMonth(page: Page, config: ModalCheckoutConfig): Promise<boolean> {
  const nextButton = page.locator(`${config.calendarSelector} .fc-next-button`).first();
  const canAdvance = await nextButton.isVisible().catch(() => false);
  if (!canAdvance) return false;
  const titleBefore = await page.locator(`${config.calendarSelector} .fc-toolbar-title`).first().textContent().catch(() => null);
  await nextButton.click();
  await waitForCalendarAdvance(page, config, titleBefore);
  return true;
}

/**
 * Drives a modal-widget checkout (see ModalCheckoutConfig) for `quantity`
 * tickets and reads back the all-in total plus its subtotal/taxes-fees
 * breakdown from the same-page totals panel — no cart page to navigate to.
 * Manually triggered (see routes/checkoutQuotes.ts), not part of the cron
 * cycle.
 *
 * If `targetDate` ("YYYY-MM-DD") is given, only that date's showtime is
 * used — paging the calendar forward up to MAX_CALENDAR_MONTHS months to
 * find it (same limitation as sidecartCheckoutAdapter.ts: FullCalendar only
 * renders one month's cells at a time) before failing clearly with the
 * dates that ARE available. Left undefined, the earliest available
 * date/time is picked automatically.
 */
export async function fetchModalCheckoutTotal(
  showUrl: string,
  quantity: number,
  config: ModalCheckoutConfig,
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

    const eventSelector = targetDate
      ? `${config.calendarSelector} td[${config.dateAttribute}="${targetDate}"] ${config.eventSelector}`
      : `${config.calendarSelector} ${config.eventSelector}`;
    let event = page.locator(eventSelector).first();
    let hasEvent = await event
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    const seenDates = new Set<string>();
    if (targetDate) {
      (await collectCurrentMonthDates(page, config)).forEach((d) => seenDates.add(d));
      for (let month = 1; month < MAX_CALENDAR_MONTHS && !hasEvent; month++) {
        const advanced = await advanceCalendarMonth(page, config);
        if (!advanced) break;
        (await collectCurrentMonthDates(page, config)).forEach((d) => seenDates.add(d));
        event = page.locator(eventSelector).first();
        hasEvent = await event
          .waitFor({ state: "visible", timeout: MONTH_ADVANCE_CHECK_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
      }
    }

    if (!hasEvent) {
      if (targetDate) {
        return failure(
          `No showtime on ${targetDate} — dates currently offered (looked ahead ${MAX_CALENDAR_MONTHS} month(s)): ${
            [...seenDates].sort().join(", ") || "none found"
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

    const modal = page.locator(config.ticketModalSelector).first();
    const modalReady = await modal
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!modalReady) {
      return failure(`No "${config.ticketModalSelector}" ticket modal appeared after picking a date/time`, chosenDate);
    }

    // Each ticket row's <select> has a per-show, randomly-generated id — the
    // right row can only be found by matching its label text.
    const rows = modal.locator(config.ticketRowSelector);
    const rowCount = await rows.count();
    let matchedRowIndex = -1;
    for (let i = 0; i < rowCount; i++) {
      const label = await rows.nth(i).locator(config.ticketLabelSelector).first().innerText().catch(() => "");
      if (label.includes(config.ticketLabelMatch)) {
        matchedRowIndex = i;
        break;
      }
    }
    if (matchedRowIndex === -1) {
      return failure(
        `No ticket row matching "${config.ticketLabelMatch}" found among ${rowCount} row(s) in the ticket modal`,
        chosenDate
      );
    }

    await rows.nth(matchedRowIndex).locator(config.ticketQuantitySelectSelector).first().selectOption(String(quantity));

    const addToCart = page.locator(config.addToCartButtonSelector).first();
    const canAddToCart = await addToCart.isVisible().catch(() => false);
    if (!canAddToCart) {
      return failure(`No add-to-cart button ("${config.addToCartButtonSelector}") found`, chosenDate);
    }
    await addToCart.click();

    // The totals panel is already present on the page (possibly empty) —
    // wait for it to actually contain the total line rather than just being
    // attached/visible, since that's the real signal the add went through.
    await page
      .locator(config.totalsPanelSelector)
      .filter({ hasText: config.totalLabel })
      .first()
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    const html = await page.content();
    const $ = cheerio.load(html);
    const panel = $(config.totalsPanelSelector).first();
    if (panel.length === 0) {
      return failure(`No "${config.totalsPanelSelector}" totals panel found on the page after adding to cart`, chosenDate);
    }

    const total = findTableRowValue($, panel, config.totalLabel);
    const taxesFees = findTableRowValue($, panel, config.feesLabel);
    if (total == null) {
      return failure(`Could not find a "${config.totalLabel}" row in the totals panel`, chosenDate);
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
 * Lists the showtime dates currently offered, paging the calendar forward
 * up to MAX_CALENDAR_MONTHS months, without running a full checkout — the
 * modal-site equivalent of fetchAvailableDates/fetchAvailableSidecartDates.
 */
export async function fetchAvailableModalDates(showUrl: string, config: ModalCheckoutConfig): Promise<AvailableDatesResult> {
  let browser;
  try {
    const launched = await launchStealthContext();
    browser = launched.browser;
    const page = await launched.context.newPage();
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page
      .waitForSelector(`${config.calendarSelector} td[${config.dateAttribute}]`, { state: "attached", timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    const dates = new Set<string>();
    for (let month = 0; month < MAX_CALENDAR_MONTHS; month++) {
      (await collectCurrentMonthDates(page, config)).forEach((d) => dates.add(d));
      if (month === MAX_CALENDAR_MONTHS - 1) break;
      const advanced = await advanceCalendarMonth(page, config);
      if (!advanced) break;
    }

    return { ok: true, dates: [...dates].sort(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, dates: [], error: message };
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Finds the value cell of whichever table row's first cell (label) contains `labelSubstring`. */
function findTableRowValue($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>, labelSubstring: string): number | null {
  let found: number | null = null;
  root.find("tr").each((_i, el) => {
    const cells = $(el).find("td");
    if (cells.length < 2) return;
    const label = $(cells[0]).text();
    if (!label.includes(labelSubstring)) return;
    const price = parsePriceFromText($(cells[cells.length - 1]).text());
    if (price != null) found = price;
  });
  return found;
}
