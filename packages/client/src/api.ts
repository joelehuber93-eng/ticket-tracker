import type {
  CheckoutQuote,
  CheckoutTarget,
  CompetitorPrice,
  CompetitorSite,
  DisparityInfo,
  Product,
} from "@price-tracker/shared";

export interface DashboardRow {
  product: Product;
  site: CompetitorSite;
  latest: CompetitorPrice | null;
  disparity: DisparityInfo | null;
  // True when latest.price differs from the price ~24h ago for this pair.
  priceChanged: boolean;
  // Latest real all-in checkout total for a single ticket, if one has ever
  // been run for this pair (see the Checkout Pricing page) — null means
  // "never checked", not "$0". Unlike `latest`, this never updates on its
  // own; it only changes when someone runs a checkout check.
  checkoutQuote: CheckoutQuote | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Routes report failures as { error: "message" } or, for zod validation
    // failures, { error: <flattened zod error object> } — surface whichever
    // it is instead of just the bare status, which was leaving every 400/500
    // as an undiagnosable "Request failed: 400" with no way to tell why.
    const body = await res.json().catch(() => null);
    const errorField = (body as { error?: unknown } | null)?.error;
    const message =
      typeof errorField === "string"
        ? errorField
        : errorField
          ? JSON.stringify(errorField)
          : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDashboard: () => fetch("/api/checks/dashboard").then((r) => json<DashboardRow[]>(r)),
  runCheckNow: () => fetch("/api/checks/run", { method: "POST" }).then((r) => json(r)),
  getProducts: () => fetch("/api/products").then((r) => json<Product[]>(r)),
  getSites: () => fetch("/api/sites").then((r) => json<CompetitorSite[]>(r)),
  getCheckoutQuotes: (productId: string) =>
    fetch(`/api/checkout-quotes?productId=${encodeURIComponent(productId)}`).then((r) =>
      json<CheckoutQuote[]>(r)
    ),
  getCheckoutTargets: (productId: string) =>
    fetch(`/api/checkout-quotes/targets?productId=${encodeURIComponent(productId)}`).then((r) =>
      json<CheckoutTarget[]>(r)
    ),
  getAvailableDates: (productId: string, competitorSiteId: string | null) => {
    const params = new URLSearchParams({ productId });
    if (competitorSiteId) params.set("competitorSiteId", competitorSiteId);
    return fetch(`/api/checkout-quotes/available-dates?${params.toString()}`).then((r) =>
      json<{ dates: string[] }>(r)
    );
  },
  runCheckoutQuote: (productId: string, competitorSiteId: string | null, quantity: number, date?: string) =>
    fetch("/api/checkout-quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, competitorSiteId, quantity, date: date || null }),
    }).then((r) => json<CheckoutQuote>(r)),
};
