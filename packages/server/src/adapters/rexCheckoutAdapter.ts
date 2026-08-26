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

/**
 * Diagnostics captured on 2026-08-27 showed the availability widget's own
 * network call never fires at all during an automated run — not
 * succeeding, not failing, just never attempted — while the operator's
 * own (scrolling, human) browser eventually renders the same rows fine.
 * The very first markup ever pasted for this site included a "Book Now"
 * button whose click handler is literally scrollToAvailability(), which
 * points at the section being lazy-loaded on scroll (an IntersectionObserver
 * or similar), something an automated browser that never scrolls would
 * never trigger. Scrolling down in a few steps — rather than jumping
 * straight to the bottom — mimics a real visit closely enough to fire
 * whatever's watching for the section coming into view, without needing
 * to guess a specific selector for it.
 */
async function scrollToTriggerLazyLoad(page: Page): Promise<void> {
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 800).catch(() => {});
    await page.waitForTimeout(250);
  }
}

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
    const diagnostics = attachDiagnosticsCollector(page);

    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await scrollToTriggerLazyLoad(page);

    // A show page can have multiple bookable sections (e.g. "Floor Seating
    // - Show Only" plus a separate "Meal & Show" dinner upgrade), each with
    // its own independent orderBox.editMode — confirmed via real markup on
    // 2026-08-27 showing one section already expanded (rows visible, no
    // button) while another sat collapsed behind a genuinely-present
    // "Select Tickets" button at the same time. Both states — and the
    // button/rows themselves — depend on REX's own async availability call,
    // so a synchronous isVisible() check (the previous approach) could run
    // before that resolves and wrongly conclude no button was ever coming.
    // Racing a real wait for either the button or the (first section's)
    // rows to appear avoids that, then clicks the button if that's what
    // won, then waits the full NAV_TIMEOUT_MS for rows regardless of which
    // path got there.
    const rows = page.locator(config.ticketRowSelector);
    const selectTickets = page.locator(config.selectTicketsButtonSelector).first();
    const buttonOrRows = await Promise.race([
      selectTickets
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => "button" as const)
        .catch(() => "neither" as const),
      rows
        .first()
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => "rows" as const)
        .catch(() => "neither" as const),
    ]);
    if (buttonOrRows === "button") {
      await selectTickets.click();
    }
    const rowsReady = await rows
      .first()
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (!rowsReady) {
      const diagnosis = await diagnosePage(page, diagnostics);
      return failure(
        `No ticket rows ("${config.ticketRowSelector}") found on the show page, with or without clicking "${config.selectTicketsButtonSelector}" — ${diagnosis}`
      );
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
    const diagnostics = attachDiagnosticsCollector(page);
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await scrollToTriggerLazyLoad(page);

    // See the same fix in fetchRexCheckoutTotal above: race a real wait for
    // either the button or the date picker to appear (both depend on
    // REX's own async availability call, so a synchronous isVisible()
    // check could run before either exists), click the button if that's
    // what won, then always wait the full NAV_TIMEOUT_MS for the date
    // picker regardless.
    const selectTickets = page.locator(config.selectTicketsButtonSelector).first();
    const datePicker = page.locator(config.datePickerButtonSelector).first();
    const buttonOrPicker = await Promise.race([
      selectTickets
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => "button" as const)
        .catch(() => "neither" as const),
      datePicker
        .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
        .then(() => "picker" as const)
        .catch(() => "neither" as const),
    ]);
    if (buttonOrPicker === "button") {
      await selectTickets.click();
    }
    const datePickerReady = await datePicker
      .waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);

    if (!datePickerReady) {
      const diagnosis = await diagnosePage(page, diagnostics);
      return {
        ok: false,
        dates: [],
        error: `No "${config.datePickerButtonSelector}" date button found, with or without clicking "${config.selectTicketsButtonSelector}" — ${diagnosis}`,
      };
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

/**
 * The static-HTML diagnostics below turned out not to be enough: on
 * 2026-08-27 the ticket rows still never appeared even with a generous
 * wait, no bot-block text anywhere in the page, and a page shell that
 * loads and looks completely normal (the operator's own browser
 * eventually renders the exact same rows this adapter is looking for).
 * That points at something that never shows up in page.content() at
 * all — a background XHR call REX's availability widget depends on
 * failing silently, or a JS error killing that widget's bootstrap before
 * it renders anything. Capturing console errors and failed/non-2xx
 * network activity from page creation onward is the only way to see that
 * from here, since this sandbox has no outbound access to
 * reservebranson.com to go look for itself.
 */
interface PageDiagnosticsCollector {
  consoleErrors: string[];
  failedRequests: string[];
  badResponses: string[];
  pageErrors: string[];
  requestHosts: Set<string>;
}

const DIAGNOSTICS_ENTRY_LIMIT = 8;

function attachDiagnosticsCollector(page: Page): PageDiagnosticsCollector {
  const collector: PageDiagnosticsCollector = {
    consoleErrors: [],
    failedRequests: [],
    badResponses: [],
    pageErrors: [],
    requestHosts: new Set(),
  };

  page.on("console", (msg) => {
    if (msg.type() === "error" && collector.consoleErrors.length < DIAGNOSTICS_ENTRY_LIMIT) {
      collector.consoleErrors.push(msg.text().slice(0, 200));
    }
  });
  // Distinct from console.error: an uncaught exception (e.g. inside an
  // Angular digest or a promise chain Angular's own error handling
  // doesn't log) fires this instead, and console-based capture alone
  // would miss it entirely.
  page.on("pageerror", (err) => {
    if (collector.pageErrors.length < DIAGNOSTICS_ENTRY_LIMIT) {
      collector.pageErrors.push(err.message.slice(0, 300));
    }
  });
  page.on("requestfailed", (req) => {
    if (collector.failedRequests.length < DIAGNOSTICS_ENTRY_LIMIT) {
      collector.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "unknown"}`);
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && collector.badResponses.length < DIAGNOSTICS_ENTRY_LIMIT) {
      collector.badResponses.push(`${res.status()} ${res.url()}`);
    }
  });
  // badResponses/failedRequests only cover requests that error out — if
  // REX's own availability call actually succeeds (200) but something
  // afterward silently fails to render, neither would ever see it. Every
  // hostname actually contacted at least says whether that call was
  // attempted at all.
  page.on("request", (req) => {
    try {
      collector.requestHosts.add(new URL(req.url()).hostname);
    } catch {
      // ignore malformed URLs
    }
  });

  return collector;
}

/**
 * When the ticket-selection flow never appears at all — despite waiting
 * the full NAV_TIMEOUT_MS and clicking "Select Tickets" if present — this
 * can't be diagnosed further from here: this sandbox has no outbound
 * access to reservebranson.com, so there's no way to just go look at what
 * the automated browser is actually receiving. Bundling a compact summary
 * into the failure's error string instead (URL after any redirect, page
 * title, raw HTML size, a few probes for the likeliest static-HTML causes,
 * plus any console errors and failed/non-2xx network activity collected
 * over the page's lifetime) gives something concrete to act on from the
 * CheckoutQuote record alone.
 */
async function diagnosePage(page: Page, diagnostics: PageDiagnosticsCollector): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => "<unreadable>");
  const html = await page.content().catch(() => "");
  const lower = html.toLowerCase();
  const has = (needle: string) => lower.includes(needle.toLowerCase());

  const signals: string[] = [];
  if (has("primarytypes")) signals.push('raw HTML mentions "primaryTypes"');
  if (has("rex-ticket-order-box")) signals.push('raw HTML mentions "rex-ticket-order-box"');
  if (has("ng-app") || has("angular.js") || has("angular.min.js")) signals.push("an Angular script tag is present");
  if (has("captcha")) signals.push('mentions "captcha"');
  if (has("cloudflare") && (has("checking your browser") || has("challenge"))) {
    signals.push("looks like a Cloudflare challenge page");
  }
  if (has("access denied") || has("403 forbidden")) signals.push("looks like an access-denied page");
  if (has("are you a human") || has("bot detection") || has("automated")) signals.push("mentions bot/automation detection");

  const parts = [`url=${url}`, `title="${title}"`, `htmlBytes=${html.length}`, `signals=[${signals.join("; ") || "none found"}]`];
  parts.push(`requestHosts=[${[...diagnostics.requestHosts].sort().join(", ")}]`);
  if (diagnostics.badResponses.length > 0) parts.push(`badResponses=[${diagnostics.badResponses.join(" | ")}]`);
  if (diagnostics.failedRequests.length > 0) parts.push(`failedRequests=[${diagnostics.failedRequests.join(" | ")}]`);
  if (diagnostics.consoleErrors.length > 0) parts.push(`consoleErrors=[${diagnostics.consoleErrors.join(" | ")}]`);
  if (diagnostics.pageErrors.length > 0) parts.push(`pageErrors=[${diagnostics.pageErrors.join(" | ")}]`);

  return parts.join(" ");
}
