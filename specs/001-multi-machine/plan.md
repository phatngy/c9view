# Implementation Plan: Components and Multiple Machines

**Branch**: `docs/speckit-multi-machine` (docs); one branch per PR below | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-multi-machine/spec.md`, with implementation detail from [design-notes.md](design-notes.md) (the earlier design draft, reviewed twice).

## Summary

Split today's single server into a **hub** (`apps/hub`, browser-facing: login, Host/Origin, guards, web build, relay, merge) and a **node** (`packages/node`, everything that reads `~/.claude`, project folders and processes), joined by one `NodeTransport` with explicit request/response envelopes. One machine (`c9view start`) runs both in one process with an in-process transport; remote machines run `c9view node`, which dials out to the hub over a WebSocket and authenticates with an Ed25519 key challenge. The API and web become machine-scoped (`/api/m/:machineId/*`, `/m/$machineId/…`) before session control (002) is built; events stay refresh hints; responses are paged by byte budgets. All c9view state moves into `~/.claude/c9view/` (FR-031). Work ships as the design draft's PRs 6.0a–6.0c and 7a–7e, plus one new PR, **6.0d**, for the state folder.

## Technical Context

**Language/Version**: TypeScript (strict, ESM), Node 22.

**Primary Dependencies**: Hono and `@hono/node-server` (existing); Zod (existing); better-sqlite3 + Drizzle (existing, also for the hub store); chokidar (existing); `node:crypto` Ed25519 (no new dependency). **New in 7b**: a WebSocket server library for the hub (`ws`, justified in [research.md](research.md#r3-websocket-library)); the node uses Node 22's built-in `WebSocket` client where it supports upgrade headers, else the same library.

**Storage**: the node's existing SQLite index (cache, unchanged location under `~/.cache/c9view/`); the hub store `hub.sqlite` (`machines`, `pairing_codes`) under the c9view state folder; node identity `identity.json`; hook events `events.jsonl`. State folder: `C9VIEW_STATE_DIR`, default `~/.claude/c9view/`.

**Testing**: Vitest; transport contract tests shared by both transports; hub + two nodes in one process over a real loopback WebSocket with fixture data; Playwright end-to-end suite in `tests/e2e/`, run with `corepack pnpm test:e2e` and in CI.

**Target Platform**: Linux and macOS (native nodes and hub), Windows through WSL; Docker for the hub (and the read-only `c9view start` image).

**Project Type**: pnpm workspace: web app + server + CLI + libraries.

**Performance Goals**: merged Overview within the 5 s per-node merge timeout; no page above 1 MiB; no file response above 8 MiB; a slow browser never stalls a node.

**Constraints**: every limit configurable by environment (table below); hub stores no node data on disk (FR-020); node opens no listening port unless `--listen`.

**Scale/Scope**: single owner, a handful of machines (cap of 16 open requests per node); sessions with 10,000+ messages and transcripts of hundreds of MB.

### Limits and their environment variables (FR-002, FR-008, FR-014, FR-016, FR-017)

Parsed with Zod in `packages/node/src/limits.ts` (node side) and `apps/hub/src/limits.ts` (hub side, 7c; 6.0a reads the shared defaults from `@c9view/node`). Defaults are the design draft's; 6.0c re-measures them on real sessions before Step 7.

| Variable                          | Default                   | Used by                                                    |
| --------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `C9VIEW_REQUEST_BODY_MAX_BYTES`   | 49152 (48 KiB)            | transport, control bodies (413 above)                      |
| `C9VIEW_RESPONSE_CHUNK_MAX_BYTES` | 262144 (256 KiB)          | transport chunks                                           |
| `C9VIEW_REQUEST_DEADLINE_MS`      | 30000                     | transport total deadline (504)                             |
| `C9VIEW_REQUEST_IDLE_MS`          | 10000                     | transport idle deadline between chunks (504)               |
| `C9VIEW_PAGE_BUDGET_BYTES`        | 1048576 (1 MiB)           | session pages, search, listings, git status/changes, diffs |
| `C9VIEW_FILE_BUDGET_BYTES`        | 8388608 (8 MiB)           | file view ceiling                                          |
| `C9VIEW_WS_MAX_MESSAGE_BYTES`     | 524288 (512 KiB)          | WebSocket frames                                           |
| `C9VIEW_NODE_MAX_OPEN_REQUESTS`   | 16                        | hub per-node cap (503)                                     |
| `C9VIEW_HEARTBEAT_MS`             | 15000                     | ping/pong; three misses close                              |
| `C9VIEW_MERGE_TIMEOUT_MS`         | 5000                      | merged endpoints, then `partial`                           |
| `C9VIEW_PAIRING_CODE_TTL_MS`      | 600000 (10 min)           | pairing codes                                              |
| `C9VIEW_NODE_HANDSHAKE_MS`        | 10000                     | unauthenticated socket deadline (research R12)             |
| `C9VIEW_NODE_MAX_UNAUTHENTICATED` | 8                         | unauthenticated sockets at once (503 above)                |
| `C9VIEW_NODE_MAX_FAILURES`        | 10 per 15 min per address | failed `pair`/`auth`, then 429                             |
| `C9VIEW_LEGACY_STATE_DIR`         | unset                     | legacy hook-events folder to read (research R6)            |

## Constitution Check

_GATE: checked against constitution v1.0.0 before Phase 0, re-checked after Phase 1 design. Result: **PASS**, no violations to justify._

| Principle                               | Check                                                                                                                                                                                                                                                                                                                                                                                                                 | Result |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Never Change Claude Data or Projects | c9view writes only its state folder `~/.claude/c9view/` (identity, hub store, hook events), the owner-run service file (7e, printed first, confirmation or `--yes`), and nothing else. Readers ignore the state folder (6.0d). Docker mounts stay read-only except the state folder. Git use unchanged (`createGit`). Control routes are allowlisted only when the node's flag is on (FR-015); control itself is 002. | Pass   |
| II. Private by default                  | Redaction stays on the node, before data enters the transport. Hub stores no node data (FR-020). Prompts, tool input, answers and Access tokens never logged (FR-024, FR-025).                                                                                                                                                                                                                                        | Pass   |
| III. Local first, explicit exposure     | `c9view start` keeps today's listener rules. Login required with a paired remote node or a node with control, no override (FR-010). Host and Origin checked on every hub path except `/api/nodes/connect`, which is checked on Host and authenticated by the key challenge (FR-030). Node opens no port unless `--listen`, which applies all listener rules.                                                          | Pass   |
| IV. Tolerant parsing                    | Frames, hello, snapshots, identity file and env limits parsed with Zod; unknown frame types ignored. Hub store and node identity are persistent state, separate from the rebuildable index.                                                                                                                                                                                                                           | Pass   |
| V. Strict, small, tested                | Shared HTTP types in `@c9view/api` (`machines.ts`); hub–node wire types in `packages/node` (`transport.ts`, `tunnel/frames.ts`). Non-additive changes justified below. Hook entry stays dependency-free: the state-dir helper is `packages/core/src/hooks/state-dir.ts`, `node:` imports only, and the hook-entry import scan test grows by that one file.                                                            | Pass   |
| VI. Fast on large data                  | Byte budgets with cursors (6.0c); live reads for online nodes; snapshots only for offline ones; merged endpoints fan out once per request with a 5 s cap.                                                                                                                                                                                                                                                             | Pass   |
| VII. Honest and accessible UI           | Offline shown in text with last seen; `partial` names missing machines; outdated nodes named; switcher hidden with one machine; 390 px checked.                                                                                                                                                                                                                                                                       | Pass   |
| Technology constraints                  | `apps/server` → `apps/hub`, new `packages/node` (listed in the constitution). WebSocket server dependency justified in research R3.                                                                                                                                                                                                                                                                                   | Pass   |

**Justified non-additive changes (Principle V)**:

- 6.0b moves node health from `/api/health` to `/api/m/:machineId/health`; `/api/health` keeps `ok` and hub fields. The Docker healthcheck reads only `ok`, which stays. Old fields stay on `/api/health` through 6.0b as a deprecated copy for the `local` node, removed in 7c.
- 6.0b moves web routes under `/m/$machineId/…`; old paths redirect to `/m/local/…` (FR-006, US2).
- 6.0d moves the hook events default; the reader also tails the legacy path (research R6).

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-machine/
├── spec.md
├── design-notes.md   # Design draft source text and values
├── plan.md              # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── node-transport.md
│   ├── hub-api.md
│   ├── ws-frames.md
│   └── cli.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── api/src/machines.ts                # 6.0b: MachineId, MachineSummary, MachineCapabilities, NodeHello, NodeSnapshot, MachineEvent
├── core/src/hooks/state-dir.ts        # 6.0d: node:-only, imported by hook-entry.ts (hooks import scan allows ./ only)
├── core/src/state/ignore.ts           # 6.0d: isC9viewStatePath() for every Claude data reader
├── node/                              # 6.0a: new package @c9view/node
│   └── src/
│       ├── data/                      # moved from apps/server/src/data/
│       ├── routes/                    # moved read routes + health.ts
│       ├── app.ts  runtime.ts  transport.ts  hello.ts  limits.ts
│       ├── budget.ts                  # 6.0c
│       ├── tunnel/ frames.ts chunks.ts            # 7b
│       └── connect/ dial.ts serve.ts identity.ts  # 7b
└── cli/src/
    ├── start.ts  hub.ts  node.ts  pair.ts  machines.ts   # 6.0a, 7b, 7c
    └── service/ systemd.ts launchd.ts index.ts           # 7e
apps/
├── hub/                               # 6.0a: renamed from apps/server (@c9view/hub)
│   └── src/
│       ├── main.ts  app.ts  auth/  routes/health.ts  routes/events.ts
│       ├── machines.ts                # 6.0b
│       ├── aggregate.ts               # 7a
│       └── nodes/ socket.ts ws-transport.ts pairing.ts store.ts registry.ts limits.ts   # 7b, 7c
└── web/src/
    ├── api.ts  queryKeys.ts  router.tsx  live/index.tsx   # 6.0b
    ├── session/paging.ts                                   # 6.0c
    └── machines/ MachinesPage.tsx MachineSwitcher.tsx MachineBadge.tsx useMachines.ts   # 7d
Dockerfile, docker-compose.yml, .github/workflows/, eslint.config.js
```

**Structure Decision**: keep the pnpm workspace; add `packages/node` and rename `apps/server` to `apps/hub` ([design-notes.md](design-notes.md) open question 7). The CLI stays one package with `start`, `hub` and `node` commands.

## PR split

Each PR has its own branch and worktree (`AGENTS.md`). Task ranges are in [tasks.md](tasks.md). Ordering: **6.0a → (6.0b ∥ 6.0d) → 6.0c**; 002's 6a starts after 6.0a, 6.0b and 6.0d merge; 6.0c starts after 6.0b merges (both edit the session page, the file viewer and the node's session and files routes), may run in parallel with 002's 6a, and merges before 002's 6b; Step 7 starts after 002's 6a merges: **7a ∥ 7b → 7c → 7d; 7e after 7b**; 7d also needs 002's 6c (kit `Dialog`).

Shared files between parallel PRs:

- 6.0b ∥ 6.0d: no shared source file. Both may touch `docs/deploy.md`; 6.0d rebases on 6.0b if 6.0b merges first.
- 7a ∥ 7b: both edit `apps/hub/src/app.ts`. 7a adds only the merged-endpoint mount; 7b adds only the `/api/nodes/connect` upgrade and its Origin exemption. Whichever merges second rebases. Mount order in `app.ts`, top to bottom: Host check → Origin check (skipped only for `/api/nodes/connect`) → login (not applied to `/api/nodes/connect`) → hub-owned routes (`/api/health`, `/api/machines…`, `/api/events`, `/api/nodes/connect`, login, logout) → merged endpoints (`/api/overview`, `/api/projects`, `/api/usage`, 7a) → `/api/m/:machineId/*` relay → `/api/*` alias for `local` → web build.

| PR                                                 | Responsibility                                                                | Owns (new or moved)                                                                                                                                                                                                                                                                                                                                                                                                        | Additive edits                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tasks                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **6.0a** component split, no behaviour change      | Implementation; maintainer does package moves and lockfile                    | `packages/node/` (package, `src/data/` and read `src/routes/` moved from `apps/server`, `app.ts`, `runtime.ts`, `routes/health.ts`, `transport.ts`, `hello.ts`, `limits.ts`, `boundaries.test.ts`, `test-fixtures/boundaries/`, tests); `scripts/record-api-snapshots.ts`, `tests/fixtures/api-snapshots/`; `apps/hub/` (renamed from `apps/server`: `main.ts`, `auth/`, `app.ts`, `routes/health.ts`, `routes/events.ts`) | `packages/cli/src/start.ts`, `Dockerfile`, `.github/workflows/`, `eslint.config.js` (boundary rules), `AGENTS.md` (layout), `docs/deploy.md` (paths), `pnpm-workspace.yaml`                                                                                                                                                                                                                                                                                          | T001–T020            |
| **6.0b** machine-scoped API and web, refresh rules | Implementation                                                                | `packages/api/src/machines.ts`; `apps/hub/src/machines.ts`; `apps/web/src/queryKeys.ts`                                                                                                                                                                                                                                                                                                                                    | `packages/api/src/index.ts`; `apps/hub/src/app.ts` (relay `/api/m/:machineId/*`, alias), `apps/hub/src/routes/events.ts` (`MachineEvent`), `apps/hub/src/routes/health.ts`; `apps/web/src/api.ts`, `router.tsx` and route files, `live/index.tsx`, search page; `packages/node/src/data/store.ts`                                                                                                                                                                    | T021–T037            |
| **6.0c** response budgets                          | Implementation                                                                | `packages/node/src/budget.ts`; `apps/web/src/session/paging.ts`                                                                                                                                                                                                                                                                                                                                                            | node session, search, files, git and changes routes; file viewer and diff components                                                                                                                                                                                                                                                                                                                                                                                 | T038–T047            |
| **6.0d** c9view state folder (new)                 | Implementation (security-sensitive: symlink, ownership and permission checks) | `packages/core/src/hooks/state-dir.ts`, `packages/core/src/state/ignore.ts`, tests                                                                                                                                                                                                                                                                                                                                         | `packages/core/src/hooks/hook-entry.ts`, `hooks/settings.ts` (`--c9view-state-dir` in the hook command), `packages/node/src/data/hook-events.ts`, `hooks/events.ts`, `hooks/index.test.ts` (import scan), `packages/core/src/index.ts` (barrel), `watch/index.ts`, `projects/index.ts`, `claude-config/documents.ts`, `packages/cli/src/hooks.ts` (status), `Dockerfile`, `docker-compose.yml`, `docs/deploy.md`, `docs/data-sources.md`, `tests/fixtures/README.md` | T048–T058, T115–T116 |
| **7a** merged endpoints                            | Implementation                                                                | `apps/hub/src/aggregate.ts`, tests                                                                                                                                                                                                                                                                                                                                                                                         | `apps/hub/src/app.ts` (mount before alias)                                                                                                                                                                                                                                                                                                                                                                                                                           | T059–T064            |
| **7b** WebSocket transport, node mode, pairing     | Implementation (security-sensitive); maintainer adds `ws` and lockfile        | `packages/node/src/tunnel/` (`frames.ts`, `chunks.ts`), `packages/node/src/connect/` (`dial.ts`, `serve.ts`, `identity.ts`), `apps/hub/src/nodes/` (`socket.ts`, `ws-transport.ts`, `pairing.ts`, `store.ts`), `packages/cli/src/hub.ts`, `node.ts`, `pair.ts`                                                                                                                                                             | `packages/cli/src/main.ts`; `apps/hub/src/main.ts` (FR-010 refusal); `apps/hub/src/app.ts` (Host-only connect path); `Dockerfile` (default `hub --no-local`, `C9VIEW_IN_CONTAINER=1`); `docker-compose.yml` (hub profile); `docs/deploy.md`                                                                                                                                                                                                                          | T065–T085, T117      |
| **7c** hub with many nodes                         | Implementation                                                                | `apps/hub/src/nodes/registry.ts`, `apps/hub/src/nodes/limits.ts`, `packages/cli/src/machines.ts`, tests                                                                                                                                                                                                                                                                                                                    | `apps/hub/src/machines.ts` (registry replaces single entry; versions, `outdated`); `apps/hub/src/routes/health.ts` (drop deprecated node fields)                                                                                                                                                                                                                                                                                                                     | T086–T094, T118      |
| **7d** web for many machines                       | Implementation                                                                | `apps/web/src/machines/` (`MachinesPage.tsx`, `MachineSwitcher.tsx`, `MachineBadge.tsx`, `useMachines.ts`), tests                                                                                                                                                                                                                                                                                                          | shell (switcher), Overview and board (chips, filter), session and project headers (machine, offline banner)                                                                                                                                                                                                                                                                                                                                                          | T095–T104            |
| **7e** node as a user service                      | Implementation; after 7b                                                      | `packages/cli/src/service/` (`systemd.ts`, `launchd.ts`, `index.ts`), tests                                                                                                                                                                                                                                                                                                                                                | `packages/cli/src/main.ts`; `docs/deploy.md` (service section)                                                                                                                                                                                                                                                                                                                                                                                                       | T105–T110            |
| Polish                                             | maintainer                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                          | `specs/README.md`, manual check                                                                                                                                                                                                                                                                                                                                                                                                                                      | T111–T114            |

## Complexity Tracking

No constitution violations. Not a violation but recorded: the hub store under `~/.claude/c9view/hub/` sits beside Claude data on a native hub; a `--no-local` hub still never reads Claude data (FR-001), only its own state folder.
