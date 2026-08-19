# Competitor Price Tracker

Tracks your product prices against competitor sites and highlights disparities
in real time. A background job polls each tracked (product, competitor site)
pair on an interval, and a dashboard updates live over WebSockets as new
prices come in.

## Architecture

npm workspaces monorepo:

- `packages/shared` — TypeScript types and constants shared by server and
  client (consumed as source, no build step needed in dev).
- `packages/server` — Express API + Socket.io + a `node-cron` scheduler +
  Prisma/SQLite storage. Fetches competitor prices through pluggable
  **source adapters**.
- `packages/client` — React (Vite) dashboard. Loads the current state over
  REST, then stays live via a WebSocket subscription.

### Source adapters (`packages/server/src/adapters`)

Each competitor site is checked with one of:

- **`api`** — calls a JSON endpoint and reads the price out of a dot-path
  (e.g. selector `"data.price"` against `{ data: { price: 19.99 } }`).
  Prefer this whenever a competitor (or a price-comparison API) exposes one.
- **`scraper`** — fetches an HTML page and reads the price out of the first
  element matching a CSS selector (e.g. `.price`). Fallback for sites with no
  API. More fragile — breaks when the competitor changes their markup.
- **`mock`** — no network call; returns a jittered price around a base value
  encoded in the URL (`mock://site?base=99.99&volatility=0.05`). Used by the
  seed data so the app is demoable without real competitor endpoints.

Adding a new competitor site just means inserting a `CompetitorSite` row with
the right `kind`/`targetUrl`/`selector` and linking it to a `Product` — no
code changes needed unless you need a new adapter kind entirely.

**Before adding a scraper source**, check the target site's `robots.txt` and
terms of service, and keep the polling interval reasonable — this tool is
built for tracking a modest number of products against sites that allow it,
not for high-volume crawling.

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
intensity scaling with severity.

## Setup

Requires Node 20+.

```bash
npm install
npm run prisma:migrate --workspace=@price-tracker/server   # creates SQLite dev.db
npm run seed --workspace=@price-tracker/server              # demo products + mock competitor sites
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

## Tracking a real competitor

Products and competitor sites are managed via REST for now (no admin UI yet):

```bash
# Add one of your products
curl -X POST localhost:4000/api/products \
  -H 'Content-Type: application/json' \
  -d '{"name":"Wireless Mouse","sku":"WM-100","ourPrice":24.99}'

# Add a competitor site (API-based)
curl -X POST localhost:4000/api/sites \
  -H 'Content-Type: application/json' \
  -d '{"name":"CompetitorA","kind":"api","targetUrl":"https://api.competitor-a.com/products/123","selector":"data.price"}'

# Or scraper-based
curl -X POST localhost:4000/api/sites \
  -H 'Content-Type: application/json' \
  -d '{"name":"CompetitorB","kind":"scraper","targetUrl":"https://competitor-b.com/product/123","selector":".price"}'

# Link them so the scheduler checks this pair
curl -X POST localhost:4000/api/sites/links \
  -H 'Content-Type: application/json' \
  -d '{"productId":"<product id>","competitorSiteId":"<site id>"}'
```

## Scripts

- `npm run dev` — start the server (auto-reload via `tsx watch`)
- `npm run dev:client` — start the client dev server
- `npm run typecheck` — typecheck all workspaces
- `npm run build` — production build of the client (the server runs via
  `tsx` in both dev and prod — see `packages/server/package.json`)
- `npm run seed --workspace=@price-tracker/server` — reset and reseed demo data

## Known limitations / next steps

- No auth — fine for local/internal use, not for a public deployment.
- No admin UI for managing products/sites yet (REST only).
- Price history isn't visualized (it's stored — every `CompetitorPrice` row
  is kept — just not charted yet).
- Scraper adapter has no robots.txt check built in; that's on the operator
  when configuring a new scraper source.
