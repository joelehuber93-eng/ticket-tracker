import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";

export const sitesRouter = Router();

const siteInput = z.object({
  name: z.string().min(1),
  kind: z.enum(["api", "scraper", "mock"]),
  targetUrl: z.string().min(1),
  selector: z.string().min(1),
});

sitesRouter.get("/", async (_req, res) => {
  const sites = await prisma.competitorSite.findMany({ orderBy: { createdAt: "desc" } });
  res.json(sites);
});

sitesRouter.post("/", async (req, res) => {
  const parsed = siteInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const site = await prisma.competitorSite.create({ data: parsed.data });
  res.status(201).json(site);
});

sitesRouter.delete("/:id", async (req, res) => {
  await prisma.competitorSite.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

const linkInput = z.object({
  productId: z.string().min(1),
  competitorSiteId: z.string().min(1),
  url: z.string().optional().default(""),
});

// Track a (product, competitor site) pair so the scheduler will check it.
sitesRouter.post("/links", async (req, res) => {
  const parsed = linkInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const link = await prisma.productSite.create({ data: parsed.data });
  res.status(201).json(link);
});

sitesRouter.delete("/links/:id", async (req, res) => {
  await prisma.productSite.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
