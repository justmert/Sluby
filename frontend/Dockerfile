# syntax=docker/dockerfile:1
# the web image: the studio build served by nginx, which also proxies the api
# and caches delivery. build from the repo root:
#   docker build -f frontend/Dockerfile .

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/sdk/package.json packages/sdk/
COPY packages/player/package.json packages/player/
COPY frontend/package.json frontend/
COPY examples/quickstart/package.json examples/quickstart/
RUN npm ci --workspace=sluby-frontend --include-workspace-root=false
# the studio compiles the sdk and player from source (vite alias)
COPY packages/sdk/src packages/sdk/src
COPY packages/player/src packages/player/src
COPY frontend frontend
# a studio test checks its api paths against the backend's openapi document,
# and the build typechecks tests too
COPY backend/src/api/openapi.ts backend/src/api/openapi.ts
# optional publishable viewer identity for direct-from-sia playback
ARG VITE_SLUBY_SIA_INDEXER_URL=
ARG VITE_SLUBY_SIA_APP_ID=
ARG VITE_SLUBY_SIA_APP_KEY=
ARG VITE_SIA_EXPLORER_URL=
RUN npm run build --workspace=sluby-frontend

FROM nginx:1-alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/conf.d/sia-aggregator.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/studio || exit 1
