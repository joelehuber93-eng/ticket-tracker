# iBranson Competitor Price Tracker

Tracks [ibranson.com](https://www.ibranson.com)'s show/ticket prices against
Branson-area and national competitors, and highlights disparities in real
time. A background job polls each tracked (product, competitor site) pair on
an interval, and a dashboard updates live over WebSockets as new prices come
in.

## Architecture

npm workspaces monorepo:

- `packages/shared` — TypeScript types and constants shared by server and
  client (consumed as source, no build step needed in dev).
- `packages/server` — Express API + Socket.io + a `node-cron` scheduler +
  Prisma/SQLite storage. Fetches competitor prices through pluggable
  **source adapters**.
- `packages/client` — React (Vite) dashboard. Loads the current state over
  REST, then stays live via a WebSocket subscription, plus a "Competitor
  sources" panel showing every configured competitor and what it still needs.

### Source adapters (`packages/server/src/adapters`)

Each competitor site is checked with one of:

- **`api`** — calls a JSON endpoint and reads the price out of a dot-path
  (e.g. selector `"data.price"` against `{ data: { price: 19.99 } }`).
  Prefer this whenever a competitor (or a price-comparison API) exposes one.
- **`scraper`** — fetches a single HTML page (one show, one price) and reads
  the price out of the first element matching a CSS selector (e.g. `.price`).
  More fragile than `api` — breaks when the competitor changes their markup,
  and won't work at all against JS-rendered pages (see limitations below).
- **`listing`** — fetches one HTML page that lists many shows at once (e.g. a
  competitor's `/shows/` page) and extracts every (name, price) pair from it
  in a single request, matching each back to our products by fuzzy name
  match. `selector` is a JSON `{"card","name","price"}` config: CSS selectors
  scoped to each show's card, where `name`/`price` can also read an attribute
  instead of text via `"@attr"` (attribute on the card itself) or
  `"selector@attr"` (attribute on a descendant) — used for sites that embed
  the price in a `data-*` attribute rather than visible text. See
  `packages/server/src/adapters/listingAdapter.ts`. Most of the real
  competitors below use this, since a single competitor page typically lists
  every show.
- **`browser`** — same `{"card","name","price"}` config and matching as
  `listing`, but the page is rendered with a real headless browser
  (Playwright + Chromium) first, instead of a plain HTTP fetch. Reserved for
  sites confirmed to need it: either real bot protection that returns
  `HTTP 403` to a plain fetch regardless of headers (not just picky about
  User-Agent), or content that's genuinely rendered client-side and never
  appears in the raw HTML fetch() receives. Meaningfully heavier than
  `listing` — launches a real browser process per check — and not
  guaranteed to work against sophisticated bot detection (some tools
  fingerprint headless browsers too). See
  `packages/server/src/adapters/browserAdapter.ts`. Currently only
  Branson.com uses this.
- **`mock`** — no network call; returns a jittered price around a base value
  encoded in the URL (`mock://site?base=99.99&volatility=0.05`). Not seeded
  by default — useful for local testing (a fake source that "just works"
  without hitting any real site), but the seed data only tracks real
  competitors now.

**Before adding a scraper/listing/browser source**, check the target site's
`robots.txt` and terms of service, and keep the polling interval reasonable.

### The competitors

The business originally supplied a list of 23 named competitors; this project
only seeds the ones the operator has actually supplied real page markup for
(pasting HTML from a browser, since this sandbox has no general internet
access to inspect pages itself) — `packages/server/src/seed.ts` currently
seeds 11, grouped into three categories:

- **`direct`** — Branson-specific ticket/travel competitors: Branson.com,
  Branson Show Tickets, Save On Branson, Discover Branson, Branson Tourism
  Center, All Access Branson.
- **`ota`** — national/international OTAs: Viator, GetYourGuide, Trip.com,
  Expedia.
- **`info`** — Branson Travel Office.

Branson Show Tickets (bransonshowtickets.com) and Save On Branson
(saveonbranson.com) were originally seeded as one combined entry — the
operator's original list named them together — but they're separate
domains, split apart on 2026-08-20 once that became clear.

**6 of the 12 are configured and linked to every product.** Status as of
2026-08-20, verified against a real deploy (this dev sandbox has no outbound
internet access, so none of this could be confirmed locally):

- **Working end-to-end (`listing`), including product name matching:**
  Branson Travel Office (93 shows), Branson Tourism Center (157), Discover
  Branson (140 shows, 20/21 of our products matched by name), Reserve
  Branson (92 shows, 18/21 matched — its root domain doesn't render the show
  list, `/branson/shows` does). Products a site genuinely doesn't sell stay
  unmatched on purpose — not a bug, just an accurate gap.
- **Working via a real browser (`browser`):** Branson.com — our biggest
  competitor, so worth the extra engineering. It returns `HTTP 403` to a
  plain fetch even with a real browser User-Agent, meaning real bot
  protection rather than simple header filtering. Rendering with Playwright
  + headless Chromium instead of `fetch()` fixed it — confirmed working in
  production — which is why the app now deploys via Docker (see "Deploying
  to Render" below) instead of Render's native Node runtime. Save On Branson
  (saveonbranson.com) needed the same fix, unsurprisingly — it's built on
  the same underlying platform as Branson Show Tickets (identical CSS-module
  naming pattern gave it away) — and is also confirmed working in
  production.

- **Tried, then removed entirely (not left unconfigured):** TripAdvisor — a
  plain fetch got `HTTP 403`, and the same `browser` fix that worked for
  Branson.com still got back an empty page and a placeholder title even
  after adding anti-fingerprinting patches (masking `navigator.webdriver`
  and other automation tells — those patches are still in
  `adapters/browserAdapter.ts` since they're a real, general improvement,
  not TripAdvisor-specific). Real behavioral bot detection beating a free
  headless browser — getting past it for real would need the TripAdvisor
  Content API or a paid third-party scraping service, and the operator
  decided it wasn't worth pursuing, so it was dropped from the competitor
  list rather than left as permanent dead weight.
- **Confirmed not scrapable by any fetch-based approach:** Branson Show
  Tickets (bransonshowtickets.com) — view-source confirmed its show list is
  rendered entirely client-side (a show's own name doesn't appear anywhere
  in the raw HTML), so even a `listing` config can never see it; would need
  the `browser` kind (untried) or their own API. Viator, GetYourGuide,
  Trip.com, Expedia — seeded `kind: "api"`, all use hashed per-build
  CSS-module class names (or, for Expedia, no server-rendered price at
  all), so a selector
  would break constantly even if `browser` got past their bot protection.
  Use each platform's official partner API instead.
- **All Access Branson** — seeded `kind: "scraper"` with an empty selector.
  It uses old nested-`<table>` markup with no repeating card structure and a
  tier-by-tier price breakdown per show, so it needs a bespoke per-show
  selector rather than a `listing`/`browser` config, and no single reliable
  results-page URL was confirmed from the pasted markup alone.

Listing-page name matching (`matchListingEntry` in
`packages/server/src/adapters/listingAdapter.ts`) tries, in order: an exact
normalized match, a substring match either direction, then a fuzzy
word-overlap fallback (≥80% of the shorter name's significant words must
appear in the other) for the same show listed with reordered/inserted/
dropped words. For the rare case even that can't safely bridge (confirmed
the same show by a human, not guessed), add a manual override in
`packages/server/src/nameAliases.ts` rather than lowering the threshold
globally.

`targetUrl` for sites not explicitly confirmed above (in the list) was
inferred from href patterns in the pasted markup, not verified by loading
the page directly — verify with `POST /api/sites/:id/preview-listing` and
correct the URL if it 404s or the selectors don't match.

To add another competitor beyond these 12: paste real card markup (price
element, then the surrounding card element) so a selector or listing config
can be derived from it, the same way these 12 were — inventing a selector
without seeing the real markup isn't reliable enough to be worth seeding.
Once you have one:

1. `PATCH /api/sites/:id` with the real `selector` (and `kind`/`notes` if
   they changed) — or `POST /api/sites` to create a new one.
2. `POST /api/sites/links` to link it to the relevant `Product`(s), or (for a
   `listing`/`browser` source) link it to every product at once, since
   matching is done by name from the one fetched page.

The "Competitor sources" panel at the bottom of the dashboard lists all
configured sites with a live status badge (`Needs selector` / `Needs API
integration` / `Configured`) so it's obvious what's left.

### Real-time updates

The scheduler (`node-cron`, default every 5 minutes, configurable via
`POLL_INTERVAL_MINUTES`) runs a check pass and broadcasts each result over
Socket.io as it completes (`price:update`), plus a summary when the whole
pass finishes (`check:complete`). The dashboard also has a "Run check now"
button that triggers an out-of-band pass via `POST /api/checks/run`.

### Disparity classification

For each (product, competitor) pair, delta % is computed as
`(ourPrice - competitorPrice) / competitorPrice`, then classified into
`none` / `low` / `medium` / `high` severity using thresholds in
`packages/shared/src/index.ts` (`DISPARITY_THRESHOLDS`, currently 2/5/10%).
Rows are color-coded green when we're cheaper, red when we're pricier,
intensity scaling with severity. "Our Price" is ibranson.com's "tickets
starting at" rate per show, pasted in from the site on 2026-08-19 — update via
the API as real prices change.

## Setup

Requires Node 20+.

```bash
npm install
npm run prisma:migrate --workspace=@price-tracker/server   # creates SQLite dev.db
npm run seed --workspace=@price-tracker/server              # 21 real iBranson shows + 12 competitors
```

## Running

In two terminals:

```bash
npm run dev            # server on http://localhost:4000
npm run dev:client     # client on http://localhost:5173 (proxies /api and /socket.io to the server)
```

Open http://localhost:5173. The dashboard loads current data over REST, then
updates live as the scheduler (or "Run check now") fetches new prices.

## Configuration

Server config lives in `packages/server/.env` (see `.env.example`):

| Variable                | Default                 | Meaning                                   |
|--------------------------|--------------------------|--------------------------------------------|
| `DATABASE_URL`           | `file:./dev.db`          | SQLite connection string                  |
| `PORT`                   | `4000`                   | API/WebSocket port                        |
| `POLL_INTERVAL_MINUTES`  | `5`                      | How often the scheduler checks all sites  |
| `CLIENT_ORIGIN`          | `http://localhost:5173`  | Allowed CORS/WebSocket origin             |
| `NODE_ENV`               | *(unset)*                | Set to `production` to have the server also serve the client's built static files (see Deploying below) — in dev, Vite's own dev server handles the client instead. |

## Deploying to Render

GitHub hosts the code, but it can't run this app — no server, no database.
`render.yaml` at the repo root configures a single Render **Web Service**,
built from the root `Dockerfile`, that builds the client and runs the
Express server, which serves the built dashboard and the API from the same
URL (the client already calls `/api` and `/socket.io` as relative paths, so
there's no separate frontend origin to configure).

It deploys via **Docker**, not Render's native Node runtime, specifically
because of the `browser` adapter (see above) — running headless Chromium
needs OS-level libraries a plain Node buildpack doesn't provide, so the
`Dockerfile` starts from Microsoft's official Playwright image
(`mcr.microsoft.com/playwright`), which already has Chromium and everything
it needs preinstalled. That image's tag version and `packages/server`'s
`playwright` dependency version are pinned to match exactly (currently
`1.62.1`) — if you ever bump one, bump the other the same way, or Playwright
will complain about a missing/mismatched browser build at runtime.

1. Push this branch (or merge it to whatever branch you deploy from) to
   GitHub — already done if you're reading this from the repo.
2. In the Render dashboard: **New > Blueprint**, point it at this repo. It
   reads `render.yaml` and creates the service for you.
3. `render.yaml` requests the **Standard** plan. Two independent reasons it's
   not Starter or Free:
   - Free-tier services have an ephemeral filesystem, so the SQLite database
     (and all price history in it) would be wiped on every deploy or
     restart. Starter and above get a persistent 1 GB disk mounted at
     `/var/data`, which is where `DATABASE_URL` points (adjust `sizeGB` in
     `render.yaml` if you need more).
   - Starter's ~512 MB RAM is tight-to-over budget once you add a headless
     Chromium process (commonly 150-300MB+ alone) on top of Node/Express/
     Prisma — risking the service getting OOM-killed mid-check. Standard's
     headroom is the safer default; if cost matters more, Starter *might*
     work since Chromium only runs briefly once per poll interval rather
     than continuously, but a crash-looping service is worse than the extra
     monthly cost.
4. First deploy applies migrations automatically (`prisma migrate deploy`,
   in the Dockerfile's `CMD`) but leaves the database empty — **seed it
   once**, manually, via Render's Shell tab on the service:
   ```bash
   npm run seed --workspace=@price-tracker/server
   ```
   Do **not** add this to the build/start command — `seed.ts` deletes and
   recreates everything, so running it on every deploy would wipe out real
   accumulated price history each time you push a change.
5. Check `GET /api/sites` on the deployed URL to see real results, and use
   `POST /api/sites/:id/preview-listing` to fix up any `targetUrl`/selector
   that turns out to be wrong once it can actually reach the real page (see
   "The competitors" above for what's already confirmed working vs. still
   inferred).
6. `POLL_INTERVAL_MINUTES` in `render.yaml` defaults to 5, matching dev —
   lower it there if you want faster updates, keeping the target sites'
   rate limits in mind (and the `browser` source's extra cost per check).

Render's UI can also just deploy `render.yaml`'s service directly if you'd
rather set it up by hand instead of via Blueprint — the settings above (Docker
build, disk, plan) are all in that file either way.

## Bringing a competitor online

```bash
# See current status of all 12 sources
curl localhost:4000/api/sites | jq '.[] | {name, kind, category, selector, notes}'

# Fill in a selector once you've inspected the real page
curl -X PATCH localhost:4000/api/sites/<site id> \
  -H 'Content-Type: application/json' \
  -d '{"selector":".price-value"}'

# Link it to a show so the scheduler starts checking it
curl -X POST localhost:4000/api/sites/links \
  -H 'Content-Type: application/json' \
  -d '{"productId":"<product id>","competitorSiteId":"<site id>"}'
```

New products/sites can also be created directly:

```bash
curl -X POST localhost:4000/api/products \
  -H 'Content-Type: application/json' \
  -d '{"name":"New Show","sku":"new-show","ourPrice":39.99}'

curl -X POST localhost:4000/api/sites \
  -H 'Content-Type: application/json' \
  -d '{"name":"Some Competitor","kind":"scraper","category":"direct","targetUrl":"https://example.com/show","selector":".price"}'
```

## Scripts

- `npm run dev` — start the server (auto-reload via `tsx watch`)
- `npm run dev:client` — start the client dev server
- `npm run typecheck` — typecheck all workspaces
- `npm run build` — production build of the client (the server runs via
  `tsx` in both dev and prod — see `packages/server/package.json`)
- `npm run seed --workspace=@price-tracker/server` — reset and reseed
  (real shows + all 12 competitors)

## Known limitations / next steps

- No auth — fine for internal use, not for a public deployment.
- No admin UI for managing products/sites yet (REST only, or the read-only
  sources panel in the dashboard).
- Only 12 of the business's original 23 named competitors are seeded at all,
  and only 6 of those are actually configured — see "The competitors" above
  for the full breakdown of what's live, what needs a partner API, and what
  needs more markup before it can be wired up. A `browser` adapter exists
  (headless Chromium via Playwright, with basic anti-fingerprinting) for
  sites a plain fetch can't reach — confirmed working for Branson.com and
  Save On Branson. TripAdvisor needed more than that (real behavioral bot
  detection) and was dropped rather than pursued further with a paid
  scraping service.
- Price history isn't visualized (it's stored — every `CompetitorPrice` row
  is kept — just not charted yet).
- Scraper adapter has no robots.txt check built in; that's on the operator
  when configuring a new scraper source.
