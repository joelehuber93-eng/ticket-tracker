import { Router } from "express";
import type { Server as SocketIOServer } from "socket.io";
import { prisma } from "../prisma";
import { runPriceCheck, computeDisparity, wasPriceChangedInLast24h } from "../priceChecker";

export const checksRouter = Router();

checksRouter.post("/run", async (req, res) => {
  const io = req.app.locals.io as SocketIOServer | undefined;
  const summary = await runPriceCheck(io);
  res.json(summary);
});

// Latest known price per (product, competitor site) pair, with disparity —
// used to populate the dashboard on initial load, before any live updates
// have arrived over the socket.
checksRouter.get("/dashboard", async (_req, res) => {
  const pairs = await prisma.productSite.findMany({
    include: {
      product: true,
      competitorSite: true,
    },
  });

  const rows = await Promise.all(
    pairs.map(async (pair) => {
      const latest = await prisma.competitorPrice.findFirst({
        where: { productId: pair.productId, competitorSiteId: pair.competitorSiteId },
        orderBy: { fetchedAt: "desc" },
      });

      const disparity =
        latest?.ok && latest.price != null
          ? computeDisparity(pair.productId, pair.competitorSiteId, pair.product.ourPrice, latest.price)
          : null;
      const priceChanged =
        latest?.ok && latest.price != null
          ? await wasPriceChangedInLast24h(pair.productId, pair.competitorSiteId, latest.price)
          : false;

      // Real all-in checkout total for a single ticket, if one has ever been
      // run for this pair — checkout runs are manual (a real headless-browser
      // launch per check, see checkoutQuotes.ts), so this is whatever the
      // last "Get price"/"Refresh" click on the Checkout Pricing page found,
      // not a live-refreshed value. Distinct from `latest` above, which is
      // the cheap, auto-refreshed "starting at" scrape.
      const checkoutQuote = await prisma.checkoutQuote.findFirst({
        where: { productId: pair.productId, competitorSiteId: pair.competitorSiteId, quantity: 1, ok: true },
        orderBy: { fetchedAt: "desc" },
      });

      return {
        product: pair.product,
        site: pair.competitorSite,
        latest,
        disparity,
        priceChanged,
        checkoutQuote,
      };
    })
  );

  res.json(rows);
});
