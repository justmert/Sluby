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

- Node.js 22.23.2 or a later 22.x, 24.18.1 or a later 24.x, or 26.5.1 or newer (the July 2026 security releases of each line), and npm
- Docker with Compose v2
- FFmpeg 5 or newer, only if you run the backend outside Docker. HDR sources and the HDR cases of `ffmpeg.integration.test.ts` need it built with zimg (the `zscale` filter): Debian and Ubuntu packages are, Homebrew's is not, and the test skips those cases locally without it
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
# the dev override publishes postgres on 5433 and redis on 6380
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

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

## Running the tests

`npm test --workspaces --if-present` runs every unit suite. Some backend tests need services, and skip with a message naming what is missing when they are not there:

- **PostgreSQL** for the query, migration and contract tests: point `SLUBY_TEST_DATABASE_URL` at a server where the user may create databases. Each test file creates, migrates and drops its own database.
- **Redis** for the queue, schedule and prune-gate tests: point `SLUBY_TEST_REDIS_URL` at a server. Each test uses its own key prefix and cleans up after itself.
- **FFmpeg and ffprobe** on `PATH` for `ffmpeg.integration.test.ts`. Its HDR cases also need the `zscale` filter (FFmpeg built with zimg); Debian and Ubuntu packages have it, Homebrew's does not, so on a Mac run that file in a container, for example `node:24-trixie-slim` with `apt-get install ffmpeg`.
- **Docker** for `nginx-delivery.integration.test.ts`, which runs the shipped nginx config in a container in front of the real backend.

```sh
docker run -d --name sluby-test-pg -e POSTGRES_PASSWORD=sluby-test -p 55432:5432 postgres:18-alpine
docker run -d --name sluby-test-redis -p 56379:6379 redis:8-alpine

SLUBY_TEST_DATABASE_URL=postgres://postgres:sluby-test@localhost:55432/postgres \
SLUBY_TEST_REDIS_URL=redis://localhost:56379 \
  npm test --workspace=backend
```

With `CI=true` nothing is skipped: a missing service fails the run instead, as in CI.

The SDK and player also have browser suites, which run in real Chromium, Firefox and WebKit through Playwright. Install the browsers once, then run them:

```sh
npx playwright install chromium firefox webkit
npm run test:browser --workspace=@sluby/sdk
npm run test:browser --workspace=@sluby/player
```

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

## Releasing

`@sluby/sdk` and `@sluby/player` are published to npm by `.github/workflows/release.yml` when a tag is pushed. npm authenticates the workflow through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token in the repository, and every release gets a provenance attestation.

One-time setup:

- in the repository settings, create an environment named `npm` with required reviewers, so a maintainer approves every publish
- per package, on npmjs.com under the package's settings: add a trusted publisher for GitHub Actions with the repository owner `justmert`, repository `Sluby`, workflow filename `release.yml` and environment `npm`
- a tag ruleset that limits who may push `sdk-v*` and `player-v*` tags

To release a package:

1. Bump `version` in its `package.json` and move the `Unreleased` notes in its `CHANGELOG.md` under that version.
2. Run `npm run check:packages`. It packs both packages the way `npm publish` does, checks the tarballs with attw and publint, renders the player on the server and type-checks a strict consumer project.
3. Merge to `main`, then tag the merge commit and push the tag: `sdk-v<version>` for the SDK, `player-v<version>` for the player.
4. Approve the run in the `npm` environment, then check the release with `npm view @sluby/sdk@<version> dist.attestations`.

`scripts/release-check.sh` refuses to publish a tag that is not of that form, whose commit is not on `main`, or that does not match the version in `package.json`. A prerelease version (such as `0.3.0-rc.1`) is published under the `next` dist-tag.

## License

Sluby is licensed under the [Apache License 2.0](./LICENSE). By submitting a contribution you agree that it is licensed under the same terms, as section 5 of the license describes.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to uphold it; please report unacceptable behavior to the project maintainers.
