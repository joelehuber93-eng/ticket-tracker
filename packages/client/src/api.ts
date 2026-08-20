import type { CompetitorPrice, CompetitorSite, DisparityInfo, Product } from "@price-tracker/shared";

export interface DashboardRow {
  product: Product;
  site: CompetitorSite;
  latest: CompetitorPrice | null;
  disparity: DisparityInfo | null;
  // True when latest.price differs from the price ~24h ago for this pair.
  priceChanged: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  getDashboard: () => fetch("/api/checks/dashboard").then((r) => json<DashboardRow[]>(r)),
  runCheckNow: () => fetch("/api/checks/run", { method: "POST" }).then((r) => json(r)),
  getProducts: () => fetch("/api/products").then((r) => json<Product[]>(r)),
  getSites: () => fetch("/api/sites").then((r) => json<CompetitorSite[]>(r)),
};
