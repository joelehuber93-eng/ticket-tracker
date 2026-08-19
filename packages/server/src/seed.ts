import "dotenv/config";
import { prisma } from "./prisma";

// Real iBranson show catalog (pasted from ibranson.com/shows-in-branson-missouri/,
// 2026-08-19). Prices are the site's "tickets starting at" rate.
const IBRANSON_SHOWS: Array<{ name: string; sku: string; ourPrice: number }> = [
  { name: "The Haygoods", sku: "haygoods", ourPrice: 47.64 },
  { name: "Duttons", sku: "duttons", ourPrice: 43.38 },
  { name: "Hughes Music Show", sku: "hughes-music-show", ourPrice: 42.0 },
  { name: "Where Jesus Walked", sku: "where-jesus-walked", ourPrice: 19.56 },
  { name: "SIX", sku: "six", ourPrice: 44.25 },
  { name: "Hamners Unbelievable Variety Show", sku: "hamners-unbelievable-variety-show", ourPrice: 37.55 },
  { name: "Grand Jubilee", sku: "grand-jubilee", ourPrice: 44.25 },
  { name: "Pets and Giggles", sku: "pets-and-giggles", ourPrice: 44.25 },
  { name: "A GARTH Tribute", sku: "a-garth-tribute", ourPrice: 42.98 },
  { name: "Aaron Wayne Comedy Hypnosis Show", sku: "aaron-wayne-comedy-hypnosis-show", ourPrice: 46.64 },
  { name: "Branson Comedy Bash Dinner & Show", sku: "branson-comedy-bash-dinner-show", ourPrice: 50.03 },
  { name: "Dan Wagner Johnny Cash and Friends", sku: "dan-wagner-johnny-cash-and-friends", ourPrice: 42.98 },
  { name: "DAVID.", sku: "david", ourPrice: 59.0 },
  { name: "Dolly Parton's Stampede Dinner Attraction", sku: "dolly-partons-stampede-dinner-attraction", ourPrice: 69.99 },
  { name: "Freedom Journey Experience", sku: "freedom-journey-experience", ourPrice: 15.01 },
  { name: "George Strait Tribute", sku: "george-strait-tribute", ourPrice: 39.7 },
  {
    name: "Great American Chuckwagon Combo Dinner Show and Outdoor Drama",
    sku: "great-american-chuckwagon-combo",
    ourPrice: 79.06,
  },
  { name: "Hits on Route 66 The Heatherlys", sku: "hits-on-route-66-the-heatherlys", ourPrice: 46.64 },
  { name: "Hot Rods & High Heels 1950's Show", sku: "hot-rods-high-heels-1950s-show", ourPrice: 38.17 },
  { name: "Clay Coopers Country Express", sku: "clay-coopers-country-express", ourPrice: 47.79 },
  { name: "Dean Z - The Ultimate Elvis", sku: "dean-z-the-ultimate-elvis", ourPrice: 42.1 },
];

type SiteSeed = {
  name: string;
  targetUrl: string;
  category: "direct" | "ota" | "info";
  kind: "api" | "scraper" | "listing";
  notes: string;
  /** JSON config for "listing" kind; leave unset ("") until configured. */
  selector?: string;
};

// Branson.com lists every show on one page (branson.com/shows/), not a
// dedicated page per show — confirmed 2026-08-19 from the operator pasting
// the real card markup. Card = .shows-listing__content, name =
// .shows-listing__title, price = .shows-listing__price-value.
const BRANSON_COM_LISTING_CONFIG = JSON.stringify({
  card: ".shows-listing__content",
  name: ".shows-listing__title",
  price: ".shows-listing__price-value",
});

// All 23 competitors supplied by the operator. Seeded as configured
// *references* only (selector left blank) — see notes for what each needs
// before the scheduler can track it, EXCEPT Branson.com, which is fully
// wired up (see above) and gets auto-linked to every product below. Linking
// the rest happens via POST /api/sites/links once a source is configured.
const COMPETITORS: SiteSeed[] = [
  // --- Direct Branson ticket & vacation competitors ---
  {
    name: "Branson.com",
    targetUrl: "https://www.branson.com/shows/",
    category: "direct",
    kind: "listing",
    selector: BRANSON_COM_LISTING_CONFIG,
    notes:
      "Listing page — one page lists every show. Card=.shows-listing__content, name=.shows-listing__title, price=.shows-listing__price-value. Matched to our products by name.",
  },
  { name: "Branson Shows", targetUrl: "https://www.bransonshows.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Save On Branson / Branson Show Tickets", targetUrl: "https://www.bransonshowtickets.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson Ticket & Travel", targetUrl: "https://www.bransonticket.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Discover Branson", targetUrl: "https://www.discoverbranson.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson Tourism Center", targetUrl: "https://www.bransontourismcenter.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson Travel Agency", targetUrl: "https://www.bransontravelagency.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson Country Tours", targetUrl: "https://www.bransoncountrytours.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson Travel Group", targetUrl: "https://www.bransontravelgroup.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Branson 2 for 1 Tickets", targetUrl: "https://www.branson2for1tickets.com", category: "direct", kind: "scraper", notes: "Deal-pricing site — confirm whether listed price is per-ticket or per-pair before comparing." },
  { name: "Half Price Tickets Branson", targetUrl: "https://www.halfpriceticketsbranson.com", category: "direct", kind: "scraper", notes: "Deal-pricing site — confirm discount basis before comparing to our list price." },
  { name: "All Access Branson", targetUrl: "https://www.allaccessbranson.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },
  { name: "Book.Branson.com", targetUrl: "https://book.branson.com", category: "direct", kind: "scraper", notes: "Branson.com's booking platform — likely JS-rendered checkout flow; may need a headless-browser adapter instead of plain HTML scraping." },
  { name: "Reserve Branson", targetUrl: "https://www.reservebranson.com", category: "direct", kind: "scraper", notes: "Inspect a show page and set a CSS selector for price." },

  // --- National / international OTAs ---
  { name: "Tripster", targetUrl: "https://www.tripster.com", category: "ota", kind: "scraper", notes: "Check for a partner/affiliate feed before scraping; otherwise inspect a listing page for a price selector." },
  { name: "Viator", targetUrl: "https://www.viator.com", category: "ota", kind: "api", notes: "Use the Viator Partner API — site is JS-rendered/bot-protected, not realistically scrapable." },
  { name: "GetYourGuide", targetUrl: "https://www.getyourguide.com", category: "ota", kind: "api", notes: "Use the GetYourGuide Partner API for the same reason as Viator." },
  { name: "Trip.com", targetUrl: "https://www.trip.com", category: "ota", kind: "api", notes: "Use Trip.com's affiliate/partner API if available; JS-rendered site." },
  { name: "Expedia", targetUrl: "https://www.expedia.com", category: "ota", kind: "api", notes: "Use the Expedia Rapid (partner) API; JS-rendered site with bot protection." },
  { name: "TripAdvisor", targetUrl: "https://www.tripadvisor.com", category: "ota", kind: "api", notes: "Use the TripAdvisor Content API; JS-rendered site with bot protection." },

  // --- Branson info / tourism sites (may not sell tickets directly) ---
  { name: "Explore Branson", targetUrl: "https://www.explorebranson.com", category: "info", kind: "scraper", notes: "Tourism/CVB site — verify it lists ticket prices at all before configuring a selector." },
  { name: "Branson Chamber of Commerce", targetUrl: "https://www.bransonchamber.com", category: "info", kind: "scraper", notes: "Chamber site — likely no direct ticket pricing; may only be useful for market context, not price tracking." },
  { name: "Branson Travel Office", targetUrl: "https://www.traveloffice.org", category: "info", kind: "scraper", notes: "Also browsable at explorebranson.com. Verify it lists ticket prices before configuring a selector." },
];

async function main() {
  console.log("Seeding iBranson demo data...");

  await prisma.productSite.deleteMany();
  await prisma.competitorPrice.deleteMany();
  await prisma.product.deleteMany();
  await prisma.competitorSite.deleteMany();

  const products = await Promise.all(
    IBRANSON_SHOWS.map((show) =>
      prisma.product.create({
        data: { name: show.name, sku: show.sku, ourPrice: show.ourPrice },
      })
    )
  );

  const competitorSites = await Promise.all(
    COMPETITORS.map((site) =>
      prisma.competitorSite.create({
        data: {
          name: site.name,
          kind: site.kind,
          category: site.category,
          targetUrl: site.targetUrl,
          selector: site.selector ?? "",
          notes: site.notes,
        },
      })
    )
  );

  // Two simulated sources so the dashboard shows live, moving disparities
  // out of the box, without pretending any of the 23 real competitors above
  // are actually being scraped yet.
  const demoSites = await Promise.all([
    prisma.competitorSite.create({
      data: {
        name: "Demo Source A (simulated)",
        kind: "mock",
        category: "demo",
        targetUrl: "mock://demo-a",
        selector: "",
        notes: "Simulated data for demoing the live dashboard. Not a real competitor.",
      },
    }),
    prisma.competitorSite.create({
      data: {
        name: "Demo Source B (simulated)",
        kind: "mock",
        category: "demo",
        targetUrl: "mock://demo-b",
        selector: "",
        notes: "Simulated data for demoing the live dashboard. Not a real competitor.",
      },
    }),
  ]);

  for (const [i, product] of products.entries()) {
    for (const [j, site] of demoSites.entries()) {
      // Alternate above/below our price so the demo shows both directions.
      const skew = (i + j) % 2 === 0 ? 1.1 : 0.92;
      const base = Math.round(product.ourPrice * skew * 100) / 100;
      await prisma.productSite.create({
        data: {
          productId: product.id,
          competitorSiteId: site.id,
          url: `mock://${site.name}/${product.sku}?base=${base}&volatility=0.05`,
        },
      });
    }
  }

  // Any real competitor that's already configured (non-empty selector) gets
  // linked to every product too, so it's tracked from the moment you seed —
  // right now that's just Branson.com.
  const configuredSites = competitorSites.filter((site) => site.selector !== "");
  for (const site of configuredSites) {
    for (const product of products) {
      await prisma.productSite.create({
        data: { productId: product.id, competitorSiteId: site.id, url: "" },
      });
    }
  }

  console.log(`Seeded ${products.length} iBranson shows.`);
  console.log(
    `Seeded ${competitorSites.length} real competitor sources (${configuredSites.length} configured + linked, ${
      competitorSites.length - configuredSites.length
    } still need setup) + ${demoSites.length} demo sources (linked, simulated).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
