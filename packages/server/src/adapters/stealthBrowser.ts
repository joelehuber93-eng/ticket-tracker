import { chromium, type Browser, type BrowserContext } from "playwright";
import { HTML_FETCH_HEADERS } from "./types";

export const NAV_TIMEOUT_MS = 20000;

/**
 * Launches headless Chromium with basic anti-fingerprinting (see
 * fetchListingViaBrowser for why: some competitor sites block or fail to
 * render for an obviously-automated browser). Shared by every adapter that
 * needs a real browser — listing renders and the checkout-quote adapter —
 * so the launch/context setup only lives in one place.
 */
export async function launchStealthContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({
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
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    (window as unknown as { chrome: unknown }).chrome = { runtime: {} };
  });
  return { browser, context };
}
