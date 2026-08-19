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
