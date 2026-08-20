import type { SourceAdapter } from "./types";
import { apiAdapter } from "./apiAdapter";
import { scraperAdapter } from "./scraperAdapter";
import { mockAdapter } from "./mockAdapter";

const adapters: Record<string, SourceAdapter> = {
  api: apiAdapter,
  scraper: scraperAdapter,
  mock: mockAdapter,
};

export function getAdapter(kind: string): SourceAdapter {
  const adapter = adapters[kind];
  if (!adapter) throw new Error(`Unknown source adapter kind: "${kind}"`);
  return adapter;
}

export * from "./types";
export * from "./listingAdapter";
export * from "./browserAdapter";
