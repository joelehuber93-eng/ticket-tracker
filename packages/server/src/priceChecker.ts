import type { Server as SocketIOServer } from "socket.io";
import {
  classifyDisparity,
  SOCKET_EVENTS,
  type CheckRunSummary,
  type CompetitorPrice as SharedCompetitorPrice,
  type DisparityInfo,
  type PriceUpdateEvent,
} from "@price-tracker/shared";
import { prisma } from "./prisma";
import { getAdapter, type FetchPriceResult } from "./adapters";
import { fetchListing, matchListingEntry, parseListingConfig } from "./adapters/listingAdapter";
import { fetchListingViaBrowser } from "./adapters/browserAdapter";

/** Kinds fetched once per site (not once per product) via a listing config. */
const LISTING_LIKE_KINDS = new Set(["listing", "browser"]);

type PairWithRelations = Awaited<ReturnType<typeof loadPairs>>[number];

async function loadPairs() {
  return prisma.productSite.findMany({ include: { product: true, competitorSite: true } });
}

function toSharedPrice(row: {
  id: string;
  productId: string;
  competitorSiteId: string;
  price: number | null;
  currency: string;
  fetchedAt: Date;
  ok: boolean;
  error: string | null;
}): SharedCompetitorPrice {
  return {
    id: row.id,
    productId: row.productId,
    competitorSiteId: row.competitorSiteId,
    price: row.price,
    currency: row.currency,
    fetchedAt: row.fetchedAt.toISOString(),
    ok: row.ok,
    error: row.error,
  };
}

export function computeDisparity(
  productId: string,
  competitorSiteId: string,
  ourPrice: number,
  competitorPrice: number
): DisparityInfo {
  const deltaAbsolute = Math.round((ourPrice - competitorPrice) * 100) / 100;
  const deltaPercent =
    competitorPrice === 0 ? 0 : Math.round((deltaAbsolute / competitorPrice) * 10000) / 100;
  const direction = deltaAbsolute < 0 ? "we_cheaper" : deltaAbsolute > 0 ? "we_pricier" : "match";
  return {
    productId,
    competitorSiteId,
    ourPrice,
    competitorPrice,
    deltaAbsolute,
    deltaPercent,
    direction,
    severity: classifyDisparity(Math.abs(deltaPercent)),
  };
}

/** Persists one fetch result and broadcasts it over the socket, if given. */
async function recordResult(
  pair: PairWithRelations,
  result: FetchPriceResult,
  io: SocketIOServer | undefined
): Promise<boolean> {
  const saved = await prisma.competitorPrice.create({
    data: {
      productId: pair.productId,
      competitorSiteId: pair.competitorSiteId,
      price: result.price,
      currency: result.currency,
      ok: result.ok,
      error: result.error,
    },
  });

  if (io) {
    const disparity =
      result.ok && result.price != null
        ? computeDisparity(pair.productId, pair.competitorSiteId, pair.product.ourPrice, result.price)
        : null;

    const payload: PriceUpdateEvent = {
      price: toSharedPrice(saved),
      disparity,
      product: {
        id: pair.product.id,
        name: pair.product.name,
        sku: pair.product.sku,
        ourPrice: pair.product.ourPrice,
        currency: pair.product.currency,
        createdAt: pair.product.createdAt.toISOString(),
      },
      site: {
        id: pair.competitorSite.id,
        name: pair.competitorSite.name,
        kind: pair.competitorSite.kind as PriceUpdateEvent["site"]["kind"],
        category: pair.competitorSite.category as PriceUpdateEvent["site"]["category"],
        targetUrl: pair.competitorSite.targetUrl,
        selector: pair.competitorSite.selector,
        notes: pair.competitorSite.notes,
        createdAt: pair.competitorSite.createdAt.toISOString(),
      },
    };
    io.emit(SOCKET_EVENTS.PRICE_UPDATE, payload);
  }

  return result.ok;
}

/**
 * Checks every tracked (product, competitor site) pair once: fetches the
 * current price via the site's adapter, persists it, and — if an io server
 * is passed — broadcasts a live update with the computed disparity.
 *
 * "listing" and "browser" sites (one page listing many shows) are fetched
 * once per site, not once per product, and results are matched back to
 * products by name — see adapters/listingAdapter and adapters/browserAdapter
 * ("browser" renders with a real headless browser first, for sites that
 * block or don't render for a plain HTTP fetch).
 */
export async function runPriceCheck(io?: SocketIOServer): Promise<CheckRunSummary> {
  const startedAt = new Date();
  const pairs = await loadPairs();

  let checked = 0;
  let failed = 0;
  const tally = (ok: boolean) => {
    checked += 1;
    if (!ok) failed += 1;
  };

  const singlePairs = pairs.filter((p) => !LISTING_LIKE_KINDS.has(p.competitorSite.kind));
  const listingGroups = new Map<string, PairWithRelations[]>();
  for (const pair of pairs) {
    if (!LISTING_LIKE_KINDS.has(pair.competitorSite.kind)) continue;
    const group = listingGroups.get(pair.competitorSiteId) ?? [];
    group.push(pair);
    listingGroups.set(pair.competitorSiteId, group);
  }

  await Promise.all([
    ...singlePairs.map(async (pair) => {
      const adapter = getAdapter(pair.competitorSite.kind);
      const url = pair.url || pair.competitorSite.targetUrl;
      const result = await adapter.fetchPrice({ url, selector: pair.competitorSite.selector });
      tally(await recordResult(pair, result, io));
    }),
    ...Array.from(listingGroups.values()).map(async (group) => {
      const site = group[0].competitorSite;
      const config = parseListingConfig(site.selector);
      const url = site.targetUrl;

      if (!config) {
        await Promise.all(
          group.map((pair) =>
            recordResult(
              pair,
              {
                ok: false,
                price: null,
                currency: "USD",
                error: 'Listing selector not configured (expected JSON {"card","name","price"})',
              },
              io
            ).then(tally)
          )
        );
        return;
      }

      const listing = site.kind === "browser" ? await fetchListingViaBrowser(url, config) : await fetchListing(url, config);

      await Promise.all(
        group.map((pair) => {
          if (!listing.ok) {
            return recordResult(
              pair,
              { ok: false, price: null, currency: "USD", error: listing.error },
              io
            ).then(tally);
          }
          const match = matchListingEntry(pair.product.name, listing.entries);
          const result: FetchPriceResult = match
            ? { ok: true, price: match.price, currency: "USD", error: null }
            : { ok: false, price: null, currency: "USD", error: `No listing entry matched "${pair.product.name}"` };
          return recordResult(pair, result, io).then(tally);
        })
      );
    }),
  ]);

  const finishedAt = new Date();
  const summary: CheckRunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    checked,
    failed,
  };

  if (io) io.emit(SOCKET_EVENTS.CHECK_RUN_COMPLETE, summary);

  return summary;
}
