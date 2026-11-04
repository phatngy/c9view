# Agent instructions

c9view is a local web dashboard for Claude Code projects, sessions, config and token usage, built with TypeScript in a pnpm workspace. It reads `~/.claude` (or `C9VIEW_CLAUDE_DIR`), project folders and token prices, and checks whether each session's process is still running; it also reads `.claude.json` next to the Claude data directory (normally `~/.claude.json`), read-only for MCP configuration. It writes its SQLite index and hook events, and changes Claude settings only through `c9view hooks install/uninstall`. See [specs/](specs/) (Spec Kit feature specs, plans and tasks), [.specify/memory/constitution.md](.specify/memory/constitution.md) (project principles) and [docs/data-sources.md](docs/data-sources.md). Human contributors start with [CONTRIBUTING.md](CONTRIBUTING.md); the multi-agent setup the maintainer uses is in [docs/ai-workflow.md](docs/ai-workflow.md).

## Repository layout

- Root configuration and metadata: workspace scripts, strict TypeScript settings, lint and format rules, project instructions, `Dockerfile` and `docker-compose.yml`.
- `.github/workflows/`: continuous integration.
- `packages/core/`: core library (Claude and project data, status detection, the SQLite index, safe file and git access).
- `packages/api/`: shared HTTP contract types.
- `packages/cli/`: the `c9view` command (`start`, `scan`, `hooks`).
- `apps/server/`: Hono server; `src/main.ts` starts it and `src/app.ts` defines the app.
- `apps/web/`: React application, styles and tests.
- `tests/fixtures/`: synthetic Claude Code data for core and CLI tests.
- `apps/server/test/fixtures/`: synthetic Claude Code data for server tests.
- `tests/e2e/`: Playwright end-to-end tests.
- `docs/`: data sources, deployment, research and the AI workflow.
- `specs/NNN-feature/`: Spec Kit spec, plan, tasks and design artifacts per feature.
- `.specify/`: Spec Kit constitution, templates and scripts. `.claude/skills/` and `.agents/skills/` hold the same `speckit-*` skills for Claude Code and Codex.

## Commands

Always invoke pnpm through Corepack:

- Install: `corepack pnpm install`
- Develop: `corepack pnpm dev` (runs the server and web dev servers in parallel).
- Build: `corepack pnpm build`
- Lint: `corepack pnpm lint`
- Typecheck: `corepack pnpm typecheck`
- Test: `corepack pnpm test`
- Test end-to-end: `corepack pnpm test:e2e`
- Test one package: `corepack pnpm --filter @c9view/core test`
- Format: `corepack pnpm format`

## Conventions

- Use strict TypeScript and ESM only. Avoid default exports except where frameworks require them (Vite config and React route files).
- Use Zod to parse external data and tolerate unknown fields.
- Today c9view writes hook events only to its state folder (`C9VIEW_STATE_DIR`, default `$XDG_STATE_HOME/c9view` or `~/.local/state/c9view`), its SQLite index (`C9VIEW_DB`), and Claude settings through `c9view hooks install/uninstall` (diff shown first, backup made). `.claude.json` next to the Claude data directory (normally `~/.claude.json`), read for MCP configuration, is read-only; all other git access goes through `createGit`; all dashboard data access remains read-only. Claude Code processes that c9view starts write their own data. Planned (001/002): the state folder moves to `~/.claude/c9view/`, plus `c9view node install-service/uninstall-service` and, with session control on, project creation under workspace roots through a hardened git runner.
- Hook entry imports must stay dependency-free (`node:` built-ins and the local hooks whitelist only); discard payloads and keep hook execution silent.
- Keep secrets, real paths and real conversation content out of fixtures, tests and logs.
- Colocate tests as `*.test.ts` (or `*.test.tsx` for JSX tests).
- Keep modules small and focused.

## Workflow

New features use [Spec Kit](https://github.com/github/spec-kit). Every spec and plan is checked against the [constitution](.specify/memory/constitution.md); change it only with `/speckit-constitution` in a PR.

1. Plan a feature in its own worktree branched from the latest `main` (`git worktree add -b feat/x .worktrees/feat-x main`). Spec Kit tracks the current feature per checkout in the git-ignored `.specify/feature.json`. Feature numbers come from the checkout's `specs/`, so plan one feature at a time; if another feature's spec PR is still open, give `/speckit-specify` the full directory with the next free number (for example `SPECIFY_FEATURE_DIRECTORY=specs/004-feature`).
2. `/speckit-specify <description>` writes `specs/NNN-feature/spec.md`; `/speckit-clarify` asks the maintainer up to 5 questions and records the answers.
3. `/speckit-plan` writes `plan.md` (with the Constitution Check), `research.md`, `data-model.md`, `contracts/` and `quickstart.md`. Split the work into PRs and name the files each PR owns.
4. `/speckit-tasks` writes `tasks.md`; `/speckit-analyze` checks spec, plan and tasks against each other and the constitution. Fix what it finds.
5. Once the maintainer approves, commit `specs/NNN-feature/` with its row in `specs/README.md` as the first commit on the feature's branch.
6. Build one PR at a time with `/speckit-implement` for the task IDs of that PR, ticking tasks in `tasks.md`. Editing checklist items (not ticking them after review) needs the maintainer's approval. Run `/speckit-converge` before closing a feature.
7. Run root `lint`, `typecheck`, `test`, `build` and `test:e2e` before declaring work done. UI changes add or update a Playwright end-to-end test. Shared barrels (`packages/core/src/index.ts`, `packages/api/src/index.ts`) only get additive edits.

When a lead agent splits work across other agents, follow [docs/ai-workflow.md](docs/ai-workflow.md#agent-team).
