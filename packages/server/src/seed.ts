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
  kind: "api" | "scraper" | "listing" | "browser";
  notes: string;
  /** JSON config for "listing"/"browser" kinds; leave unset ("") until configured. */
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

// The rest of these listing configs were derived the same way — the operator
// pasted real card markup from each site's shows listing page on 2026-08-19.
// See ListingConfig / fetchListing in adapters/listingAdapter.ts: "name" and
// "price" are CSS selectors by default, or "@attr" / "selector@attr" to read
// an attribute instead of text content (used where the site embeds the price
// in a data-* attribute rather than visible text).

const DISCOVERBRANSON_LISTING_CONFIG = JSON.stringify({
  card: ".single-product",
  name: ".fs-4.fw-bolder a",
  price: ".fs-3.lh-1.text-dark",
});

const BRANSONTOURISMCENTER_LISTING_CONFIG = JSON.stringify({
  card: ".shows-listing",
  name: "h3 a",
  price: ".price .amount",
});

// Reserve Branson runs a white-labeled Tripster/REX booking widget. Its show
// cards carry the name/price as plain HTML attributes (data-prod-name,
// data-prod-price) rather than in visible text, which is unusually scraper-
// friendly for a widget-based site.
const RESERVEBRANSON_LISTING_CONFIG = JSON.stringify({
  card: ".item-container",
  name: "@data-prod-name",
  price: "@data-prod-price",
});

// Standard WooCommerce shop loop. ".bto" is their "buy today online" (sale)
// price, matched against our own "starting at" pricing.
const TRAVELOFFICE_LISTING_CONFIG = JSON.stringify({
  card: "li.product",
  name: ".woocommerce-loop-product__title",
  price: ".price-single .bto",
});

// TripAdvisor uses stable data-automation test hooks for its shelf cards,
// which is a nice change from its heavily-hashed CSS classes elsewhere. That
// said, TripAdvisor is known to rate-limit / bot-detect server-side fetches —
// if this starts failing consistently (not just occasionally), switch to the
// TripAdvisor Content API instead of chasing selectors.
const TRIPADVISOR_LISTING_CONFIG = JSON.stringify({
  card: '[data-automation="shelfCard"]',
  name: '[data-automation="cardTitle"]',
  price: '[data-automation="cardPrice"]',
});

// The competitors the operator has supplied real page markup for, out of the
// original 23-name list — the rest were dropped rather than kept as guesses
// (see git history for the full original list if they're wanted back later).
// Most are seeded as configured *listing* sources (auto-linked to every
// product below); a few (Viator, GetYourGuide, Trip.com, Expedia, All Access
// Branson) were inspected but couldn't be wired up as scrapers — see notes.
const COMPETITORS: SiteSeed[] = [
  // --- Direct Branson ticket & vacation competitors ---
  {
    name: "Branson.com",
    targetUrl: "https://www.branson.com/shows/",
    category: "direct",
    kind: "browser",
    selector: BRANSON_COM_LISTING_CONFIG,
    notes:
      "Our biggest direct competitor. Listing page — one page lists every show. Card=.shows-listing__content, name=.shows-listing__title, price=.shows-listing__price-value. Matched to our products by name. A plain fetch gets HTTP 403 even with a real browser User-Agent (real bot protection, not just header filtering), so this renders via a headless browser (see adapters/browserAdapter.ts) instead — confirmed working in production on 2026-08-20. Not guaranteed to keep working if their bot detection gets more aggressive later.",
  },
  {
    name: "Save On Branson / Branson Show Tickets",
    targetUrl: "https://www.bransonshowtickets.com/shows",
    category: "direct",
    kind: "scraper",
    notes:
      "Confirmed via view-source on 2026-08-20: the show list is rendered client-side by JavaScript and isn't present in the raw HTML at all (a show's own name doesn't appear in the page source), so no plain-fetch selector — listing or otherwise — can ever see it. Same category as Viator/GetYourGuide; needs a headless-browser adapter (e.g. Playwright) or their own API, not more selector tuning.",
  },
  {
    name: "Discover Branson",
    targetUrl: "https://www.discoverbranson.com/shows",
    category: "direct",
    kind: "listing",
    selector: DISCOVERBRANSON_LISTING_CONFIG,
    notes:
      "Listing page (inferred URL — verify with POST /:id/preview-listing). Card=.single-product, name=.fs-4.fw-bolder a, price=.fs-3.lh-1.text-dark (their current/sale price, not the struck-through original).",
  },
  {
    name: "Branson Tourism Center",
    targetUrl: "https://www.bransontourismcenter.com/shows",
    category: "direct",
    kind: "listing",
    selector: BRANSONTOURISMCENTER_LISTING_CONFIG,
    notes:
      "Listing page (inferred URL — verify with POST /:id/preview-listing). Card=.shows-listing, name=h3 a, price=.price .amount — clean, unhashed markup.",
  },
  {
    name: "All Access Branson",
    targetUrl: "https://www.allaccessbranson.com",
    category: "direct",
    kind: "scraper",
    notes:
      "Old-school nested <table> markup, not a repeating card list — each show is its own ad hoc table with a tier-by-tier price breakdown (regular vs. \"Your Price\") and no single reliable listing URL was confirmed. Needs a per-show selector, not a listing config; hold off until someone can confirm the results-page URL.",
  },
  {
    name: "Reserve Branson",
    targetUrl: "https://www.reservebranson.com/branson/shows",
    category: "direct",
    kind: "listing",
    selector: RESERVEBRANSON_LISTING_CONFIG,
    notes:
      "Runs a white-labeled Tripster/REX widget whose cards carry data-prod-name/data-prod-price attributes directly in the HTML — unusually scraper-friendly. targetUrl confirmed by the operator on 2026-08-20 (the root domain doesn't render the show list; /branson/shows does).",
  },

  // --- National / international OTAs ---
  {
    name: "Viator",
    targetUrl: "https://www.viator.com",
    category: "ota",
    kind: "api",
    notes:
      "Confirmed via pasted card markup on 2026-08-19: uses Vue with hashed, per-build CSS-module class names (e.g. \"_price_gk8xl_508\") and no stable listing wrapper. Use the Viator Partner API instead — not realistically scrapable.",
  },
  {
    name: "GetYourGuide",
    targetUrl: "https://www.getyourguide.com",
    category: "ota",
    kind: "api",
    notes:
      "Confirmed via pasted card markup on 2026-08-19: server-rendered but every element ID/class is tied to a per-product numeric ID with no stable pattern across products. Use the GetYourGuide Partner API instead.",
  },
  {
    name: "Trip.com",
    targetUrl: "https://www.trip.com",
    category: "ota",
    kind: "api",
    notes:
      "Confirmed via pasted show-detail markup on 2026-08-19: custom \"xtaro-xview\" web components with hashed CSS-module classes, same problem as Viator. Use Trip.com's affiliate/partner API if available.",
  },
  { name: "Expedia", targetUrl: "https://www.expedia.com", category: "ota", kind: "api", notes: "Confirmed via pasted markup on 2026-08-19: activity cards are bare links with no price rendered server-side. Use the Expedia Rapid (partner) API; JS-rendered site with bot protection." },
  {
    name: "TripAdvisor",
    targetUrl: "https://www.tripadvisor.com/Attractions-g44160-Activities-c42-Branson_Missouri.html",
    category: "ota",
    kind: "browser",
    selector: TRIPADVISOR_LISTING_CONFIG,
    notes:
      "Confirmed via pasted markup on 2026-08-19: unlike Viator/GetYourGuide, TripAdvisor's activity shelf cards use stable data-automation test hooks (shelfCard/cardTitle/cardPrice) rather than hashed classes — but that markup turned out not to matter. A plain fetch got HTTP 403 (same as Branson.com), so this was switched to kind: \"browser\" — but unlike Branson.com, the headless browser itself got blocked too: confirmed on 2026-08-20 that the rendered page comes back with an empty body and a placeholder title (\"tripadvisor.com\"), not real content. TripAdvisor's bot detection beats a plain headless Chromium; the real fix is the TripAdvisor Content API or a third-party scraping service (e.g. ScraperAPI/ScrapingBee), not more adapter tuning. Currently still linked and configured but failing every check.",
  },

  // --- Branson info / tourism sites (may not sell tickets directly) ---
  {
    name: "Branson Travel Office",
    targetUrl: "https://traveloffice.org/book/branson-shows/",
    category: "info",
    kind: "listing",
    selector: TRAVELOFFICE_LISTING_CONFIG,
    notes:
      "Confirmed via pasted markup on 2026-08-19: this DOES sell tickets directly — a standard WooCommerce shop with ~93 shows listed on one page. Card=li.product, name=.woocommerce-loop-product__title, price=.price-single .bto (their sale/\"buy today online\" price). Also browsable at explorebranson.com.",
  },
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

  // Any real competitor that's already configured (non-empty selector) gets
  // linked to every product too, so it's tracked from the moment you seed.
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
    } still need setup).`
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
