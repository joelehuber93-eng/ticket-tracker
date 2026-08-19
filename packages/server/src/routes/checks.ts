import { Router } from "express";
import type { Server as SocketIOServer } from "socket.io";
import { prisma } from "../prisma";
import { runPriceCheck, computeDisparity } from "../priceChecker";

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

      return {
        product: pair.product,
        site: pair.competitorSite,
        latest,
        disparity,
      };
    })
  );

  res.json(rows);
});
