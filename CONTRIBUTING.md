# Contributing to c9view

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- c9view **never modifies Claude data, project files or git repositories**; it writes only its index, its hook events and, through `c9view hooks install`, Claude settings. Changes must not add other writes except where the [constitution](.specify/memory/constitution.md) allows it. Please read its principles before a larger change.
- For anything beyond a small fix, open an issue first so we can agree on the approach.
- Never commit real Claude Code data. Tests use the synthetic data in [tests/fixtures/](tests/fixtures/README.md); keep secrets, real paths and conversation content out of fixtures, tests and logs.

## Development setup

Requires Node 22 or newer. Use pnpm through Corepack:

```sh
corepack enable
corepack pnpm install
corepack pnpm dev        # hub and web dev servers in parallel
```

To try a production build against your own `~/.claude`:

```sh
corepack pnpm build
node packages/cli/dist/main.js --open
```

## Checks

Every PR must pass these from the repository root (CI runs the same):

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

Format with `corepack pnpm format`. A change to what a page shows or how it lays out must add or update a Playwright end-to-end test. Install Chromium once with `corepack pnpm exec playwright install chromium`.

## Releasing

Maintainers only. Do not bump any version: workspace packages stay private at `0.0.0`, and the published `@phatngy/c9view` version comes from the tag. Push a tag `vX.Y.Z` (or `vX.Y.Z-rc.1` for a prerelease) on `main`. `.github/workflows/release.yml` then lints, tests and builds, assembles and smoke-tests the package (`packages/cli/scripts/release/`), publishes it to npm (prereleases to the `next` dist-tag), pushes `ghcr.io/phatngy/c9view` for amd64 and arm64, and creates a GitHub Release with generated notes. The tag's commit must be on `main`, or the release stops before anything is published. The tarball that is published is the exact file that passed the smoke test (its sha256 is checked before publishing). CI runs the same pack and smoke test on every PR; the smoke test installs the tarball on Linux, runs `--help`, a fixture `scan`, `hooks install` plus one silent hook run, and `start` with a health and index check.

One-time setup:

- npm: on npmjs.com open the `@phatngy/c9view` package settings (publish a first version by hand, or create the package) and add a Trusted Publisher for GitHub repository `phatngy/c9view`, workflow `release.yml`. No token is then needed. Alternatively add an `NPM_TOKEN` repository secret (a granular token that can publish the package); the workflow uses it when set.
- GHCR: after the first push, set the `c9view` package visibility to public in the GitHub package settings if you want anonymous pulls.

If a release half-fails: a rerun of the failed jobs is safe. The npm job skips a version that is already on npm, and the image job overwrites its own tags. If the GitHub Release job fails after the others succeeded, rerun only that job. A version published to npm cannot be replaced, so fix a bad package with a new tag.

To try the packaging locally: `corepack pnpm build`, then in `packages/cli` run `node --experimental-strip-types scripts/release/pack.ts --version 0.0.0-local` and `node --experimental-strip-types scripts/release/smoke.ts`.

## Code conventions

- Strict TypeScript, ESM only, no default exports except where a framework requires them.
- Parse external data with Zod and tolerate unknown fields; the Claude Code transcript format changes between versions.
- Colocate tests as `*.test.ts` / `*.test.tsx`.
- Keep modules small and focused.

More detail, including the repository layout, is in [AGENTS.md](AGENTS.md).

## Larger features

New features are planned with [Spec Kit](https://github.com/github/spec-kit): a spec, plan and tasks in `specs/NNN-feature/`, checked against the constitution. See the workflow in [AGENTS.md](AGENTS.md#workflow) and the existing features and roadmap in [specs/](specs/). Task-level progress is recorded in each feature's `tasks.md` under [specs/](specs/).

## Security

If you find a security issue, follow [SECURITY.md](SECURITY.md) to report it privately.
