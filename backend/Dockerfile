# syntax=docker/dockerfile:1
# build from the repo root so npm ci uses the workspace lockfile:
#   docker build -f backend/Dockerfile .

ARG TARGETARCH
# the published linux-arm64 binary of @siafoundation/sia-storage cannot open
# tls connections (the x64 one can, and a native arm64 build of the same
# source can), so on arm64 the binary is compiled from source. the tag must be
# the one the installed npm version was built from: sia-storage-js pins it in
# .sia-sdk-rs.json (0.1.1 -> sia_storage_napi/v0.10.1).
ARG SIA_STORAGE_NPM_VERSION=0.1.1
ARG SIA_SDK_RS_REF=sia_storage_napi/v0.10.1

FROM rust:1-trixie AS sia-native-arm64
ARG SIA_SDK_RS_REF
RUN git clone --depth 1 --branch "$SIA_SDK_RS_REF" https://github.com/SiaFoundation/sia-sdk-rs /src
WORKDIR /src
RUN cargo build --release -p sia_storage_napi \
  && mkdir /out && cp target/release/libsia_storage_napi.so /out/sia-storage.node

FROM busybox:stable AS sia-native-amd64
RUN mkdir /out

FROM sia-native-${TARGETARCH} AS sia-native

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

# the native sia-storage binary. arm64 swaps in the source build from above;
# SIA_STORAGE_NATIVE optionally names a custom binary under backend/vendor/
# instead (e.g. one built for a small testnet host pool), and the build fails
# if that file is missing.
ARG SIA_STORAGE_NPM_VERSION
ARG SIA_STORAGE_NATIVE=
COPY --from=sia-native /out/ /tmp/sia-native/
COPY backend/vendor/ /tmp/vendor/
RUN set -e; \
  installed="$(node -p "require('/app/node_modules/@siafoundation/sia-storage/package.json').version")"; \
  if [ "$installed" != "$SIA_STORAGE_NPM_VERSION" ]; then \
    echo "installed @siafoundation/sia-storage $installed but the native build targets $SIA_STORAGE_NPM_VERSION: update SIA_STORAGE_NPM_VERSION and SIA_SDK_RS_REF together" >&2; exit 1; \
  fi; \
  arch="$(node -p process.arch)"; \
  target="$(dirname "$(node -p "require.resolve('@siafoundation/sia-storage-linux-$arch-gnu/sia-storage.node')")")"; \
  if [ -n "$SIA_STORAGE_NATIVE" ]; then \
    cp "/tmp/vendor/$SIA_STORAGE_NATIVE" "$target/sia-storage.node"; echo "using custom binary $SIA_STORAGE_NATIVE"; \
  elif [ -f /tmp/sia-native/sia-storage.node ]; then \
    cp /tmp/sia-native/sia-storage.node "$target/sia-storage.node"; echo "using source-built binary for $arch"; \
  fi; \
  rm -rf /tmp/sia-native /tmp/vendor

RUN mkdir -p /app/uploads /app/transcode-output /app/cache \
  && chown -R node:node /app/uploads /app/transcode-output /app/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# migrations are idempotent (tracked in __drizzle_migrations), so running them
# on every start keeps a fresh database and an existing one in step
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
