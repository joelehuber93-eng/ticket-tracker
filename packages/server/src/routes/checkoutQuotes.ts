import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import {
  fetchCheckoutTotal,
  fetchAvailableDates,
  parseCheckoutConfig,
  type CheckoutQuoteResult,
  type AvailableDatesResult,
} from "../adapters/checkoutAdapter";
import {
  fetchSidecartCheckoutTotal,
  fetchAvailableSidecartDates,
  parseSidecartCheckoutConfig,
} from "../adapters/sidecartCheckoutAdapter";
import {
  fetchModalCheckoutTotal,
  fetchAvailableModalDates,
  parseModalCheckoutConfig,
} from "../adapters/modalCheckoutAdapter";
import { fetchRexCheckoutTotal, fetchAvailableRexDates, parseRexCheckoutConfig } from "../adapters/rexCheckoutAdapter";

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
    if (link.competitorSite.checkoutSelector && link.competitorSite.checkoutKind) {
      targets.push({ competitorSiteId: link.competitorSiteId, name: link.competitorSite.name });
    }
  }

  res.json(targets);
});

// Showtime dates actually offered right now for a product on a given site
// (competitorSiteId omitted/empty means "our own site" — same convention as
// everywhere else in this router). Lets the client restrict its date picker
// to real dates instead of the user guessing and getting a "no showtime on
// that date" error back from a full (much slower) checkout run.
checkoutQuotesRouter.get("/available-dates", async (req, res) => {
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  if (!productId) return res.status(400).json({ error: "productId is required" });
  const competitorSiteId =
    typeof req.query.competitorSiteId === "string" && req.query.competitorSiteId ? req.query.competitorSiteId : null;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  let showUrl: string | null = null;
  let result: AvailableDatesResult | null = null;

  if (!competitorSiteId) {
    showUrl = product.checkoutUrl;
    if (showUrl) result = await fetchAvailableDates(showUrl);
  } else {
    const site = await prisma.competitorSite.findUnique({ where: { id: competitorSiteId } });
    if (!site) return res.status(404).json({ error: "Competitor site not found" });
    if (!site.checkoutSelector || !site.checkoutKind) {
      return res.status(400).json({ error: "This competitor site has no checkout config yet" });
    }
    const link = await prisma.productSite.findUnique({
      where: { productId_competitorSiteId: { productId, competitorSiteId } },
    });
    showUrl = link?.checkoutUrl ?? null;

    if (showUrl) {
      if (site.checkoutKind === "sidecart") {
        const config = parseSidecartCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res
            .status(400)
            .json({ error: "Competitor site's checkoutSelector is not valid SidecartCheckoutConfig JSON" });
        }
        result = await fetchAvailableSidecartDates(showUrl, config);
      } else if (site.checkoutKind === "pageflow") {
        const config = parseCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res
            .status(400)
            .json({ error: "Competitor site's checkoutSelector is not valid CheckoutConfig JSON" });
        }
        result = await fetchAvailableDates(showUrl, config);
      } else if (site.checkoutKind === "modal") {
        const config = parseModalCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res
            .status(400)
            .json({ error: "Competitor site's checkoutSelector is not valid ModalCheckoutConfig JSON" });
        }
        result = await fetchAvailableModalDates(showUrl, config);
      } else if (site.checkoutKind === "rex") {
        const config = parseRexCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res
            .status(400)
            .json({ error: "Competitor site's checkoutSelector is not valid RexCheckoutConfig JSON" });
        }
        result = await fetchAvailableRexDates(showUrl, config);
      } else {
        return res.status(400).json({ error: `Unknown checkoutKind "${site.checkoutKind}"` });
      }
    }
  }

  if (!showUrl || !result) {
    return res.status(400).json({
      error: competitorSiteId
        ? "No checkoutUrl configured for this product on this competitor site"
        : "This product has no checkoutUrl configured yet",
    });
  }
  if (!result.ok) {
    return res.status(502).json({ error: result.error ?? "Could not load available dates" });
  }

  res.json({ dates: result.dates });
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
  // "YYYY-MM-DD" — absent/null means "earliest available date" (previous
  // behavior). When given, the adapter fails clearly if that date isn't
  // actually offered rather than silently falling back to another one.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .nullable()
    .optional(),
});

// Drives a real add-to-cart -> checkout run for `quantity` tickets of a
// product (on our own site, or a configured competitor's) and persists the
// all-in total it finds. Synchronous and slow (a real headless-browser run,
// several seconds) — deliberately not part of the cron price-check cycle.
//
// Four competitor checkout shapes exist (CompetitorSite.checkoutKind):
// "pageflow" (checkoutAdapter.ts — separate page navigations per step, like
// ibranson.com), "sidecart" (sidecartCheckoutAdapter.ts — one in-page
// widget panel, no navigation, like branson.com), "modal"
// (modalCheckoutAdapter.ts — a calendar click opens a ticket-selection
// modal, like saveonbranson.com), and "rex" (rexCheckoutAdapter.ts — a
// "Select Tickets" click expands an in-page order box with no modal, like
// reservebranson.com's white-labeled Tripster/REX widget). Our own site is
// always pageflow (IBRANSON_CHECKOUT_CONFIG).
checkoutQuotesRouter.post("/", async (req, res) => {
  const parsed = runInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { productId, quantity } = parsed.data;
  const competitorSiteId = parsed.data.competitorSiteId ?? null;
  const date = parsed.data.date ?? undefined;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  let showUrl: string | null = null;
  let result: CheckoutQuoteResult | null = null;

  if (!competitorSiteId) {
    showUrl = product.checkoutUrl;
    if (showUrl) result = await fetchCheckoutTotal(showUrl, quantity, undefined, date);
  } else {
    const site = await prisma.competitorSite.findUnique({ where: { id: competitorSiteId } });
    if (!site) return res.status(404).json({ error: "Competitor site not found" });
    if (!site.checkoutSelector || !site.checkoutKind) {
      return res.status(400).json({ error: "This competitor site has no checkout config yet" });
    }
    const link = await prisma.productSite.findUnique({
      where: { productId_competitorSiteId: { productId, competitorSiteId } },
    });
    showUrl = link?.checkoutUrl ?? null;

    if (showUrl) {
      if (site.checkoutKind === "sidecart") {
        const config = parseSidecartCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res.status(400).json({ error: "Competitor site's checkoutSelector is not valid SidecartCheckoutConfig JSON" });
        }
        result = await fetchSidecartCheckoutTotal(showUrl, quantity, config, date);
      } else if (site.checkoutKind === "pageflow") {
        const config = parseCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res.status(400).json({ error: "Competitor site's checkoutSelector is not valid CheckoutConfig JSON" });
        }
        result = await fetchCheckoutTotal(showUrl, quantity, config, date);
      } else if (site.checkoutKind === "modal") {
        const config = parseModalCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res.status(400).json({ error: "Competitor site's checkoutSelector is not valid ModalCheckoutConfig JSON" });
        }
        result = await fetchModalCheckoutTotal(showUrl, quantity, config, date);
      } else if (site.checkoutKind === "rex") {
        const config = parseRexCheckoutConfig(site.checkoutSelector);
        if (!config) {
          return res.status(400).json({ error: "Competitor site's checkoutSelector is not valid RexCheckoutConfig JSON" });
        }
        result = await fetchRexCheckoutTotal(showUrl, quantity, config, date);
      } else {
        return res.status(400).json({ error: `Unknown checkoutKind "${site.checkoutKind}"` });
      }
    }
  }

  if (!showUrl || !result) {
    return res.status(400).json({
      error: competitorSiteId
        ? "No checkoutUrl configured for this product on this competitor site"
        : "This product has no checkoutUrl configured yet",
    });
  }

  const quote = await prisma.checkoutQuote.create({
    data: {
      productId,
      competitorSiteId,
      quantity,
      date: result.date,
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
