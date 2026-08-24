import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { fetchCheckoutTotal } from "../adapters/checkoutAdapter";

export const checkoutQuotesRouter = Router();

// Latest quotes per (product, quantity) — used to populate the checkout
// pricing page. Optionally scoped to one product via ?productId=.
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
  quantity: z.number().int().min(1).max(20),
});

// Drives a real add-to-cart -> checkout run for `quantity` tickets of a
// product and persists the all-in total it finds. Synchronous and slow (a
// real headless-browser run, several seconds) — deliberately not part of
// the cron price-check cycle, see adapters/checkoutAdapter.ts.
checkoutQuotesRouter.post("/", async (req, res) => {
  const parsed = runInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { productId, quantity } = parsed.data;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (!product.checkoutUrl) {
    return res.status(400).json({ error: "This product has no checkoutUrl configured yet" });
  }

  const result = await fetchCheckoutTotal(product.checkoutUrl, quantity);

  const quote = await prisma.checkoutQuote.create({
    data: {
      productId,
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
