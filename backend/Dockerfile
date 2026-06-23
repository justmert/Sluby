FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist/
# Drizzle migrations are loaded at runtime from ./drizzle by migrate.js.
COPY drizzle ./drizzle
RUN mkdir -p /app/uploads /app/transcode-output /app/cache
EXPOSE 3000
# Run idempotent migrations at boot so deploys to fresh DBs Just Work,
# and pre-existing schemas stay untouched (tracked via
# `__drizzle_migrations`).
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
