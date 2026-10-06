# syntax=docker/dockerfile:1
# build from the repo root so npm ci uses the workspace lockfile:
#   docker build -f backend/Dockerfile .

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/sdk/package.json packages/sdk/
COPY packages/player/package.json packages/player/
COPY frontend/package.json frontend/
COPY examples/quickstart/package.json examples/quickstart/
RUN npm ci --workspace=backend --include-workspace-root=false
COPY backend/tsconfig.json backend/
COPY backend/src backend/src
RUN npm run build --workspace=backend

FROM node:24-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/sdk/package.json packages/sdk/
COPY packages/player/package.json packages/player/
COPY frontend/package.json frontend/
COPY examples/quickstart/package.json examples/quickstart/
RUN npm ci --workspace=backend --include-workspace-root=false --omit=dev

FROM node:24-trixie-slim
# ca-certificates: node bundles its own roots, but the sia-storage native
# client verifies tls against the system store
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# keep the workspace layout: some backend deps resolve from the nested
# backend/node_modules (version conflicts with other workspaces), the rest
# from the hoisted /app/node_modules
WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/drizzle ./drizzle
COPY --chown=node:node backend/scripts ./scripts

# optional: a custom-built sia-storage native binary placed under
# backend/vendor/ (e.g. one built for a small testnet host pool). off unless
# the build arg names it, and the build fails if the named file is missing.
ARG SIA_STORAGE_NATIVE=
COPY backend/vendor/ /tmp/vendor/
RUN if [ -n "$SIA_STORAGE_NATIVE" ]; then \
      target="$(node -p "require.resolve('sia-storage-linux-' + (process.arch === 'arm64' ? 'arm64' : 'x64') + '-gnu/package.json').replace('package.json', '')")" \
      && cp "/tmp/vendor/$SIA_STORAGE_NATIVE" "$target" \
      && echo "using custom sia-storage binary $SIA_STORAGE_NATIVE"; \
    fi \
  && rm -rf /tmp/vendor

RUN mkdir -p /app/uploads /app/transcode-output /app/cache \
  && chown -R node:node /app/uploads /app/transcode-output /app/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# migrations are idempotent (tracked in __drizzle_migrations), so running them
# on every start keeps a fresh database and an existing one in step
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
