import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";

export const productsRouter = Router();

const productInput = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  ourPrice: z.number().positive(),
  currency: z.string().min(1).default("USD"),
});

productsRouter.get("/", async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  res.json(products);
});

productsRouter.post("/", async (req, res) => {
  const parsed = productInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const product = await prisma.product.create({ data: parsed.data });
  res.status(201).json(product);
});

productsRouter.delete("/:id", async (req, res) => {
  await prisma.product.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
