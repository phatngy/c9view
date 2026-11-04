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
corepack pnpm dev        # server and web dev servers in parallel
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
