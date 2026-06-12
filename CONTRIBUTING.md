# Contributing to Sluby

Thank you for your interest in contributing to Sluby! This guide will help you get started.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Environment Setup](#development-environment-setup)
- [Running the Project Locally](#running-the-project-locally)
- [Code Style Guidelines](#code-style-guidelines)
- [Running Tests](#running-tests)
- [Submitting Changes](#submitting-changes)
- [Move Contract Development](#move-contract-development)
- [Commit Message Conventions](#commit-message-conventions)
- [Issues and Pull Requests](#issues-and-pull-requests)
- [Code of Conduct](#code-of-conduct)

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js 20+** -- [Download](https://nodejs.org/)
- **Docker** and **Docker Compose** -- [Download](https://docs.docker.com/get-docker/)
- **Sia CLI** -- [Installation guide](https://docs.sui.io/build/install)
- **Git** -- [Download](https://git-scm.com/)

## Development Environment Setup

1. **Fork the repository** on GitHub and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/sluby.git
   cd sluby
   ```

2. **Copy the environment file** and configure it:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your local configuration (database credentials, Sia network settings, etc.).

3. **Install dependencies** from the repository root:

   ```bash
   npm install
   ```

   This installs dependencies for all workspaces (backend, packages/sdk, packages/react, frontend).

## Running the Project Locally

1. **Start infrastructure services** (PostgreSQL, Redis) with Docker:

   ```bash
   docker-compose up -d
   ```

2. **Run database migrations** (if applicable):

   ```bash
   npm run db:push --workspace=backend
   ```

3. **Start the development server**:

   ```bash
   npm run dev
   ```

   This starts the backend server with hot-reloading via `tsx watch`.

4. **Build all packages** (if you need to test the SDK or React components):

   ```bash
   npm run build
   ```

## Code Style Guidelines

We enforce consistent code style across the project:

- **TypeScript strict mode** is enabled in all packages. Do not use `any` unless absolutely necessary, and prefer explicit type annotations for function signatures.
- **ESLint** is configured with TypeScript support. Run the linter with:

  ```bash
  npm run lint
  ```

- **Prettier** is used for code formatting. Format your code with:

  ```bash
  npm run format
  ```

  Check formatting without writing changes:

  ```bash
  npm run format:check
  ```

- **General guidelines**:
  - Use `const` over `let` where possible; avoid `var`.
  - Prefer named exports over default exports.
  - Use async/await instead of raw Promises.
  - Keep functions small and focused.
  - Add JSDoc comments for public API surfaces (SDK and React packages).

## Running Tests

Tests are organized per package. Run them from the repository root:

- **Backend tests**:

  ```bash
  npm test --workspace=backend
  ```

- **SDK tests**:

  ```bash
  npm test --workspace=@sluby/sdk
  ```

- **React component tests**:

  ```bash
  npm test --workspace=@sluby/react
  ```

- **Move contract tests** (requires Sia CLI):

  ```bash
  cd contracts/video_manager
  sui move test
  ```

## Submitting Changes

We follow a standard fork-and-branch workflow:

1. **Fork** the repository on GitHub.
2. **Create a feature branch** from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

3. **Make your changes** in small, focused commits (see [Commit Message Conventions](#commit-message-conventions)).
4. **Run linting and tests** before pushing:

   ```bash
   npm run lint
   npm run format:check
   npm test --workspaces --if-present
   ```

5. **Push your branch** to your fork:

   ```bash
   git push origin feat/your-feature-name
   ```

6. **Open a Pull Request** against the `main` branch of the upstream repository.
7. **Respond to review feedback** -- maintainers may request changes before merging.

### Pull Request Guidelines

- Keep PRs focused on a single change. If you have multiple unrelated fixes, open separate PRs.
- Include a clear description of what the PR does and why.
- Reference any related issues (e.g., "Closes #42").
- Ensure CI passes before requesting review.

## Move Contract Development

The Move smart contracts live in `contracts/video_manager/`.

### Structure

- `sources/` -- Move module source files
- `tests/` -- Move test files
- `Move.toml` -- Package manifest

### Building Contracts

```bash
cd contracts/video_manager
sui move build
```

### Testing Contracts

```bash
cd contracts/video_manager
sui move test
```

### Guidelines

- Follow the [Move conventions](https://docs.sui.io/concepts/sui-move-concepts) for naming and module structure.
- Use `#[test]` attributes for unit tests and place them in the `tests/` directory.
- Document public functions with doc comments (`///`).
- Keep modules focused -- one module per logical domain concept.
- Use capability patterns for access control.
- Test all public entry functions and error paths.

## Commit Message Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation only changes                       |
| `style`    | Code style changes (formatting, no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | A code change that improves performance          |
| `test`     | Adding or correcting tests                       |
| `chore`    | Changes to build process or auxiliary tools       |
| `ci`       | Changes to CI configuration files and scripts    |

### Scopes

Use the package or area name as the scope: `backend`, `sdk`, `react`, `contracts`, `ci`, `docs`.

### Examples

```
feat(backend): add video transcoding queue with BullMQ
fix(sdk): handle timeout errors in upload client
docs: update README with deployment instructions
ci: add Move contract compilation to CI pipeline
chore: upgrade TypeScript to 5.7
```

## Issues and Pull Requests

### Opening Issues

- **Bug reports**: Include steps to reproduce, expected behavior, actual behavior, and environment details (Node version, OS, browser if applicable).
- **Feature requests**: Describe the use case, proposed solution, and any alternatives you have considered.
- Use the issue templates provided in the repository when available.

### Pull Request Templates

When opening a PR, please include:

- A summary of the changes and the motivation behind them.
- How the changes were tested.
- Any breaking changes or migration steps.
- Screenshots or recordings for UI changes.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.
