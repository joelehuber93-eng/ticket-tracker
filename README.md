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
- **`mock`** — no network call; returns a jittered price around a base value
  encoded in the URL (`mock://site?base=99.99&volatility=0.05`). Used by the
  two "Demo Source" entries in the seed data so the dashboard shows live
  movement independent of any real competitor.

**Before adding a scraper/listing source**, check the target site's
`robots.txt` and terms of service, and keep the polling interval reasonable.

### The competitors

The business originally supplied a list of 23 named competitors; this project
only seeds the ones the operator has actually supplied real page markup for
(pasting HTML from a browser, since this sandbox has no general internet
access to inspect pages itself) — `packages/server/src/seed.ts` currently
seeds 12, grouped into three categories:

- **`direct`** — Branson-specific ticket/travel competitors: Branson.com,
  Save On Branson / Branson Show Tickets, Discover Branson, Branson Tourism
  Center, All Access Branson, Reserve Branson.
- **`ota`** — national/international OTAs: Viator, GetYourGuide, Trip.com,
  Expedia, TripAdvisor.
- **`info`** — Branson Travel Office.

**7 of the 12 are configured and linked to every product** as `listing`
sources (Branson.com, Save On Branson, Discover Branson, Branson Tourism
Center, Reserve Branson, Branson Travel Office, TripAdvisor). The other 5
were inspected but couldn't be wired up as scrapers:

- **Viator, GetYourGuide, Trip.com, Expedia** — seeded `kind: "api"`. Their
  markup uses hashed, per-build CSS-module class names (or, for Expedia,
  renders no price server-side at all), so a selector would break constantly
  even if it worked once. Use each platform's official partner API instead.
- **All Access Branson** — seeded `kind: "scraper"` with an empty selector.
  It uses old nested-`<table>` markup with no repeating card structure and a
  tier-by-tier price breakdown per show, so it needs a bespoke per-show
  selector rather than a `listing` config, and no single reliable results-page
  URL was confirmed from the pasted markup alone.

`targetUrl` for the 7 configured sites was inferred from href patterns in the
pasted markup (e.g. Branson.com's card links pointed at `/shows/...`, so its
listing page is `/shows/`), not confirmed by loading the page directly —
verify each with `POST /api/sites/:id/preview-listing` once running
somewhere with real internet access, and correct the URL if it doesn't
resolve or the selectors stop matching.

To add another competitor beyond these 12: paste real card markup (price
element, then the surrounding card element) so a selector or listing config
can be derived from it, the same way these 12 were — inventing a selector
without seeing the real markup isn't reliable enough to be worth seeding.
Once you have one:

1. `PATCH /api/sites/:id` with the real `selector` (and `kind`/`notes` if
   they changed) — or `POST /api/sites` to create a new one.
2. `POST /api/sites/links` to link it to the relevant `Product`(s), or (for a
   `listing` source) link it to every product at once, since matching is done
   by name from the one fetched page.

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
npm run seed --workspace=@price-tracker/server              # 21 real iBranson shows + 12 competitors + 2 demo sources
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
`render.yaml` at the repo root configures a single Render **Web Service**
that builds the client, then runs the Express server, which serves the built
dashboard and the API from the same URL (the client already calls `/api` and
`/socket.io` as relative paths, so there's no separate frontend origin to
configure).

1. Push this branch (or merge it to whatever branch you deploy from) to
   GitHub — already done if you're reading this from the repo.
2. In the Render dashboard: **New > Blueprint**, point it at this repo. It
   reads `render.yaml` and creates the service for you.
3. `render.yaml` requests the **Starter** plan, not Free — Free-tier services
   have an ephemeral filesystem, so the SQLite database (and all price
   history in it) would be wiped on every deploy or restart. Starter (or
   above) gets a persistent 1 GB disk mounted at `/var/data`, which is where
   `DATABASE_URL` points. Adjust `sizeGB` in `render.yaml` if you need more.
4. First deploy applies migrations automatically (`prisma migrate deploy`,
   in the start command) but leaves the database empty — **seed it once**,
   manually, via Render's Shell tab on the service:
   ```bash
   npm run seed --workspace=@price-tracker/server
   ```
   Do **not** add this to the build/start command — `seed.ts` deletes and
   recreates everything, so running it on every deploy would wipe out real
   accumulated price history each time you push a change.
5. Once it's up, competitor scraping should actually start succeeding —
   this development sandbox has no outbound internet access, so every
   configured source has only ever failed with `HTTP 403` here. Check
   `GET /api/sites` on the deployed URL to see real results, and use
   `POST /api/sites/:id/preview-listing` to fix up any `targetUrl`/selector
   that turns out to be wrong once it can actually reach the real page (see
   "The competitors" above — several `targetUrl`s were inferred, not
   confirmed).
6. `POLL_INTERVAL_MINUTES` in `render.yaml` defaults to 5, matching dev —
   lower it there if you want faster updates, keeping the target sites'
   rate limits in mind.

Render's UI can also just deploy `render.yaml`'s service directly if you'd
rather set it up by hand instead of via Blueprint — the settings above (build
command, start command, disk) are all in that file either way.

## Bringing a competitor online

```bash
# See current status of all 12 (+ 2 demo) sources
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
  (real shows + all 12 competitors + 2 demo sources)

## Known limitations / next steps

- No auth — fine for internal use, not for a public deployment.
- No admin UI for managing products/sites yet (REST only, or the read-only
  sources panel in the dashboard).
- Only 12 of the business's original 23 named competitors are seeded at all,
  and only 7 of those are actually configured — see "The competitors" above
  for the full breakdown of what's live, what needs a partner API, and what
  needs more markup before it can be wired up. Some competitors may also
  turn out to be JS-rendered booking flows that plain HTML scraping can't
  read, which would need a headless-browser adapter (e.g. Playwright), not
  built yet.
- Price history isn't visualized (it's stored — every `CompetitorPrice` row
  is kept — just not charted yet).
- Scraper adapter has no robots.txt check built in; that's on the operator
  when configuring a new scraper source.
