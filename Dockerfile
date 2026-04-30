# ── Stage 1: Build web frontend ──────────────────────────────────
FROM node:20-alpine AS web-build
WORKDIR /app
COPY package*.json ./
COPY packages/web/package*.json ./packages/web/
RUN npm ci --workspace=packages/web
COPY packages/web ./packages/web
RUN npm run build --workspace=packages/web

# ── Stage 2: Compile server TypeScript ───────────────────────────
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
RUN npm ci --workspace=packages/server
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/src ./packages/server/src
RUN cd packages/server && npx tsc

# ── Stage 3: Production runtime ─────────────────────────────────
FROM node:20-alpine

# better-sqlite3 needs native compilation; clean up after install
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
RUN npm ci --workspace=packages/server --omit=dev \
    && apk del python3 make g++ \
    && apk add --no-cache libstdc++

# Compiled server + built web assets
COPY --from=server-build /app/packages/server/dist ./packages/server/dist
COPY --from=web-build /app/packages/web/dist ./packages/web/dist

# Default data directory (overridable via DB_PATH env var)
RUN mkdir -p /app/packages/server/data

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
