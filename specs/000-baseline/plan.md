# Implementation Plan: Baseline: c9view as shipped

**Branch**: `chore/public-release` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/000-baseline/spec.md`

## Summary

This plan records how c9view is built today. Nothing is implemented from it: it is the as-built architecture that later features (001-multi-machine, 002-session-control) change. A Node 22 Hono server reads Claude Code data through `@c9view/core`, keeps a rebuildable SQLite index, decides session status from hook events, live status files and transcripts, serves a JSON API (types in `@c9view/api`) and an SSE stream, and serves a React 19 single-page app. One CLI (`c9view`) starts it, scans, installs hooks and receives hook events.

## Technical Context

**Language/Version**: TypeScript 6 (strict, ESM only), Node >= 22, pnpm 12 through Corepack

**Primary Dependencies**: server: Hono 4, `@hono/node-server`, Zod 4. Core: better-sqlite3, Drizzle ORM (drizzle-kit for migrations), chokidar 6, `diff` (jsdiff), `yaml`, Zod. Web: React 19, Vite 8, TanStack Router and Query, Tailwind 4, Base UI, lucide-react, react-markdown with remark-gfm, Shiki, self-hosted `@fontsource` IBM Plex Sans and Mono

**Storage**: Claude data files (read-only, source of truth); SQLite index at `C9VIEW_DB` (default `<cache dir>/c9view/index.sqlite`, outside the Claude data directory, WAL mode, FTS5); hook events file `events.jsonl` in the state directory (`C9VIEW_STATE_DIR`, default `$XDG_STATE_HOME/c9view`)

**Testing**: Vitest in every package (colocated `*.test.ts` and `*.test.tsx`, jsdom and Testing Library for the web); synthetic fixtures in `tests/fixtures/claude`; Playwright end-to-end suite in `tests/e2e/`, run with `corepack pnpm test:e2e` and in CI.

**Target Platform**: Linux, macOS and Windows with Node 22; Docker image on `node:22-bookworm-slim`

**Project Type**: web application in a pnpm monorepo: library (`core`), contract package (`api`), CLI, server and SPA

**Performance Goals**: full scan of ~35 projects about 12 s, no-op rescan about 0.3 s, incremental append a few ms; 10,000+ message sessions stay scrollable

**Constraints**: read-only toward `~/.claude` and project folders; loopback by default; no remote content in the browser; secrets hidden before leaving the server; no text under 12 px

**Scale/Scope**: one machine, one owner, years of history (hundreds of MB of transcripts); 5 web routes (Overview, Project, Session, Config, Search) plus Login

## Constitution Check

_GATE: checked against `.specify/memory/constitution.md` v1.0.0. The baseline must pass._

| Principle                               | Status          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Never Change Claude Data or Projects | Pass            | `apps/server` and `core` only read `~/.claude` and project folders. The only Claude-side write is `c9view hooks install/uninstall` (diff first, backup, then write: `packages/core/src/hooks/settings.ts`, `packages/cli/src/hooks.ts`). The hook receiver writes only `events.jsonl` in its state directory. The index lives outside the Claude data directory (`assertIndexPath`). Git goes through `createGit` (`packages/core/src/git/index.ts`). Docker mounts data read-only. The node-side exceptions in the constitution (service file, session control, clone) are not shipped. |
| II. Private by Default                  | Pass            | `redactText` and `redactStrings` run on every API response (`apps/server/src/data/redaction.ts`); file access policy (`files/policy.ts`) denies secret files and keeps to the real path; size and binary limits apply; the web loads no remote content; fixtures are synthetic.                                                                                                                                                                                                                                                                                                          |
| III. Local First, Explicit Exposure     | Pass            | Default host `127.0.0.1`; `validateExposure` refuses non-loopback or extra hosts without login unless `C9VIEW_INSECURE_NO_AUTH=1` (warning); auth does not exempt loopback; Host and Origin are checked on every request; tunnel hosts need `C9VIEW_ALLOWED_HOSTS`. The constitution's clauses about session control and paired nodes do not apply (not shipped); `/api/nodes/connect` does not exist yet.                                                                                                                                                                               |
| IV. Tolerant Parsing                    | Pass            | Zod schemas with unknown-field tolerance for transcripts, `sessions/*.json`, settings, hook payloads and prices; unknown record types are counted. The index is a cache rebuilt on schema-version mismatch, deletion or file replacement. The hub store and node state store are not shipped.                                                                                                                                                                                                                                                                                            |
| V. Strict, Small, Tested Code           | Pass with notes | Strict TS, ESM, colocated tests, shared HTTP types in `@c9view/api`. Default exports appear only for Vite config. Note: `packages/api/src/index.ts` is one 300-line file, larger than "small"; split it if an additive change makes it unwieldy. The hook entry imports only `node:` built-ins and the local whitelist (`hooks/fields.ts`).                                                                                                                                                                                                                                              |
| VI. Fast on Large Data                  | Pass            | Streaming reader with byte offsets; chokidar incremental updates; sessions load newest-first in pages (limit 200, maximum 1000); web virtualizes conversation and diffs. The full scan on first run is justified (SC-001). Search and usage queries run on SQLite.                                                                                                                                                                                                                                                                                                                       |
| VII. Honest and Accessible UI           | Pass            | "API-equivalent" label on costs; status reason, confidence and stale flag; kit components on Base UI; `prefers-reduced-motion`; 390 px layouts; 12 px minimum; long tool output collapses and expands in full.                                                                                                                                                                                                                                                                                                                                                                           |

**Technology Constraints**: the workspace today is `packages/core`, `packages/api`, `packages/cli`, `apps/server`, `apps/web`, which matches the constitution's list. The constitution names `apps/hub` and `packages/node` as arriving in 001-multi-machine PR 6.0a.

**Gate result**: passes with no violations.

## Project Structure

### Documentation (this feature)

```text
specs/000-baseline/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── contracts/
    ├── http-api.md
    ├── cli.md
    └── live-events.md
```

`tasks.md` is written separately from these files.

### Source Code (repository root, as built)

```text
.
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc
├── Dockerfile, docker-compose.yml, .dockerignore
├── AGENTS.md, CLAUDE.md, CONTRIBUTING.md, README.md, LICENSE
├── .github/workflows/ci.yml          # lint, typecheck, test, build on push and PR
├── .specify/                         # Spec Kit constitution, templates, scripts
├── .claude/skills/, .agents/skills/  # speckit-* skills
├── docs/                             # data-sources, deploy, research, ai-workflow
├── specs/                            # 000-baseline, 001-multi-machine, 002-session-control
├── playwright.config.ts
├── tests/e2e/                        # Playwright end-to-end suite
├── tests/fixtures/claude/            # synthetic projects/, sessions/, settings.json, stats-cache.json
├── packages/
│   ├── api/src/index.ts              # shared HTTP contract types and KANBAN_COLUMNS
│   ├── cli/src/                      # main.ts (arg parsing, hook fast path), start.ts, hooks.ts
│   └── core/
│       ├── drizzle.config.ts
│       └── src/
│           ├── config/               # loadConfig (claudeDir, workspaceRoots, dbPath)
│           ├── projects/             # discovery, path resolution
│           ├── transcript/           # schemas, reader, summary, usage, subagents
│           ├── stats/                # stats-cache.json, history.jsonl
│           ├── pricing/              # LiteLLM table, override file, costOf
│           ├── claude-config/        # settings, documents (CLAUDE.md), hooks, mcp, plugins, frontmatter
│           ├── redact/               # redactText
│           ├── index-db/             # schema.ts, migrations/, indexer, queries, paths
│           ├── watch/                # chokidar watcher
│           ├── scan/                 # scan()
│           ├── files/                # createFileAccess, policy (deny-list, binary)
│           ├── git/                  # createGit (read-only runner), parseGitDiff
│           ├── changes/              # tools, history (file-history), notebook, types
│           ├── hooks/                # events, fields (whitelist), hook-entry (writer), settings
│           ├── status/               # decideStatus, transcript status inputs
│           └── index.ts              # barrel
├── apps/
│   ├── server/src/
│   │   ├── main.ts                   # startServer, shutdown
│   │   ├── app.ts                    # createApp: Host/Origin check, auth, routes, static files
│   │   ├── auth/index.ts             # token and password login, exposure validation
│   │   ├── routes/                   # health, overview, projects, sessions, config, usage, search, events, files, changes
│   │   └── data/                     # store (DataStore), cache, indexed queries, status, usage, config, events (EventHub), hook-events, file-project, inline-changes, messages, redaction, start-index
│   └── web/src/
│       ├── main.tsx, router.tsx, App.tsx, application.tsx, api.ts, style.css, login.tsx
│       ├── overview.tsx, overview/   # Overview page
│       ├── project.tsx, project/     # board, list, header, controls, sessions
│       ├── session.tsx, session/     # conversation, header/, chat/, Sidebar, rail, export, paging
│       ├── config-page.tsx, config.tsx, config/
│       ├── search/                   # Search page, TopSearch, snippet cleaning
│       ├── files/, diff/             # file tree and viewer, project and session changes, diff view
│       ├── tools/                    # Bash, Edit, Todo, Question and generic tool cards
│       ├── charts/, usage/          # usage charts and section
│       ├── shell/                    # AppShell, Sidebar, TopBar, breadcrumbs, ProjectName, ThemeMenu
│       ├── kit/                      # Base UI based components and tokens helpers
│       └── live/                     # SSE client, query invalidation, polling fallback
```

**Structure Decision**: a pnpm workspace with a core library that has no HTTP knowledge, a contract package shared by server and web, a thin server that composes core with caching and redaction, and a CLI that starts the server in process. 001-multi-machine PR 6.0a renames `apps/server` to `apps/hub` and adds `packages/node`; the `DataStore` and `data/` modules then move toward the node, behind a `NodeTransport`. Tasks written from this baseline MUST use the path names above and expect that rename.

## Complexity Tracking

| Violation                            | Why needed                             | Simpler alternative rejected because                                           |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| `@c9view/api` is a single large file | One import path for all contract types | Splitting is a refactor with no behaviour change; do it when a change needs it |
