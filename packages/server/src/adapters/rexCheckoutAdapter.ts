import * as cheerio from "cheerio";
import type { Page } from "playwright";
import { parsePriceFromText } from "./types";
import { launchStealthContext, NAV_TIMEOUT_MS } from "./stealthBrowser";
import type { AvailableDatesResult, CheckoutQuoteResult } from "./checkoutAdapter";

/**
 * A fourth checkout-automation shape, distinct from CheckoutConfig
 * (page-navigation, ibranson.com), SidecartCheckoutConfig (FullCalendar +
 * in-page panel, branson.com) and ModalCheckoutConfig (FullCalendar +
 * Bootstrap modal, saveonbranson.com/bransonshowtickets.com). Confirmed on
 * reservebranson.com, which runs a white-labeled Tripster/REX Angular
 * widget: clicking "Select Tickets" expands an in-page order box (no
 * modal, no navigation) that already shows a pre-selected default date —
 * the calendar overlay itself only needs to be opened when a specific date
 * is requested. Two things make this shape easier than the other two: the
 * date-picker button carries the selected date as a plain ISO attribute
 * (no text parsing needed), and the post-add-to-cart total is a plain
 * numeric attribute on a dedicated element rather than something to scrape
 * out of a labeled table row.
 */
export interface RexCheckoutConfig {
  /** Page-level selector for the "Select Tickets" button that expands the order box. */
  selectTicketsButtonSelector: string;
  /** Once the order box is open, selector for the date button showing the currently selected date; click to open the calendar overlay. */
  datePickerButtonSelector: string;
  /** Attribute on datePickerButtonSelector holding the selected date as an ISO datetime (e.g. "2026-08-27T00:00:00"). */
  pickerDateAttribute: string;
  /** Selector for the calendar overlay that opens after clicking the date-picker button. */
  calendarSelector: string;
  /** Selector, relative to calendarSelector, for a clickable, available day cell — the first (earliest) match is used. */
  dayCellSelector: string;
  /** Selector, relative to calendarSelector, for the "next month" control. */
  nextMonthButtonSelector: string;
  /** Selector, relative to calendarSelector, for the text showing the currently displayed month (used to detect when paging finished). */
  monthTitleSelector: string;
  /** Page-level selector, within the open order box, for one ticket-type row (label + quantity select). */
  ticketRowSelector: string;
  /** Selector, relative to a ticket row, for its label text. */
  ticketLabelSelector: string;
  /** Substring identifying the ticket type to book, e.g. "Adult" — the FIRST matching row is used. */
  ticketLabelMatch: string;
  /** Selector, relative to a ticket row, for its quantity <select>. */
  ticketQuantitySelectSelector: string;
  /** Page-level selector for the "add to cart" button. */
  addToCartButtonSelector: string;
  /** Selector for the element holding the final all-in total after adding to cart. */
  totalSelector: string;
  /** Attribute on totalSelector holding the final total as a plain decimal string, e.g. "data-amount". */
  totalAttribute: string;
  /** Page-level selector, within the post-add-to-cart summary, for the per-ticket taxes/fees cell (text like "$2.85/ea" — multiplied by quantity for the taxesFees total). */
  feesCellSelector: string;
}

const REX_CONFIG_KEYS: (keyof RexCheckoutConfig)[] = [
  "selectTicketsButtonSelector",
  "datePickerButtonSelector",
  "pickerDateAttribute",
  "calendarSelector",
  "dayCellSelector",
  "nextMonthButtonSelector",
  "monthTitleSelector",
  "ticketRowSelector",
  "ticketLabelSelector",
  "ticketLabelMatch",
  "ticketQuantitySelectSelector",
  "addToCartButtonSelector",
  "totalSelector",
  "totalAttribute",
  "feesCellSelector",
];

/** Parses a CompetitorSite.checkoutSelector JSON string into a RexCheckoutConfig, or null if invalid/incomplete. */
export function parseRexCheckoutConfig(raw: string): RexCheckoutConfig | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const key of REX_CONFIG_KEYS) {
      if (typeof (parsed as Record<string, unknown>)[key] !== "string") return null;
    }
    return parsed as RexCheckoutConfig;
  } catch {
    return null;
  }
}

// Built from real markup pasted by the operator on 2026-08-26 for
// reservebranson.com's Hughes Music Show. Ticket rows are matched by label
// text ("Adult" — same first-match-wins convention as the modal shape)
// since they're Angular ng-repeat rows with no stable per-type selector.
// The day-cell's date isn't in an attribute — it's baked into a class name
// like "drp-id0-2026-08-27" (a jQuery daterangepicker convention) — see
// DAY_CELL_DATE_CLASS_RE below, hardcoded rather than part of this config
// the same way FullCalendar's own generated classes are hardcoded in the
// other two shapes' adapters.
export const RESERVEBRANSON_CHECKOUT_CONFIG: RexCheckoutConfig = {
  selectTicketsButtonSelector: ".item-picker",
  datePickerButtonSelector: ".product-picker",
  pickerDateAttribute: "picker-date",
  calendarSelector: ".calendar-table",
  dayCellSelector: "td.calendar-date.available",
  nextMonthButtonSelector: "th.next.available",
  monthTitleSelector: "th.month",
  ticketRowSelector: '[ng-repeat="primaryType in primaryTypes"]',
  ticketLabelSelector: "label",
  ticketLabelMatch: "Adult",
  ticketQuantitySelectSelector: "select",
  addToCartButtonSelector: 'a[ng-click^="cart();"]',
  totalSelector: "#cart-total-amount",
  totalAttribute: "data-amount",
  feesCellSelector: 'td[data-label="Taxes & Fees:"]',
};

const MAX_QUANTITY = 20;

// Same per-request bound as the other two shapes' calendar paging, and for
// the same reason: only the currently-displayed month's day cells exist in
// the DOM at all.
const MAX_CALENDAR_MONTHS = 3;
const MONTH_ADVANCE_CHECK_TIMEOUT_MS = 3000;
const TOTAL_POLL_TIMEOUT_MS = NAV_TIMEOUT_MS;

// Matches a day cell's "drp-id<N>-YYYY-MM-DD" class and captures the date.
const DAY_CELL_DATE_CLASS_RE = /drp-id\d+-(\d{4}-\d{2}-\d{2})/;

async function collectCurrentMonthDates(page: Page, config: RexCheckoutConfig): Promise<string[]> {
  return page
    .locator(`${config.calendarSelector} ${config.dayCellSelector}`)
    .evaluateAll((cells) =>
      cells
        .map((cell) => {
          const match = [...cell.classList].join(" ").match(/drp-id\d+-(\d{4}-\d{2}-\d{2})/);
          return match ? match[1] : null;
        })
        .filter((d): d is string => !!d)
    )
    .catch(() => [] as string[]);
}

async function waitForCalendarAdvance(page: Page, config: RexCheckoutConfig, previousTitle: string | null): Promise<void> {
  const titleSelector = `${config.calendarSelector} ${config.monthTitleSelector}`;
  const deadline = Date.now() + MONTH_ADVANCE_CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = await page.locator(titleSelector).first().textContent().catch(() => null);
    if (current !== previousTitle) return;
    await page.waitForTimeout(100);
  }
}

async function advanceCalendarMonth(page: Page, config: RexCheckoutConfig): Promise<boolean> {
  const nextButton = page.locator(`${config.calendarSelector} ${config.nextMonthButtonSelector}`).first();
  const canAdvance = await nextButton.isVisible().catch(() => false);
  if (!canAdvance) return false;
  const titleSelector = `${config.calendarSelector} ${config.monthTitleSelector}`;
  const titleBefore = await page.locator(titleSelector).first().textContent().catch(() => null);
  await nextButton.click();
  await waitForCalendarAdvance(page, config, titleBefore);
  return true;
}

/** Waits until totalSelector's totalAttribute holds a positive number, polling rather than guessing a fixed delay. */
async function waitForTotal(page: Page, config: RexCheckoutConfig): Promise<void> {
  const deadline = Date.now() + TOTAL_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const raw = await page.locator(config.totalSelector).first().getAttribute(config.totalAttribute).catch(() => null);
    const value = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(value) && value > 0) return;
    await page.waitForTimeout(150);
  }
}

/**
 * Drives a REX-widget checkout (see RexCheckoutConfig) for `quantity`
 * tickets and reads back the all-in total plus its subtotal/taxes-fees
 * breakdown — no cart page to navigate to. Manually triggered (see
 * routes/checkoutQuotes.ts), not part of the cron cycle.
 *
 * If `targetDate` ("YYYY-MM-DD") is given, only that date's showtime is
 * used — paging the calendar forward up to MAX_CALENDAR_MONTHS months to
 * find it before failing clearly with the dates that ARE available. Left
 * undefined, the order box's own pre-selected default (earliest available)
 * date is used and the calendar overlay is never opened at all.
 */
export async function fetchRexCheckoutTotal(
  showUrl: string,
  quantity: number,
  config: RexCheckoutConfig,
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

    const selectTickets = page.locator(config.selectTicketsButtonSelector).first();
    const selectTicketsReady = await selectTickets
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!selectTicketsReady) {
      return failure(`No "${config.selectTicketsButtonSelector}" button found on the show page`);
    }
    await selectTickets.click();

    const rows = page.locator(config.ticketRowSelector);
    const rowsReady = await rows
      .first()
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!rowsReady) {
      return failure(`No ticket rows ("${config.ticketRowSelector}") appeared after clicking "Select Tickets"`);
    }

    let chosenDate: string | null = null;

    if (targetDate) {
      const datePicker = page.locator(config.datePickerButtonSelector).first();
      const datePickerReady = await datePicker
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!datePickerReady) {
        return failure(`No "${config.datePickerButtonSelector}" date button found after opening the order box`);
      }
      await datePicker.click();

      const calendar = page.locator(config.calendarSelector).first();
      const calendarReady = await calendar
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!calendarReady) {
        return failure(`No "${config.calendarSelector}" calendar appeared after clicking the date button`);
      }

      const dayCells = page.locator(`${config.calendarSelector} ${config.dayCellSelector}`);
      const seenDates = new Set<string>();
      let matchedCellIndex = -1;

      for (let month = 0; month < MAX_CALENDAR_MONTHS; month++) {
        (await collectCurrentMonthDates(page, config)).forEach((d) => seenDates.add(d));
        const count = await dayCells.count();
        for (let i = 0; i < count; i++) {
          const classAttr = await dayCells.nth(i).getAttribute("class").catch(() => null);
          const match = classAttr?.match(DAY_CELL_DATE_CLASS_RE);
          if (match && match[1] === targetDate) {
            matchedCellIndex = i;
            break;
          }
        }
        if (matchedCellIndex !== -1) break;
        if (month === MAX_CALENDAR_MONTHS - 1) break;
        const advanced = await advanceCalendarMonth(page, config);
        if (!advanced) break;
      }

      if (matchedCellIndex === -1) {
        return failure(
          `No showtime on ${targetDate} — dates currently offered (looked ahead ${MAX_CALENDAR_MONTHS} month(s)): ${
            [...seenDates].sort().join(", ") || "none found"
          }`
        );
      }

      await dayCells.nth(matchedCellIndex).click();
      chosenDate = targetDate;
    } else {
      const datePicker = page.locator(config.datePickerButtonSelector).first();
      const raw = await datePicker.getAttribute(config.pickerDateAttribute).catch(() => null);
      chosenDate = raw ? raw.slice(0, 10) : null;
    }

    let matchedRowIndex = -1;
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const label = await rows.nth(i).locator(config.ticketLabelSelector).first().innerText().catch(() => "");
      if (label.includes(config.ticketLabelMatch)) {
        matchedRowIndex = i;
        break;
      }
    }
    if (matchedRowIndex === -1) {
      return failure(`No ticket row matching "${config.ticketLabelMatch}" found among ${rowCount} row(s)`, chosenDate);
    }

    await rows.nth(matchedRowIndex).locator(config.ticketQuantitySelectSelector).first().selectOption(String(quantity));

    const addToCart = page.locator(config.addToCartButtonSelector).first();
    const canAddToCart = await addToCart.isVisible().catch(() => false);
    if (!canAddToCart) {
      return failure(`No add-to-cart button ("${config.addToCartButtonSelector}") found`, chosenDate);
    }
    await addToCart.click();

    await waitForTotal(page, config);

    const totalRaw = await page.locator(config.totalSelector).first().getAttribute(config.totalAttribute).catch(() => null);
    const total = totalRaw ? Number.parseFloat(totalRaw) : NaN;
    if (!Number.isFinite(total)) {
      return failure(`No "${config.totalSelector}" total found after adding to cart`, chosenDate);
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const feesPerEach = parsePriceFromText($(config.feesCellSelector).first().text());
    const taxesFees = feesPerEach != null ? Math.round(feesPerEach * quantity * 100) / 100 : null;
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
 * REX-site equivalent of fetchAvailableDates/fetchAvailableSidecartDates/
 * fetchAvailableModalDates. Has to open the order box and the calendar
 * overlay first, unlike the other two shapes, since neither is present in
 * the page until clicked.
 */
export async function fetchAvailableRexDates(showUrl: string, config: RexCheckoutConfig): Promise<AvailableDatesResult> {
  let browser;
  try {
    const launched = await launchStealthContext();
    browser = launched.browser;
    const page = await launched.context.newPage();
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    const selectTickets = page.locator(config.selectTicketsButtonSelector).first();
    const selectTicketsReady = await selectTickets
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!selectTicketsReady) {
      return { ok: false, dates: [], error: `No "${config.selectTicketsButtonSelector}" button found on the show page` };
    }
    await selectTickets.click();

    const datePicker = page.locator(config.datePickerButtonSelector).first();
    const datePickerReady = await datePicker
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!datePickerReady) {
      return { ok: false, dates: [], error: `No "${config.datePickerButtonSelector}" date button found` };
    }
    await datePicker.click();
    await page
      .locator(config.calendarSelector)
      .first()
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
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
