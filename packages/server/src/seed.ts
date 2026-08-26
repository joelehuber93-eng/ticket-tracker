import "dotenv/config";
import { prisma } from "./prisma";

// Real iBranson show catalog (pasted from ibranson.com/shows-in-branson-missouri/,
// 2026-08-19). Prices are the site's "tickets starting at" rate.
// checkoutUrl is the show's page on ibranson.com for the checkout-price-
// discovery adapter to drive (adapters/checkoutAdapter.ts) — the show page
// itself, not the dated/timed ticket URL. Most are now confirmed against the
// real listing page source (pasted by the operator 2026-08-25, page 1 of 2 —
// three guessed slugs turned out wrong: Where Jesus Walked is
// "where-jesus-walked-2", A GARTH Tribute is "a-garth-tribute-2", DAVID. is
// "david-2"). Still an unverified "/shows-in-branson-missouri/{slug}/" guess
// for the shows on page 2 (not yet pasted): The Haygoods, SIX, Grand
// Jubilee, Dan Wagner Johnny Cash and Friends, Dean Z - The Ultimate Elvis.
// A wrong guess just fails cleanly (404 -> "no selectable date/time found")
// the first time someone runs it.
const IBRANSON_SHOWS: Array<{ name: string; sku: string; ourPrice: number; checkoutUrl?: string }> = [
  {
    name: "The Haygoods",
    sku: "haygoods",
    ourPrice: 47.64,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/the-haygoods/",
  },
  {
    name: "Duttons",
    sku: "duttons",
    ourPrice: 43.38,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/duttons/",
  },
  {
    name: "Hughes Music Show",
    sku: "hughes-music-show",
    ourPrice: 42.0,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/hughes-music-show/",
  },
  {
    name: "Where Jesus Walked",
    sku: "where-jesus-walked",
    ourPrice: 19.56,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/where-jesus-walked-2/",
  },
  {
    name: "SIX",
    sku: "six",
    ourPrice: 44.25,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/six/",
  },
  {
    name: "Hamners Unbelievable Variety Show",
    sku: "hamners-unbelievable-variety-show",
    ourPrice: 37.55,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/hamners-unbelievable-variety-show/",
  },
  {
    name: "Grand Jubilee",
    sku: "grand-jubilee",
    ourPrice: 44.25,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/grand-jubilee/",
  },
  {
    name: "Pets and Giggles",
    sku: "pets-and-giggles",
    ourPrice: 44.25,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/pets-and-giggles/",
  },
  {
    name: "A GARTH Tribute",
    sku: "a-garth-tribute",
    ourPrice: 42.98,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/a-garth-tribute-2/",
  },
  {
    name: "Aaron Wayne Comedy Hypnosis Show",
    sku: "aaron-wayne-comedy-hypnosis-show",
    ourPrice: 46.64,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/aaron-wayne-comedy-hypnosis-show/",
  },
  {
    name: "Branson Comedy Bash Dinner & Show",
    sku: "branson-comedy-bash-dinner-show",
    ourPrice: 50.03,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/branson-comedy-bash-dinner-show/",
  },
  {
    name: "Dan Wagner Johnny Cash and Friends",
    sku: "dan-wagner-johnny-cash-and-friends",
    ourPrice: 42.98,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/dan-wagner-johnny-cash-and-friends/",
  },
  {
    name: "DAVID.",
    sku: "david",
    ourPrice: 59.0,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/david-2/",
  },
  {
    name: "Dolly Parton's Stampede Dinner Attraction",
    sku: "dolly-partons-stampede-dinner-attraction",
    ourPrice: 69.99,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/dolly-partons-stampede-dinner-attraction/",
  },
  {
    name: "Freedom Journey Experience",
    sku: "freedom-journey-experience",
    ourPrice: 15.01,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/freedom-journey-experience/",
  },
  {
    name: "George Strait Tribute",
    sku: "george-strait-tribute",
    ourPrice: 39.7,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/george-strait-tribute/",
  },
  {
    name: "Great American Chuckwagon Combo Dinner Show and Outdoor Drama",
    sku: "great-american-chuckwagon-combo",
    ourPrice: 79.06,
    // sku above was shortened by hand — the real slug is guessed from the
    // full show name instead, since the URL is unlikely to be truncated too.
    checkoutUrl:
      "https://ibranson.com/shows-in-branson-missouri/great-american-chuckwagon-combo-dinner-show-and-outdoor-drama/",
  },
  {
    name: "Hits on Route 66 The Heatherlys",
    sku: "hits-on-route-66-the-heatherlys",
    ourPrice: 46.64,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/hits-on-route-66-the-heatherlys/",
  },
  {
    name: "Hot Rods & High Heels 1950's Show",
    sku: "hot-rods-high-heels-1950s-show",
    ourPrice: 38.17,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/hot-rods-high-heels-1950s-show/",
  },
  {
    name: "Clay Coopers Country Express",
    sku: "clay-coopers-country-express",
    ourPrice: 47.79,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/clay-coopers-country-express/",
  },
  {
    name: "Dean Z - The Ultimate Elvis",
    sku: "dean-z-the-ultimate-elvis",
    ourPrice: 42.1,
    checkoutUrl: "https://ibranson.com/shows-in-branson-missouri/dean-z-the-ultimate-elvis/",
  },
];

type SiteSeed = {
  name: string;
  targetUrl: string;
  category: "direct" | "ota" | "info";
  kind: "api" | "scraper" | "listing" | "browser";
  notes: string;
  /** JSON config for "listing"/"browser" kinds; leave unset ("") until configured. */
  selector?: string;
  /** JSON checkout-automation config — see CompetitorSite.checkoutSelector/checkoutKind. */
  checkoutSelector?: string;
  checkoutKind?: "pageflow" | "sidecart" | "modal";
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

// Branson.com's actual checkout — a "sidecart" widget ("sc-" class prefix),
// pasted by the operator on 2026-08-25 for Hughes Music Show. Everything
// happens in one in-page panel with no navigation: click a FullCalendar
// event to open it, pick ticket quantity from a <select>, click add-to-cart,
// and the same panel updates to show the order totals — see
// adapters/sidecartCheckoutAdapter.ts for why this needed its own config
// shape rather than reusing ibranson.com's CheckoutConfig.
const BRANSON_COM_CHECKOUT_CONFIG = JSON.stringify({
  eventSelector: "#fullcalendar a.fc-event:not(.fc-event-past)",
  dateAttribute: "data-date",
  quantitySelectSelector: 'select[data-type="adult"]',
  addToCartButtonSelector: "button.sc-add-to-cart",
  totalLineSelector: ".sc-order-total-line",
  totalLineLabelSelector: ".sc-order-total-label",
  totalLineValueSelector: ".sc-order-total-value",
  totalLabel: "Order Total",
  feesLabel: "Taxes & Fees",
});

// Save On Branson's checkout — a "modal" widget, pasted by the operator on
// 2026-08-26 for Hughes Music Show. Clicking a bookable calendar date/time
// opens a Bootstrap modal listing one row per ticket type (Adult, Child,
// Adult w/ Dinner, ...), each with a per-show randomly-generated <select>
// id, so the right row is matched by its label text ("Adult" — the base
// tier, listed before the dinner-inclusive upgrade tier) rather than a
// fixed selector. See adapters/modalCheckoutAdapter.ts for why this needed
// its own config shape, distinct from both ibranson.com's page-navigation
// flow and branson.com's inline sidecart widget.
const SAVEONBRANSON_CHECKOUT_CONFIG = JSON.stringify({
  calendarSelector: "#BodyContent_CalendarBlock",
  eventSelector: "a.fc-event.fc-event-available",
  dateAttribute: "data-date",
  ticketModalSelector: "#BodyContent_TicketsModal",
  ticketRowSelector: ".form-group",
  ticketLabelSelector: "label",
  ticketLabelMatch: "Adult",
  ticketQuantitySelectSelector: "select",
  addToCartButtonSelector: "#BodyContent_AddToCart",
  totalsPanelSelector: "#BodyContent_CheckOutBlock",
  totalLabel: "Order Total",
  feesLabel: "Tax Recovery",
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

// Same platform/template as bransonshowtickets.com (identical CSS-module
// naming pattern: showlistitem-module--X--HASH) — confirmed via view-source
// on 2026-08-20 to have the same problem, the show list is rendered
// client-side and never appears in the raw HTML. Uses the "browser" kind
// from the start rather than trying a plain fetch we already know will fail.
const SAVEONBRANSON_LISTING_CONFIG = JSON.stringify({
  card: "a.showlistitem-module--listing--Abd_z",
  name: "@title",
  price: ".price",
});

// bransonshowtickets.com itself — real card markup (title="Hughes Music
// Show") pasted by the operator on 2026-08-19, before it was known this
// site renders its show list client-side. Same showlistitem-module--X--HASH
// platform as Save On Branson (confirmed 2026-08-20), so the fix is the
// same: "browser" kind instead of a plain-fetch scraper. Card hash may
// differ from Save On Branson's since they're separate deployments of the
// same template.
const BRANSONSHOWTICKETS_LISTING_CONFIG = JSON.stringify({
  card: "a.showlistitem-module--listing--CwrAJ",
  name: "@title",
  price: ".price",
});

// Standard WooCommerce shop loop. ".bto" is their "buy today online" (sale)
// price, matched against our own "starting at" pricing.
const TRAVELOFFICE_LISTING_CONFIG = JSON.stringify({
  card: "li.product",
  name: ".woocommerce-loop-product__title",
  price: ".price-single .bto",
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
    checkoutSelector: BRANSON_COM_CHECKOUT_CONFIG,
    checkoutKind: "sidecart",
    notes:
      "Our biggest direct competitor. Listing page — one page lists every show. Card=.shows-listing__content, name=.shows-listing__title, price=.shows-listing__price-value. Matched to our products by name. A plain fetch gets HTTP 403 even with a real browser User-Agent (real bot protection, not just header filtering), so this renders via a headless browser (see adapters/browserAdapter.ts) instead — confirmed working in production on 2026-08-20. Not guaranteed to keep working if their bot detection gets more aggressive later. Checkout automation piloted 2026-08-25 for Hughes Music Show (see adapters/sidecartCheckoutAdapter.ts) — a \"sidecart\" widget, structurally different from ibranson.com's page-navigation flow.",
  },
  {
    name: "Branson Show Tickets",
    targetUrl: "https://www.bransonshowtickets.com/shows",
    category: "direct",
    kind: "browser",
    selector: BRANSONSHOWTICKETS_LISTING_CONFIG,
    notes:
      "Confirmed via view-source on 2026-08-20: the show list is rendered client-side by JavaScript and isn't present in the raw HTML at all, so no plain-fetch selector could ever see it. Same underlying platform as Save On Branson (identical showlistitem-module--X--HASH markup — see that entry's notes), so this uses kind: \"browser\" the same way. Card selector built from real markup pasted by the operator on 2026-08-19 (title=\"Hughes Music Show\" card); name comes from the card's title attribute, price from the plain .price div. Hashed CSS-module class may break on redeploy, same caveat as Save On Branson.",
  },
  {
    name: "Save On Branson",
    targetUrl: "https://www.saveonbranson.com/shows",
    category: "direct",
    kind: "browser",
    selector: SAVEONBRANSON_LISTING_CONFIG,
    checkoutSelector: SAVEONBRANSON_CHECKOUT_CONFIG,
    checkoutKind: "modal",
    notes:
      "Distinct site from Branson Show Tickets, despite the similar original naming — separate domain, but built on the same underlying platform/template. Confirmed via view-source on 2026-08-20 to have the same JS-rendered show list, so this uses kind: \"browser\" from the start — confirmed working in production the same day. Card uses a hashed CSS-module class that may break on redeploy; name comes from the card's title attribute, price from the plain .price div. Checkout automation piloted 2026-08-26 for Hughes Music Show (see adapters/modalCheckoutAdapter.ts) — a \"modal\" widget, structurally different from both ibranson.com's page-navigation flow and branson.com's inline sidecart.",
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
        data: { name: show.name, sku: show.sku, ourPrice: show.ourPrice, checkoutUrl: show.checkoutUrl },
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
          checkoutSelector: site.checkoutSelector,
          checkoutKind: site.checkoutKind,
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

  // Checkout-price-discovery overrides: real per-product checkout entry URLs
  // on competitor sites piloting the same real-cart automation used for
  // ibranson.com (see adapters/checkoutAdapter.ts,
  // adapters/sidecartCheckoutAdapter.ts). Hughes Music Show's URL was
  // confirmed straight from the "Proceed to Checkout" link's source= param
  // in the real sidecart widget pasted on 2026-08-25; the rest were matched
  // by name against the real Branson.com shows-listing page source (all 124
  // cards) pasted by the operator on 2026-08-26 — real hrefs, not guesses.
  // Two of our 21 shows have no confident match and are left unwired:
  // "Freedom Journey Experience" isn't on Branson.com's listing at all, and
  // "Great American Chuckwagon Combo Dinner Show and Outdoor Drama" looks
  // like it may bundle two separate Branson.com products (a chuckwagon
  // dinner show + an outdoor drama) with no single matching page.
  const checkoutUrlOverrides: Array<{ siteName: string; productName: string; checkoutUrl: string }> = [
    {
      siteName: "Branson.com",
      productName: "Hughes Music Show",
      checkoutUrl: "https://www.branson.com/shows/hughes-music-show/",
    },
    {
      siteName: "Save On Branson",
      productName: "Hughes Music Show",
      checkoutUrl: "https://www.saveonbranson.com/shows/49847-hughes-music-show-starring-the-hughes-brothers",
    },
    {
      // From Hughes Music Show's own "recommended shows" section, pasted
      // 2026-08-26 — a real link, not a guess.
      siteName: "Save On Branson",
      productName: "The Haygoods",
      checkoutUrl: "https://www.saveonbranson.com/shows/6485-haygoods",
    },
    // The following 6 are matched by name against page 1 of Save On
    // Branson's real /shows listing (rendered DOM pasted by the operator on
    // 2026-08-26, since this site's show list is client-side rendered and
    // doesn't appear in plain view-source) — real hrefs, not guesses. Their
    // listing title differs slightly in wording/punctuation from our
    // product name in a couple of cases (e.g. "PETS & GIGGLES", "David at
    // Sight & Sound Theatres" for our "DAVID.") but is clearly the same
    // show. More of our shows are likely on page 2+ (a "next page" control
    // exists) — not yet pasted.
    {
      siteName: "Save On Branson",
      productName: "Hamners Unbelievable Variety Show",
      checkoutUrl: "https://www.saveonbranson.com/shows/5535-hamners-unbelievable-variety-show",
    },
    {
      siteName: "Save On Branson",
      productName: "Grand Jubilee",
      checkoutUrl: "https://www.saveonbranson.com/shows/8915-grand-jubilee",
    },
    {
      siteName: "Save On Branson",
      productName: "Pets and Giggles",
      checkoutUrl: "https://www.saveonbranson.com/shows/100078-pets-and-giggles",
    },
    {
      siteName: "Save On Branson",
      productName: "Clay Coopers Country Express",
      checkoutUrl: "https://www.saveonbranson.com/shows/7978-clay-coopers-country-express",
    },
    {
      siteName: "Save On Branson",
      productName: "DAVID.",
      checkoutUrl: "https://www.saveonbranson.com/shows/100112-david-at-sight-and-sound",
    },
    {
      siteName: "Save On Branson",
      productName: "Branson Comedy Bash Dinner & Show",
      checkoutUrl: "https://www.saveonbranson.com/shows/100138-branson-comedy-bash-dinner-show",
    },
    { siteName: "Branson.com", productName: "The Haygoods", checkoutUrl: "https://www.branson.com/shows/haygoods/" },
    { siteName: "Branson.com", productName: "Duttons", checkoutUrl: "https://www.branson.com/shows/duttons/" },
    {
      siteName: "Branson.com",
      productName: "Where Jesus Walked",
      checkoutUrl: "https://www.branson.com/shows/where-jesus-walked-immersive/",
    },
    { siteName: "Branson.com", productName: "SIX", checkoutUrl: "https://www.branson.com/shows/six/" },
    {
      siteName: "Branson.com",
      productName: "Hamners Unbelievable Variety Show",
      checkoutUrl: "https://www.branson.com/shows/hamners-unbelievable-variety/",
    },
    {
      siteName: "Branson.com",
      productName: "Grand Jubilee",
      checkoutUrl: "https://www.branson.com/shows/grand-jubilee/",
    },
    {
      siteName: "Branson.com",
      productName: "Pets and Giggles",
      checkoutUrl: "https://www.branson.com/shows/pets-and-giggles/",
    },
    {
      siteName: "Branson.com",
      productName: "A GARTH Tribute",
      checkoutUrl: "https://www.branson.com/shows/a-garth-tribute/",
    },
    {
      siteName: "Branson.com",
      productName: "Aaron Wayne Comedy Hypnosis Show",
      checkoutUrl: "https://www.branson.com/shows/aaron-wayne-sweet-dreams-comedy-hypnosis-show/",
    },
    {
      siteName: "Branson.com",
      productName: "Branson Comedy Bash Dinner & Show",
      checkoutUrl: "https://www.branson.com/shows/branson-comedy-bash-dinner-show/",
    },
    {
      siteName: "Branson.com",
      productName: "Dan Wagner Johnny Cash and Friends",
      checkoutUrl: "https://www.branson.com/shows/dan-wagner-johnny-cash/",
    },
    { siteName: "Branson.com", productName: "DAVID.", checkoutUrl: "https://www.branson.com/shows/david/" },
    {
      siteName: "Branson.com",
      productName: "Dolly Parton's Stampede Dinner Attraction",
      checkoutUrl: "https://www.branson.com/shows/dolly-parton-stampede/",
    },
    {
      siteName: "Branson.com",
      productName: "George Strait Tribute",
      checkoutUrl: "https://www.branson.com/shows/george-strait-tribute/",
    },
    {
      siteName: "Branson.com",
      productName: "Hits on Route 66 The Heatherlys",
      checkoutUrl: "https://www.branson.com/shows/hits-on-route-66-the-heatherlys/",
    },
    {
      siteName: "Branson.com",
      productName: "Hot Rods & High Heels 1950's Show",
      checkoutUrl: "https://www.branson.com/shows/hot-rods-and-high-heels/",
    },
    {
      siteName: "Branson.com",
      productName: "Clay Coopers Country Express",
      checkoutUrl: "https://www.branson.com/shows/clay-coopers-country-express/",
    },
    {
      siteName: "Branson.com",
      productName: "Dean Z - The Ultimate Elvis",
      checkoutUrl: "https://www.branson.com/shows/dean-z-the-ultimate-elvis/",
    },
  ];
  for (const override of checkoutUrlOverrides) {
    const site = competitorSites.find((s) => s.name === override.siteName);
    const product = products.find((p) => p.name === override.productName);
    if (!site || !product) continue;
    await prisma.productSite.updateMany({
      where: { productId: product.id, competitorSiteId: site.id },
      data: { checkoutUrl: override.checkoutUrl },
    });
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
