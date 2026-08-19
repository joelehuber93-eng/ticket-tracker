export type SourceKind = "api" | "scraper" | "mock";

export interface Product {
  id: string;
  name: string;
  sku: string;
  ourPrice: number;
  currency: string;
  createdAt: string;
}

export interface CompetitorSite {
  id: string;
  name: string;
  kind: SourceKind;
  // For "api": a JSON endpoint URL. For "scraper": an HTML page URL.
  targetUrl: string;
  // "api": dot-path to the price field in the JSON response, e.g. "data.price".
  // "scraper": a CSS selector whose text content is the price, e.g. ".price".
  selector: string;
  createdAt: string;
}

export interface CompetitorPrice {
  id: string;
  productId: string;
  competitorSiteId: string;
  price: number | null;
  currency: string;
  fetchedAt: string;
  ok: boolean;
  error: string | null;
}

export interface DisparityInfo {
  productId: string;
  competitorSiteId: string;
  ourPrice: number;
  competitorPrice: number;
  deltaAbsolute: number;
  deltaPercent: number;
  // "we_cheaper" | "we_pricier" | "match"
  direction: "we_cheaper" | "we_pricier" | "match";
  severity: "none" | "low" | "medium" | "high";
}

export interface PriceUpdateEvent {
  price: CompetitorPrice;
  disparity: DisparityInfo | null;
  product: Product;
  site: CompetitorSite;
}

export interface CheckRunSummary {
  startedAt: string;
  finishedAt: string;
  checked: number;
  failed: number;
}

export const SOCKET_EVENTS = {
  PRICE_UPDATE: "price:update",
  CHECK_RUN_COMPLETE: "check:complete",
} as const;

export const DEFAULT_POLL_INTERVAL_MINUTES = 5;

/** Thresholds (in percent) used to classify how severe a price disparity is. */
export const DISPARITY_THRESHOLDS = {
  low: 2,
  medium: 5,
  high: 10,
} as const;

export function classifyDisparity(deltaPercentAbs: number): DisparityInfo["severity"] {
  if (deltaPercentAbs >= DISPARITY_THRESHOLDS.high) return "high";
  if (deltaPercentAbs >= DISPARITY_THRESHOLDS.medium) return "medium";
  if (deltaPercentAbs >= DISPARITY_THRESHOLDS.low) return "low";
  return "none";
}
