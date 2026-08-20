import { chromium } from "playwright";
import { HTML_FETCH_HEADERS } from "./types";
import { parseListingEntries, type ListingConfig, type ListingResult } from "./listingAdapter";

const NAV_TIMEOUT_MS = 20000;

/**
 * Same job as fetchListing (adapters/listingAdapter.ts), but renders the
 * page with a real headless browser first instead of a plain HTTP fetch.
 *
 * Reserved for sites confirmed to need it: a plain fetch either gets bot-
 * blocked (e.g. Branson.com returns HTTP 403 to a normal request, real
 * bot-protection, not just a User-Agent check) or the content is genuinely
 * rendered client-side and never appears in the raw HTML at all. A headless
 * browser executes the page's JavaScript like a real visitor would, which
 * can get past both — though it isn't guaranteed to defeat sophisticated
 * bot detection (Cloudflare-grade tools increasingly fingerprint headless
 * browsers too).
 *
 * Meaningfully heavier than fetchListing: launches a real Chromium process
 * per call. Only use this kind for sites that actually need it.
 */
export async function fetchListingViaBrowser(url: string, config: ListingConfig): Promise<ListingResult> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      userAgent: HTML_FETCH_HEADERS["User-Agent"],
      extraHTTPHeaders: { "Accept-Language": HTML_FETCH_HEADERS["Accept-Language"] },
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      timezoneId: "America/Chicago",
    });
    // Basic anti-fingerprinting: undo the most obvious tells that separate a
    // default headless session from a real browser (navigator.webdriver,
    // empty plugins/languages, missing window.chrome). Free, and worth
    // trying before paying for a scraping service — but this only helps
    // against *simple* automation checks; it won't get past anything doing
    // real behavioral analysis or a JS/CAPTCHA challenge (e.g. Cloudflare
    // Turnstile). Confirm with a fresh check after deploying: if a site was
    // returning an empty/blocked page before, see if this changes that.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    // Give client-side-rendered card lists a chance to appear even if the
    // page never reaches "networkidle" (e.g. a long-polling widget) — if
    // the card selector never shows up, fall through and let an empty
    // result report cleanly rather than throwing.
    await page.waitForSelector(config.card, { timeout: NAV_TIMEOUT_MS }).catch(() => {});
    const html = await page.content();
    const entries = parseListingEntries(html, config);

    if (entries.length === 0) {
      return { ok: false, entries: [], error: "No cards matched after rendering — check card/name/price selectors" };
    }
    return { ok: true, entries, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, entries: [], error: message };
  } finally {
    await browser?.close().catch(() => {});
  }
}
