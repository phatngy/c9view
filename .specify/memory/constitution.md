# c9view Constitution

## Core Principles

### I. Never Change Claude Data or Projects

c9view MUST NOT write to the Claude data directory (`~/.claude` or `C9VIEW_CLAUDE_DIR`) or to any
project working folder, with exactly these exceptions:

- c9view's own state folder `~/.claude/c9view/` (or `C9VIEW_STATE_DIR`), for node identity, the
  node state store, the hub store and hook events (it replaces the hook state folder
  `~/.local/state/c9view/` in 001-multi-machine PR 6.0d). The folder MUST be 0700 and its files 0600,
  symlinked or foreign-owned folders and symlinked files MUST be refused, and every Claude data
  reader (watcher, indexer, scanner, config readers, project discovery) MUST ignore it.
- `c9view hooks install` / `uninstall`, which the user runs; it MUST show the diff, back up
  `settings.json`, and then write.
- A user service file (`c9view node install-service` / `uninstall-service`) in the OS service
  folder, which the user runs; it MUST print the file first and write only after confirmation.
- With session control on, creating a project folder, `git init` and `git clone`, only under the
  configured workspace roots, only on an explicit request, and never auto-trusted. They MUST use
  their own hardened git runner, separate from `createGit`.

Nothing else under `~/.claude` or in a project folder is written by c9view; the Claude Code processes
it starts with control on write their own data, in `~/.claude` and in the project folder they run in. `~/.claude.json` is read-only. All other git access MUST be read-only and go
through `createGit` in `packages/core/src/git/`: `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`,
`execFile` with no shell, a timeout, repository-configured hooks, fsmonitor, filter drivers,
external diff and credential or network commands disabled, and a whitelisted environment with no
inherited `GIT_*` variables. Data mounts in Docker MUST be read-only, except the c9view state
folder. Features that act on sessions (reply, approve, resume, config editing) MUST be opt-in and
specified in their own spec with their own guard.

Besides the exceptions above, c9view writes only its SQLite index (`C9VIEW_DB`, by default in the
user cache folder, outside the Claude data directory and project folders), which can be rebuilt from
the source files at any time.

Rationale: users point c9view at their real Claude Code history; it must never corrupt it.
Apart from the settings changes the user runs, everything c9view writes is in its own documented
folders, which the user can inspect or delete.

### II. Private by Default

Conversations and project files contain secrets. Secret hiding MUST apply to config values, message
text, search snippets and file contents before they leave the server. Fixtures MUST be synthetic or
sanitized, and logs MUST NOT contain secrets or message content. Project file access MUST stay inside
the project's real path, honour the deny-list and `.gitignore`, and enforce size and binary limits.
The web app MUST NOT load remote images or other remote content from transcript data.

Rationale: a dashboard over private history is only safe if leaking is the hard path.

### III. Local First, Explicit Exposure

The server MUST listen on 127.0.0.1 by default; login is optional only there. It MUST refuse to
start on a non-loopback host or with extra allowed hosts unless login is enabled; the escape is the
explicit `C9VIEW_INSECURE_NO_AUTH=1`, which MUST print a warning. With session control on, or with a
paired remote node, login MUST be required on every host including loopback, at startup and at
runtime, and no override (including `C9VIEW_INSECURE_NO_AUTH`) applies: without login the hub MUST
refuse to pair or accept a node, and a node with control MUST refuse to run against a hub without
login. When login is enabled, loopback requests MUST NOT be
exempt, because tunnels deliver every request from loopback. Host and Origin MUST be checked on
every request, except the node connection path (`/api/nodes/connect`), which MUST be checked on Host
and authenticated by the node's signed key challenge instead of Origin and login. Tunnel hostnames
MUST be listed explicitly in `C9VIEW_ALLOWED_HOSTS`.

Rationale: "local means trusted" breaks the moment someone adds a tunnel, and a dashboard that can
run code must never be reachable without login.

### IV. Tolerant Parsing

Every external input (transcripts, `sessions/*.json`, settings, hook payloads, price tables) MUST be
parsed with Zod schemas that tolerate unknown fields. Unknown record types MUST be counted and
skipped, never fatal. The SQLite index is a cache: it MUST be rebuildable from the files at any time,
and file data stays the source of truth. The hub store (paired machines) and the node state store
(folder trust, session labels) are persistent state, not cache: they MUST stay separate from the
index and survive its rebuild.

Rationale: the Claude Code transcript format is undocumented and changes between versions.

### V. Strict, Small, Tested Code

Code MUST be strict TypeScript and ESM only, with no default exports except where a framework requires
them (Vite config, React route files). Modules SHOULD stay small and focused. Tests MUST be colocated
as `*.test.ts` / `*.test.tsx`, and every bug fix MUST come with a regression test. Hook entry imports
MUST be dependency-free (`node:` built-ins and the local hooks whitelist only), discard payloads and
stay silent. Shared HTTP types MUST live in `@c9view/api`; hub–node wire types (transport envelopes
and frames) live in `packages/node`. API changes SHOULD be additive; a non-additive route or health
change MUST be justified in the feature's plan.

Rationale: the codebase is built by several agents in parallel; strict types and small units keep
their work reviewable and composable.

### VI. Fast on Large Data

Transcripts can be hundreds of megabytes and sessions can have 10,000+ messages. Readers MUST stream
and resume from the last byte offset instead of rereading files. Watchers MUST update the index
incrementally. Long lists MUST be virtualized, and sessions load newest-first in pages. A feature
that adds a full scan or an unbounded response MUST justify it in its plan.

Rationale: the dashboard is only useful if it stays fast on real, years-long histories.

### VII. Honest and Accessible UI

Every cost figure MUST be labelled API-equivalent. Every derived status MUST show its reason and
confidence, and be marked stale when evidence is old or disagrees. UI MUST be keyboard and
screen-reader accessible, respect `prefers-reduced-motion`, work at 390 px phone width, use the design
tokens and `kit/` components, and keep text at 12 px or larger. Long tool output MAY collapse but MUST
always be expandable in full.

Rationale: users act on what the dashboard tells them; it must not overstate certainty or hide data.

## Technology Constraints

- pnpm workspace through Corepack: `packages/core`, `packages/api`, `packages/cli`, `apps/server`,
  `apps/web`. `apps/hub` (renamed from `apps/server`) and `packages/node` arrive in 001-multi-machine PR 6.0a.
- Node 22 and Hono on the server; SSE for live updates to the browser; a WebSocket between hub and
  remote nodes; SQLite (better-sqlite3 + Drizzle) for the
  index with generated migrations; chokidar for file watching.
- React 19, Vite, TanStack Router and Query, Tailwind, Base UI primitives and lucide icons on the web.
- Vitest (with Testing Library for the web) for unit and component tests; Playwright for end-to-end
  UI tests, run in CI against the built app and synthetic fixtures.
- New runtime dependencies MUST be justified in the feature's plan. The Claude Agent SDK (session
  control) and a WebSocket server (hub–node transport) are allowed when their plans justify them.
  Lockfiles change only in the maintainer's commits.

## Development Workflow and Quality Gates

- Features follow Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-analyze`, producing `specs/NNN-feature/`, and `/speckit-converge`
  before the feature is closed. The plan's Constitution Check MUST pass, or each violation MUST be
  justified in its Complexity Tracking table.
- One branch and one git worktree per task under `.worktrees/`. The approved `specs/NNN-feature/`,
  with the feature's row in `specs/README.md`, is the first commit on the feature's branch.
- Every PR MUST pass root `lint`, `typecheck`, `test`, `build` and `test:e2e`. A change to what a
  page shows or how it lays out MUST add or update a Playwright end-to-end test; screenshots are not
  a substitute.
- Every PR MUST get an independent review, and fixes MUST be re-reviewed. Merge only when the review
  approves and every CI run is green. A pass/fail split on one commit is a flaky test to fix.
- `AGENTS.md` holds the day-to-day commands; `docs/ai-workflow.md` holds the agent team and spawning details.

## Governance

This constitution overrides other practices when they conflict. `AGENTS.md`, `README.md` and the
specs MUST stay consistent with it. Amendments go through a PR that edits this file, states the
version bump, and updates any dependent docs in the same PR. Versioning is semantic: MAJOR for removing
or redefining a principle, MINOR for a new principle or materially expanded guidance, PATCH for
wording. Every plan runs the Constitution Check, and every PR review checks the change against these
principles.

**Version**: 1.0.0 | **Ratified**: 2026-11-04 | **Last Amended**: 2026-11-04
