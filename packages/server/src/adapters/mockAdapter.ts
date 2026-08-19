import type { FetchPriceInput, FetchPriceResult, SourceAdapter } from "./types";

/**
 * Demo/testing adapter: no network call. Encodes a base price and volatility
 * in the "url" as query params (e.g. "mock://demo?base=129.99&volatility=0.05")
 * and returns a jittered price around that base, so the app can be exercised
 * end-to-end (including live disparity updates) without real competitor
 * endpoints configured.
 */
export const mockAdapter: SourceAdapter = {
  kind: "mock",
  async fetchPrice({ url }: FetchPriceInput): Promise<FetchPriceResult> {
    let base = 100;
    let volatility = 0.03;
    try {
      const parsed = new URL(url.replace(/^mock:\/\//, "https://mock.local/"));
      base = Number.parseFloat(parsed.searchParams.get("base") ?? "100") || 100;
      volatility = Number.parseFloat(parsed.searchParams.get("volatility") ?? "0.03") || 0.03;
    } catch {
      // fall back to defaults above
    }
    const jitter = (Math.random() * 2 - 1) * volatility;
    const price = Math.max(0.01, Math.round(base * (1 + jitter) * 100) / 100);
    return { ok: true, price, currency: "USD", error: null };
  },
};
