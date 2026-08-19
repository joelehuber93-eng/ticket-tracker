import "dotenv/config";
import { prisma } from "./prisma";

async function main() {
  console.log("Seeding demo data...");

  await prisma.productSite.deleteMany();
  await prisma.competitorPrice.deleteMany();
  await prisma.product.deleteMany();
  await prisma.competitorSite.deleteMany();

  const products = await Promise.all([
    prisma.product.create({
      data: { name: "Wireless Mouse", sku: "WM-100", ourPrice: 24.99 },
    }),
    prisma.product.create({
      data: { name: "Mechanical Keyboard", sku: "MK-200", ourPrice: 89.99 },
    }),
    prisma.product.create({
      data: { name: "USB-C Hub", sku: "UCH-300", ourPrice: 34.99 },
    }),
  ]);

  // Mock competitor sites: no real network calls, just jittered prices around
  // a base so the dashboard has live, changing disparities to show off.
  // Swap kind to "api" or "scraper" and point targetUrl/selector at a real
  // endpoint or product page once you have competitors to track.
  const sites = await Promise.all([
    prisma.competitorSite.create({
      data: { name: "CompetitorA", kind: "mock", targetUrl: "mock://competitor-a", selector: "" },
    }),
    prisma.competitorSite.create({
      data: { name: "CompetitorB", kind: "mock", targetUrl: "mock://competitor-b", selector: "" },
    }),
  ]);

  const baseFor: Record<string, number> = {
    "Wireless Mouse": 24.99,
    "Mechanical Keyboard": 89.99,
    "USB-C Hub": 34.99,
  };

  for (const product of products) {
    for (const [i, site] of sites.entries()) {
      // give each competitor a slightly different base price so disparities show up
      const skew = i === 0 ? 1.08 : 0.94;
      const base = Math.round(baseFor[product.name] * skew * 100) / 100;
      await prisma.productSite.create({
        data: {
          productId: product.id,
          competitorSiteId: site.id,
          url: `mock://${site.name}/${product.sku}?base=${base}&volatility=0.06`,
        },
      });
    }
  }

  console.log(`Seeded ${products.length} products x ${sites.length} competitor sites.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
