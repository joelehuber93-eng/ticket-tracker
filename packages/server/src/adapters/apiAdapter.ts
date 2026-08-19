import type { FetchPriceInput, FetchPriceResult, SourceAdapter } from "./types";
import { getByPath, parsePriceFromText } from "./types";

const FETCH_TIMEOUT_MS = 8000;

/**
 * Fetches a JSON endpoint and pulls the price out via a dot-path selector,
 * e.g. selector "data.price" against { data: { price: 19.99 } }.
 */
export const apiAdapter: SourceAdapter = {
  kind: "api",
  async fetchPrice({ url, selector }: FetchPriceInput): Promise<FetchPriceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "PriceTrackerBot/1.0" },
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, price: null, currency: "USD", error: `HTTP ${res.status}` };
      }
      const json = await res.json();
      const raw = getByPath(json, selector);
      const price =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
            ? parsePriceFromText(raw)
            : null;
      if (price == null) {
        return { ok: false, price: null, currency: "USD", error: `No value at path "${selector}"` };
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
