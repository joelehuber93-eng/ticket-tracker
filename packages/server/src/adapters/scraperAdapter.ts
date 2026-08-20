import * as cheerio from "cheerio";
import type { FetchPriceInput, FetchPriceResult, SourceAdapter } from "./types";
import { HTML_FETCH_HEADERS, parsePriceFromText } from "./types";

const FETCH_TIMEOUT_MS = 10000;

/**
 * Fallback for sites with no API: fetches the HTML page and reads the price
 * out of the first element matching a CSS selector.
 *
 * Fragile by nature (breaks when a competitor changes their markup) and
 * should only be used where no API adapter is available. Callers are
 * responsible for respecting the target site's robots.txt and terms of
 * service before adding a scraper source.
 */
export const scraperAdapter: SourceAdapter = {
  kind: "scraper",
  async fetchPrice({ url, selector }: FetchPriceInput): Promise<FetchPriceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: HTML_FETCH_HEADERS,
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, price: null, currency: "USD", error: `HTTP ${res.status}` };
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      const text = $(selector).first().text();
      const price = parsePriceFromText(text);
      if (price == null) {
        return { ok: false, price: null, currency: "USD", error: `No price found at selector "${selector}"` };
      }
      return { ok: true, price, currency: "USD", error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { ok: false, price: null, currency: "USD", error: message };
    } finally {
      clearTimeout(timeout);
    }
  },
};
