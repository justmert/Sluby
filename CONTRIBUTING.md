# Contributing to SiaStream

Thanks for your interest in contributing! This guide covers the day-to-day
mechanics of working on the repo.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting set up](#getting-set-up)
- [Running the project locally](#running-the-project-locally)
- [Code style](#code-style)
- [Running tests](#running-tests)
- [Submitting changes](#submitting-changes)
- [Commit message conventions](#commit-message-conventions)
- [Issues and pull requests](#issues-and-pull-requests)
- [Code of conduct](#code-of-conduct)

## Prerequisites

- **Node.js 20+** — [download](https://nodejs.org/)
- **Docker** and **Docker Compose** — [install](https://docs.docker.com/get-docker/)
- **FFmpeg 5+** — required only when running the backend outside Docker
- **Git**

## Getting set up

1. Fork and clone:

   ```bash
   git clone https://github.com/<your-username>/sia-stream.git
   cd sia-stream
   ```

2. Copy the env template and adjust it for your environment:

   ```bash
   cp .env.example .env
   ```

   At minimum you'll need valid `SIA_APP_ID` / `SIA_APP_KEY` values before the
   backend will start. Either run the onboarding helper
   (`cd backend && npm run sia:onboard`) against a live Sia indexer, or point
   `SIA_INDEXER_URL` at a local stack started with
   `docker compose -f docker-compose.sia.yml up -d` and onboard against that.

3. Install dependencies from the repo root:

   ```bash
   npm install
   ```

   This installs every workspace (`backend`, `packages/sdk`, `packages/react`,
   `frontend`).

## Running the project locally

Start infrastructure (Postgres + Redis + Nginx proxy + backend container):

```bash
docker compose up -d
```

Apply database migrations when schema changes land:

```bash
npm run db:push --workspace=backend
```

Run the backend with hot reload (outside Docker) in a separate shell:

```bash
npm run dev
```

Run the frontend:

```bash
npm run dev:frontend
```

Build every workspace:

```bash
npm run build
```

## Code style

- **TypeScript strict mode** across all packages. Avoid `any`; prefer explicit
  types for public function signatures.
- **ESLint**:

  ```bash
  npm run lint
  ```

- **Prettier** for formatting:

  ```bash
  npm run format          # write
  npm run format:check    # check only
  ```

- General guidance:
  - `const` over `let`; avoid `var`.
  - Prefer named exports.
  - Use `async`/`await` over raw Promises.
  - Keep functions small and focused.
  - Add JSDoc to public surfaces (SDK + React package).

## Running tests

Tests live per-package. From the repo root:

```bash
npm test --workspace=backend
npm test --workspace=@siastream/sdk
npm test --workspace=@siastream/react
```

Or run all tests where present:

```bash
npm test --workspaces --if-present
```

## Submitting changes

1. Branch from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make small, focused commits (see
   [Commit message conventions](#commit-message-conventions)).

3. Before pushing:

   ```bash
   npm run lint
   npm run format:check
   npm test --workspaces --if-present
   ```

4. Push and open a pull request against `main`.

### Pull request guidelines

- Keep PRs focused on a single change. Split unrelated fixes.
- Describe what the PR does and why.
- Reference related issues (e.g. "Closes #42").
- Make sure CI is green before requesting review.

## Commit message conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                              |
| ---------- | -------------------------------------------------------- |
| `feat`     | A new feature                                            |
| `fix`      | A bug fix                                                |
| `docs`     | Documentation-only changes                               |
| `style`    | Formatting / cosmetic (no behavior change)               |
| `refactor` | Refactor that neither fixes a bug nor adds a feature     |
| `perf`     | Performance improvement                                  |
| `test`     | Adding or correcting tests                               |
| `chore`    | Build / tooling / housekeeping                           |
| `ci`       | CI configuration and scripts                             |

### Scopes

Use the package or area name: `backend`, `sdk`, `react`, `frontend`, `ci`, `docs`.

### Examples

```
feat(backend): add video transcoding queue with BullMQ
fix(sdk): handle timeout errors in upload client
docs: update README with deployment instructions
chore: upgrade TypeScript to 5.7
```

## Issues and pull requests

### Opening issues

- **Bug reports**: include reproduction steps, expected vs. actual behavior,
  and environment details (Node version, OS, browser if applicable).
- **Feature requests**: describe the use case, proposed solution, and any
  alternatives you considered.

### Pull request template

When opening a PR, include:

- A summary of the change and the motivation.
- How you tested it.
- Any breaking changes or migration steps.
- Screenshots or recordings for UI changes.

## Code of conduct

This project follows the
[Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
By participating you agree to uphold it; please report unacceptable behavior
to the project maintainers.
