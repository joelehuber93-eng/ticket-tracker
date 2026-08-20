/**
 * Headers for scraper/listing HTML fetches. Uses a real browser User-Agent
 * rather than self-identifying as a bot — several competitors (confirmed:
 * Branson.com, TripAdvisor) return HTTP 403 to unrecognized/bot-labeled
 * User-Agents even though nothing else about the request is different. This
 * doesn't change what the scraper does (single request, respects the
 * configured poll interval, still meant to be checked against robots.txt
 * before adding a source) — it just avoids being blocked purely for
 * honestly naming itself. If a site still 403s after this, it's likely
 * doing real bot detection (Cloudflare JS challenges, TLS fingerprinting,
 * etc.) that no amount of header-tuning on a plain fetch() will get past —
 * that needs a headless-browser adapter instead.
 */
export const HTML_FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export interface FetchPriceInput {
  /** URL to hit: a product-specific URL if set on the ProductSite join row, else the site's targetUrl. */
  url: string;
  /**
   * "api": dot-path into the JSON response (e.g. "data.price").
   * "scraper": CSS selector whose text content contains the price.
   */
  selector: string;
}

export interface FetchPriceResult {
  ok: boolean;
  price: number | null;
  currency: string;
  error: string | null;
}

export interface SourceAdapter {
  kind: string;
  fetchPrice(input: FetchPriceInput): Promise<FetchPriceResult>;
}

/** Pulls the first run of digits (with optional decimal) out of a string, e.g. "$1,299.00" -> 1299.00 */
export function parsePriceFromText(text: string): number | null {
  const cleaned = text.replace(/,/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Resolves a dot-path like "data.price" against a parsed JSON object. */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}
