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
import { getAdapter } from "./adapters";

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

/**
 * Checks every tracked (product, competitor site) pair once: fetches the
 * current price via the site's adapter, persists it, and — if an io server
 * is passed — broadcasts a live update with the computed disparity.
 */
export async function runPriceCheck(io?: SocketIOServer): Promise<CheckRunSummary> {
  const startedAt = new Date();
  const pairs = await prisma.productSite.findMany({
    include: { product: true, competitorSite: true },
  });

  let checked = 0;
  let failed = 0;

  await Promise.all(
    pairs.map(async (pair) => {
      const adapter = getAdapter(pair.competitorSite.kind);
      const url = pair.url || pair.competitorSite.targetUrl;
      const result = await adapter.fetchPrice({ url, selector: pair.competitorSite.selector });

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

      checked += 1;
      if (!result.ok) failed += 1;

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
            targetUrl: pair.competitorSite.targetUrl,
            selector: pair.competitorSite.selector,
            createdAt: pair.competitorSite.createdAt.toISOString(),
          },
        };
        io.emit(SOCKET_EVENTS.PRICE_UPDATE, payload);
      }
    })
  );

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
