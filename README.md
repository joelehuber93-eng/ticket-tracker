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
- **`scraper`** — fetches an HTML page and reads the price out of the first
  element matching a CSS selector (e.g. `.price`). Fallback for sites with no
  API. More fragile — breaks when the competitor changes their markup, and
  won't work at all against JS-rendered pages (see limitations below).
- **`mock`** — no network call; returns a jittered price around a base value
  encoded in the URL (`mock://site?base=99.99&volatility=0.05`). Used by the
  two "Demo Source" entries in the seed data so the dashboard shows live
  movement without any real competitor being scraped yet.

**Before adding a scraper source**, check the target site's `robots.txt` and
terms of service, and keep the polling interval reasonable.

### The 23 competitors

`packages/server/src/seed.ts` seeds all 23 competitors supplied by the
business, grouped into three categories:

- **`direct`** — Branson-specific ticket/travel competitors (Branson.com,
  Branson Shows, Branson Ticket & Travel, etc.). Seeded with `kind: "scraper"`
  as a starting recommendation.
- **`ota`** — national/international OTAs (Viator, GetYourGuide, TripAdvisor,
  Trip.com, Expedia, Tripster). The five partner-API-having platforms are
  seeded with `kind: "api"` and a note pointing at their official partner
  program — these are JS-rendered and typically bot-protected, so scraping
  them is unlikely to work reliably even where it isn't against ToS.
- **`info`** — Branson tourism/chamber sites (Explore Branson, Branson
  Chamber, Branson Travel Office) that may not sell tickets directly at all;
  notes flag that this needs verifying before wiring up a selector.

**None of the 23 are linked to products yet** — each was seeded with an empty
`selector`, so the scheduler skips them (only `ProductSite`-linked pairs are
checked). This session's sandbox has no general internet access, so nobody
has actually inspected these sites' markup or price rendering yet. To bring a
real one online:

1. Open the target page in a browser, inspect the price element, and note the
   CSS selector (or find its partner API + JSON path).
2. `PATCH /api/sites/:id` with the real `selector` (and `kind`/`notes` if they
   changed).
3. `POST /api/sites/links` to link it to the relevant `Product`(s).

The "Competitor sources" panel at the bottom of the dashboard lists all 23
with a live status badge (`Needs selector` / `Needs API integration` /
`Configured`) so it's obvious what's left.

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
npm run seed --workspace=@price-tracker/server              # 21 real iBranson shows + 23 competitors + 2 demo sources
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

## Bringing a competitor online

```bash
# See current status of all 23 (+ 2 demo) sources
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
  (real shows + all 23 competitors + 2 demo sources)

## Known limitations / next steps

- No auth — fine for internal use, not for a public deployment.
- No admin UI for managing products/sites yet (REST only, or the read-only
  sources panel in the dashboard).
- 7 of the 23 real competitors are configured and live-linked (as of
  2026-08-19, from real pasted card markup): Branson.com, Save On Branson /
  Branson Show Tickets, Discover Branson, Branson Tourism Center, Reserve
  Branson, Branson Travel Office, and TripAdvisor — all `listing`-kind
  sources matched to products by name. See "Bringing a competitor online"
  above for the rest. Four OTAs (Viator, GetYourGuide, Trip.com, Expedia)
  were inspected and confirmed to need their official partner/affiliate APIs
  rather than scraping — their markup is either hashed per-build CSS-module
  classes or has no price rendered server-side at all. All Access Branson
  uses old nested-`<table>` markup with no repeating card structure and
  needs a bespoke per-show selector rather than a listing config. Several of
  the direct Branson competitors (e.g. Book.Branson.com) may also be
  JS-rendered booking flows that plain HTML scraping can't read — those
  would need a headless-browser adapter (e.g. Playwright), which isn't built
  yet.
- `targetUrl` for the 7 newly-configured listing sources was inferred from
  href patterns in the pasted card markup, not confirmed by directly loading
  the page (this sandbox has no outbound internet access). Verify each with
  `POST /api/sites/:id/preview-listing` once running somewhere with real
  network access, and correct the URL if it 404s or the selectors don't
  match.
- Price history isn't visualized (it's stored — every `CompetitorPrice` row
  is kept — just not charted yet).
- Scraper adapter has no robots.txt check built in; that's on the operator
  when configuring a new scraper source.
