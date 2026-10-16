# Contributing to Sluby

Thanks for helping out. This covers how the repository is laid out, how to run it, and what a pull request needs before it can be merged.

## Repository layout

| Path                | What it is                                                                      |
| ------------------- | ------------------------------------------------------------------------------- |
| `backend/`          | API server and queue workers (Express, BullMQ, Drizzle, FFmpeg, the Sia SDK)    |
| `packages/sdk/`     | `@sluby/sdk`, the TypeScript API client                                         |
| `packages/player/`  | `@sluby/player`, the React player (hls.js, direct-from-Sia loader)              |
| `frontend/`         | the Studio (Vite, React, shadcn/ui)                                             |
| `examples/`         | example apps built on the SDK and player                                        |
| `docs/`             | the documentation site (VitePress), a standalone package with its own lockfile  |
| `nginx/`, `deploy/` | the web front door's nginx config and the Caddyfile for the production override |

The root is an npm workspace for everything except `docs/`, which stays separate so its toolchain does not change the app's dependency tree.

## Prerequisites

- Node.js 22.12 or newer and npm
- Docker with Compose v2
- FFmpeg 5 or newer, only if you run the backend outside Docker
- a Sia indexer account (the free tier at [sia.storage](https://sia.storage) is enough) for anything that uploads. Unit tests do not need one.

## Setting up

```sh
git clone https://github.com/<your-username>/Sluby.git
cd Sluby
npm ci
cp .env.example .env
```

To upload for real, register an app with your indexer once and put the printed `SIA_APP_ID` and `SIA_APP_KEY` into `.env`:

```sh
npm run connect-indexer --workspace=backend
```

## Running it

The whole stack in Docker, as in the [quickstart](./docs/guide/quickstart.md):

```sh
docker compose up -d
```

Or the backend and Studio from source with PostgreSQL and Redis in Docker, which gives hot reload:

```sh
docker compose up -d postgres redis

export DATABASE_URL=postgresql://sluby:sluby@localhost:5433/sluby
export REDIS_URL=redis://localhost:6380
export PUBLIC_URL=http://localhost:5173

npm run db:migrate --workspace=backend
npm run dev                  # backend on :3000
npm run dev:frontend         # Studio on :5173, proxies /api and /v1 to :3000
```

Schema changes go in `backend/src/db/schema.ts`; generate the migration with `npm run db:generate --workspace=backend` and commit the files it writes under `backend/drizzle/`.

The docs site:

```sh
npm ci --prefix docs
npm run docs:dev
```

## Checks

CI runs the same checks on every pull request. Run them locally first:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test --workspaces --if-present
npm run build
npm run docs:build
```

Run Prettier and ESLint from the repository root so they pick up the shared config.

## Writing code

- TypeScript in strict mode everywhere. Type public function signatures explicitly and avoid `any`.
- Match the style of the code around you. Prettier handles formatting.
- Comments explain why something is done, not what the next line does. Keep them short and plain.
- Tests exercise real logic. Fake only true external boundaries such as the Sia network or GitHub, never the code under test.
- A change to the API updates `backend/src/api/openapi.ts` in the same pull request; a test fails when the document and the routes disagree.
- User-facing behavior changes update the docs in the same pull request.

## Pull requests

- One focused change per pull request. Split unrelated fixes into their own.
- Describe what changed, why, and how you tested it. Include screenshots for Studio changes.
- Commit messages are a short, plain, one-line summary of the change, like the ones already in `git log`.
- Keep CI green. A reviewer merges once it is.

## License

Sluby is licensed under the [Apache License 2.0](./LICENSE). By submitting a contribution you agree that it is licensed under the same terms, as section 5 of the license describes.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to uphold it; please report unacceptable behavior to the project maintainers.
