# Base image ships Chromium + all its OS-level dependencies already
# installed, matching a specific Playwright npm version exactly — needed so
# `npm install`'s copy of playwright doesn't try (and fail) to download its
# own browser build. Keep this tag's version and packages/server's
# "playwright" dependency version in sync (see packages/server/package.json).
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Copy just the package manifests first so `npm install` is cached across
# builds unless a dependency actually changed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json

RUN npm install

COPY . .

RUN npm run build --workspace=@price-tracker/client
RUN npm run prisma:generate --workspace=@price-tracker/server

ENV NODE_ENV=production
EXPOSE 4000

# Migrations run at container start (not build time) since the SQLite file
# lives on a mounted disk that only exists once the container is running —
# see render.yaml's disk config.
CMD ["sh", "-c", "npm run prisma:deploy --workspace=@price-tracker/server && npm run start --workspace=@price-tracker/server"]
