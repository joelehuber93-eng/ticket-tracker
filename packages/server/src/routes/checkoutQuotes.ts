import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { fetchCheckoutTotal, parseCheckoutConfig } from "../adapters/checkoutAdapter";

export const checkoutQuotesRouter = Router();

// Sites a product's checkout total can actually be run against right now:
// our own site (Product.checkoutUrl) plus any linked competitor that has
// both a ProductSite.checkoutUrl and a CompetitorSite.checkoutSelector
// configured. competitorSiteId: null means "our own site" throughout this
// router — mirrored in CheckoutQuote the same way.
checkoutQuotesRouter.get("/targets", async (req, res) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  if (!productId) return res.status(400).json({ error: "productId is required" });

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const targets: { competitorSiteId: string | null; name: string }[] = [];
  if (product.checkoutUrl) {
    targets.push({ competitorSiteId: null, name: "iBranson (ourselves)" });
  }

  const links = await prisma.productSite.findMany({
    where: { productId, checkoutUrl: { not: null } },
    include: { competitorSite: true },
  });
  for (const link of links) {
    if (link.competitorSite.checkoutSelector) {
      targets.push({ competitorSiteId: link.competitorSiteId, name: link.competitorSite.name });
    }
  }

  res.json(targets);
});

// Latest quotes across all sites — used to populate the checkout pricing
// page. Optionally scoped to one product via ?productId=.
checkoutQuotesRouter.get("/", async (req, res) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const quotes = await prisma.checkoutQuote.findMany({
    where: productId ? { productId } : undefined,
    orderBy: { fetchedAt: "desc" },
    take: 200,
  });
  res.json(quotes);
});

const runInput = z.object({
  productId: z.string().min(1),
  // Absent/null means "run against our own site" — see GET /targets above.
  competitorSiteId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(20),
});

// Drives a real add-to-cart -> checkout run for `quantity` tickets of a
// product (on our own site, or a configured competitor's) and persists the
// all-in total it finds. Synchronous and slow (a real headless-browser run,
// several seconds) — deliberately not part of the cron price-check cycle,
// see adapters/checkoutAdapter.ts.
checkoutQuotesRouter.post("/", async (req, res) => {
  const parsed = runInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { productId, quantity } = parsed.data;
  const competitorSiteId = parsed.data.competitorSiteId ?? null;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  let showUrl: string | null;
  let config: Parameters<typeof fetchCheckoutTotal>[2];

  if (!competitorSiteId) {
    showUrl = product.checkoutUrl;
    config = undefined; // fetchCheckoutTotal defaults to IBRANSON_CHECKOUT_CONFIG
  } else {
    const site = await prisma.competitorSite.findUnique({ where: { id: competitorSiteId } });
    if (!site) return res.status(404).json({ error: "Competitor site not found" });
    if (!site.checkoutSelector) {
      return res.status(400).json({ error: "This competitor site has no checkout config yet" });
    }
    config = parseCheckoutConfig(site.checkoutSelector) ?? undefined;
    if (!config) {
      return res.status(400).json({ error: "Competitor site's checkoutSelector is not valid CheckoutConfig JSON" });
    }
    const link = await prisma.productSite.findUnique({
      where: { productId_competitorSiteId: { productId, competitorSiteId } },
    });
    showUrl = link?.checkoutUrl ?? null;
  }

  if (!showUrl) {
    return res.status(400).json({
      error: competitorSiteId
        ? "No checkoutUrl configured for this product on this competitor site"
        : "This product has no checkoutUrl configured yet",
    });
  }

  const result = await fetchCheckoutTotal(showUrl, quantity, config);

  const quote = await prisma.checkoutQuote.create({
    data: {
      productId,
      competitorSiteId,
      quantity,
      subtotal: result.subtotal,
      taxesFees: result.taxesFees,
      total: result.total,
      currency: result.currency,
      ok: result.ok,
      error: result.error,
    },
  });

  res.status(201).json(quote);
});
