# syntax=docker/dockerfile:1
# build from the repo root so npm ci uses the workspace lockfile:
#   docker build -f backend/Dockerfile .

ARG TARGETARCH
# the published linux-arm64 binary of @siafoundation/sia-storage cannot open
# tls connections (the x64 one can, and a native arm64 build of the same
# source can), so on arm64 the binary is compiled from source. the commit must
# be the one the installed npm version was built from: sia-storage-js names
# its tag in .sia-sdk-rs.json (0.1.2 -> sia_storage_napi/v0.10.1, which is
# commit 5e532cb). the published 0.1.2 arm64 binary still fails tls.
ARG SIA_STORAGE_NPM_VERSION=0.1.2
ARG SIA_SDK_RS_COMMIT=5e532cb202873646728dcdbfc7be43d1436520c9
# a path under backend/vendor/ of a custom binary to use instead (see
# backend/vendor/README.md). when set, nothing is compiled here.
ARG SIA_STORAGE_NATIVE=

# rust 1.99.0, pinned by digest so the same source always meets the same
# toolchain
FROM rust:1.99.0-trixie@sha256:6ff07edce8775d0f64be7aba9197229407301bddf2054d62c27b541a6238a181 AS sia-native-arm64
ARG SIA_SDK_RS_COMMIT
WORKDIR /src
RUN git init -q . \
  && git fetch -q --depth 1 https://github.com/SiaFoundation/sia-sdk-rs "$SIA_SDK_RS_COMMIT" \
  && git checkout -q FETCH_HEAD
RUN cargo build --release --locked -p sia_storage_napi \
  && mkdir /out && cp target/release/libsia_storage_napi.so /out/sia-storage.node

FROM busybox:stable AS sia-native-amd64
RUN mkdir /out

FROM busybox:stable AS sia-native-custom
ARG SIA_STORAGE_NATIVE
COPY backend/vendor/${SIA_STORAGE_NATIVE} /out/sia-storage.node
FROM sia-native-custom AS sia-native-amd64-custom
FROM sia-native-custom AS sia-native-arm64-custom

# any other platform has no sia-storage binary. without buildkit TARGETARCH
# is empty, which lands here too
FROM busybox:stable AS sia-native-unsupported
ARG TARGETARCH
RUN echo "the backend image builds for linux/amd64 and linux/arm64 with buildkit only, not '${TARGETARCH}'" >&2; exit 1
FROM sia-native-unsupported AS sia-native-unset
FROM sia-native-unsupported AS sia-native-arm
FROM sia-native-unsupported AS sia-native-386
FROM sia-native-unsupported AS sia-native-ppc64le
FROM sia-native-unsupported AS sia-native-s390x
FROM sia-native-unsupported AS sia-native-riscv64

# buildkit builds only the stage chosen here, so amd64 and a custom binary
# never pull the rust toolchain
FROM sia-native-${TARGETARCH:-unset}${SIA_STORAGE_NATIVE:+-custom} AS sia-native

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/sdk/package.json packages/sdk/
COPY packages/player/package.json packages/player/
COPY frontend/package.json frontend/
# every workspace manifest, so npm ci sees the same workspace tree as the
# lockfile describes
COPY examples/quickstart/package.json examples/quickstart/
COPY examples/vanilla/package.json examples/vanilla/
RUN npm ci --workspace=backend --include-workspace-root=false
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
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
COPY examples/vanilla/package.json examples/vanilla/
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
# /api/v1/docs serves scalar's prebuilt browser bundle. the package is a dev
# dependency so the image does not carry the ~180 packages it pulls in, which
# the bundle does not need at runtime
COPY --from=build /app/node_modules/@scalar/api-reference /app/node_modules/@scalar/api-reference
COPY --chown=node:node backend/drizzle ./drizzle
COPY --chown=node:node backend/scripts ./scripts

# the native sia-storage binary: on amd64 the published one stays, on arm64
# the source build replaces it, and SIA_STORAGE_NATIVE replaces it with a
# custom one. a bind mount, so the binary is not stored in a layer twice
ARG SIA_STORAGE_NPM_VERSION
RUN --mount=type=bind,from=sia-native,source=/out,target=/tmp/sia-native \
  set -e; \
  installed="$(node -p "require('/app/node_modules/@siafoundation/sia-storage/package.json').version")"; \
  if [ "$installed" != "$SIA_STORAGE_NPM_VERSION" ]; then \
    echo "installed @siafoundation/sia-storage $installed but the native build targets $SIA_STORAGE_NPM_VERSION: update SIA_STORAGE_NPM_VERSION and SIA_SDK_RS_COMMIT together" >&2; exit 1; \
  fi; \
  if [ -f /tmp/sia-native/sia-storage.node ]; then \
    arch="$(node -p process.arch)"; \
    target="$(dirname "$(node -p "require.resolve('@siafoundation/sia-storage-linux-$arch-gnu/sia-storage.node')")")"; \
    cp /tmp/sia-native/sia-storage.node "$target/sia-storage.node"; \
    echo "replaced the published sia-storage binary for $arch"; \
  fi

RUN mkdir -p /app/uploads /app/transcode-output \
  && chown -R node:node /app/uploads /app/transcode-output
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# migrations are idempotent (tracked in __drizzle_migrations), so running them
# on every start keeps a fresh database and an existing one in step. exec
# makes node the process docker signals, so SIGTERM reaches its shutdown
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
