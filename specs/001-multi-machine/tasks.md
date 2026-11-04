---
description: 'Task list for Components and Multiple Machines'
---

# Tasks: Components and Multiple Machines

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md), [design-notes.md](design-notes.md)

**Tests**: requested — the spec's acceptance scenarios and the design draft's test lists are tests. Test tasks come before the code they cover within each PR.

**Organization**: one phase per PR (the design draft's IDs, plus the new 6.0d), in merge order; each task carries the user story it serves. Every PR ends green on root `lint`, `typecheck`, `test` and `build`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US7 from spec.md
- Paths are repository-relative. After T002, `apps/server` is `apps/hub`.

## PR → tasks

| PR                                         | Phase | Tasks                | Stories  |
| ------------------------------------------ | ----- | -------------------- | -------- |
| 6.0a component split                       | 1–2   | T001–T020            | US1      |
| 6.0b machine-scoped API and web            | 3     | T021–T037            | US2      |
| 6.0c response budgets                      | 4     | T038–T047            | US3      |
| 6.0d c9view state folder (new)             | 5     | T048–T058, T115–T116 | US7      |
| 7a merged endpoints                        | 6     | T059–T064            | US4      |
| 7b WebSocket transport, node mode, pairing | 7     | T065–T085, T117      | US4, US5 |
| 7c hub with many nodes                     | 8     | T086–T094, T118      | US5      |
| 7d web for many machines                   | 9     | T095–T104            | US4, US5 |
| 7e node as a user service                  | 10    | T105–T110            | US6      |
| Polish                                     | 11    | T111–T114            | —        |

---

## Phase 1: Setup — PR 6.0a, maintainer (package moves and lockfile)

**Purpose**: create the packages the workers fill. Starts when no open PR edits `apps/server`.

- [x] T001 Create `packages/node/package.json` (`@c9view/node`, ESM, exports `./src/index.ts` build to `dist/`), `packages/node/tsconfig.json` and `packages/node/tsconfig.build.json` mirroring `packages/core`, and add it to `pnpm-workspace.yaml`
- [x] T002 `git mv apps/server apps/hub`, rename the package to `@c9view/hub` in `apps/hub/package.json`, and update workspace references in root `package.json` and `packages/cli/package.json`
- [x] T003 `git mv apps/server/src/data` (now `apps/hub/src/data`) to `packages/node/src/data`, and `git mv` the read routes `overview.ts`, `projects.ts`, `sessions.ts`, `files.ts`, `changes.ts`, `config.ts`, `usage.ts`, `search.ts` with their tests from `apps/hub/src/routes/` to `packages/node/src/routes/`
- [x] T004 Run `corepack pnpm install` and commit the lockfile; fix import paths only, so the moved tests run unchanged

## Phase 2: User Story 1 — split with no behaviour change (P1) — PR 6.0a

**Goal**: hub and node are separate components behind `NodeTransport`; nothing observable changes (FR-001–FR-004, FR-009).

**Independent test**: every existing test passes after the move, and every `/api/*` response for the fixture data is identical to before.

### Tests

- [x] T005 [P] [US1] Record pre-split responses: script `scripts/record-api-snapshots.ts` runs today's server on `tests/fixtures/` and writes `tests/fixtures/api-snapshots/*.json` for every `/api/*` route, including `/api/health` (run on `main` before T003)
- [x] T006 [P] [US1] Write the transport contract suite `packages/node/src/transport.contract.ts` per [contracts/node-transport.md](contracts/node-transport.md): envelopes, no browser headers reach the node, body over `C9VIEW_REQUEST_BODY_MAX_BYTES` → 413, chunks ≤ `C9VIEW_RESPONSE_CHUNK_MAX_BYTES`, total and idle deadlines → 504 and abort the node's signal, subscribe and snapshot
- [x] T007 [P] [US1] End-to-end test `apps/hub/src/split.e2e.test.ts`: start `c9view start` on the fixture data and compare every `/api/*` response to `tests/fixtures/api-snapshots/`
- [x] T008 [P] [US1] Runtime test `packages/node/src/runtime.test.ts`: an event from `startIndex` reaches the hub's SSE stream, and node health reports the same index state the routes use (FR-004)
- [x] T009 [P] [US1] Boundary lint fixtures `packages/node/test-fixtures/boundaries/` with one file per forbidden import, and `packages/node/src/boundaries.test.ts`, which runs the ESLint API on them and expects each to be reported

### Implementation

- [x] T010 [US1] `packages/node/src/limits.ts`: Zod-parse the limit variables in [plan.md](plan.md#limits-and-their-environment-variables-fr-002-fr-008-fr-014-fr-016-fr-017) with the design draft's defaults
- [x] T011 [US1] `packages/node/src/transport.ts`: `NodeRequest`, `NodeResponse`, `NodeEvent`, `NodeTransport` and `InProcessTransport` (builds a `Request` from the envelope for the node app, enforces T010's limits, subscribes to the runtime's `EventHub`); `packages/node/src/transport.test.ts` runs T006's suite
- [x] T012 [US1] `packages/node/src/hello.ts`: `NodeHello` with a random `bootId` per process, `version`, `protocol: 1`, capabilities with control `off`
- [x] T013 [US1] `packages/node/src/runtime.ts`: `createNode(config)` creates the store, `EventHub`, hook events, SQLite index and watcher once; app, transport, `startIndex` and shutdown share it
- [x] T014 [US1] `packages/node/src/app.ts`: `createNodeApp(runtime)` with the moved routes, error handler and redaction; no Host/Origin check, no auth
- [x] T015 [US1] `packages/node/src/routes/health.ts`: node health (index progress, hooks installation and files), moved out of `apps/hub/src/app.ts`; export from `packages/node/src/index.ts`
- [x] T016 [US1] `apps/hub/src/app.ts`: keep auth and Host/Origin middleware; serve the web build; relay every non-hub `/api/*` path to the local node through `InProcessTransport`; `apps/hub/src/routes/health.ts` combines hub fields with the local node's health into today's body; `apps/hub/src/routes/events.ts` feeds SSE from `transport.subscribe`
- [x] T017 [US1] `packages/cli/src/start.ts`: resolve `@c9view/hub` (and the repository fallback `apps/hub`); `packages/cli/src/start.test.ts` updated
- [x] T018 [US1] `eslint.config.js`: `packages/node` may not import `hono/cookie`, `apps/hub/src/auth` or `@hono/node-server`'s `serve`; `apps/hub` imports `@c9view/node` only through its package entry
- [x] T019 [US1] `Dockerfile`, `.github/workflows/*.yml`: `apps/server` → `apps/hub` paths and filters
- [x] T020 [US1] Docs: `AGENTS.md` repository layout (`apps/hub`, `packages/node`), `docs/deploy.md` paths

**Checkpoint**: US1 done; 6.0b and 6.0d can start (6.0c after 6.0b).

---

## Phase 3: User Story 2 — every page and link names its machine (P1) — PR 6.0b

**Goal**: machine-scoped API, web routes and query keys; hub-stamped `machineId`; refresh rules (FR-005–FR-007).

**Independent test**: [quickstart.md](quickstart.md#60b--machine-scoped-us2).

### Tests

- [x] T021 [P] [US2] `apps/hub/src/machines.test.ts`: `/api/m/local/…` equals `/api/…`; unknown `machineId` → 404; `--no-local` alias → 404; hub routes match before the alias; login and Host/Origin apply through the alias as through `/api/m/local/*`
- [x] T022 [P] [US2] `apps/hub/src/routes/events.test.ts`: SSE events arrive as `{ machineId: 'local', event }`; a fake transport's own `machineId` in a payload is overwritten
- [x] T023 [P] [US2] `apps/web/src/queryKeys.test.ts`: same `projectId` on two machines → different cache entries; global keys have no `machineId`
- [x] T024 [P] [US2] `apps/web/src/router.test.tsx`: each old path redirects to `/m/local/…` keeping path and query
- [x] T025 [P] [US2] `apps/web/src/live/live.test.tsx`: after SSE reopen, files, git status and changes queries refetch; two overlapping refreshes of one session end with the newer data; an event during a refresh causes exactly one more refresh
- [x] T026 [P] [US2] `packages/node/src/data/store.test.ts`: a snapshot invalidated during its build is rebuilt before it is returned

### Implementation

- [x] T027 [US2] `packages/api/src/machines.ts` per [data-model.md](data-model.md): `MachineId`, `CapabilityState`, `MachineCapabilities`, `MachineSummary`, `NodeHello`, `NodeSnapshot`, `MachineEvent`, `MachineStateEvent`; additive export in `packages/api/src/index.ts`
- [x] T028 [US2] `apps/hub/src/machines.ts`: machine list with one `local` entry and `GET /api/machines`
- [x] T029 [US2] `apps/hub/src/app.ts`: relay `/api/m/:machineId/*` to that machine's transport (404 unknown, 503 `{ reason: 'offline' }`); `/api/*` alias for `local` only; hub routes first
- [x] T030 [US2] `apps/hub/src/routes/events.ts`: wrap node events as `MachineEvent`, emit `machine` events; `apps/hub/src/routes/health.ts`: hub fields plus the deprecated `local` node copy (plan, justified non-additive changes)
- [x] T031 [US2] `apps/web/src/api.ts`: build every machine-scoped path as `/api/m/${machineId}…`
- [x] T032 [US2] `apps/web/src/queryKeys.ts` (new): key factories; every machine-scoped key starts with `machineId`; replace inline keys across `apps/web/src/`
- [x] T033 [US2] `apps/web/src/router.tsx` and route files: move routes under `/m/$machineId/…`; redirects from old paths
- [x] T034 [US2] `apps/web/src/live/index.tsx` and `live/state.ts`: R7 rules — invalidate only, refetch every query of a machine after a gap, one refresh per key with a dirty flag, never replace newer data with older
- [x] T035 [US2] Search page in `apps/web/src/search/`: read index progress from `/api/m/:machineId/health`
- [x] T036 [US2] `packages/node/src/data/store.ts`: generation counter; rebuild a snapshot invalidated mid-build
- [x] T037 [US2] Update existing web tests that hard-code `/api/…` paths or query keys

**Checkpoint**: with 6.0d merged, 002 PR 6a can start.

---

## Phase 4: User Story 3 — large sessions and files never stall the page (P2) — PR 6.0c

**Goal**: byte-budgeted pages with cursors (FR-008). Starts after 6.0b merges (both edit the session page, the file viewer and the node's session and files routes). May run in parallel with 002's 6a; merges before 002's 6b.

### Tests

- [ ] T038 [P] [US3] `packages/node/src/budget.test.ts`: a page stops under `C9VIEW_PAGE_BUDGET_BYTES` measured after redaction and JSON encoding; never cuts JSON; an oversized single item is truncated with a marker and a cursor
- [ ] T039 [P] [US3] `packages/node/src/routes/sessions.test.ts`: a fixture session with large tool output stops under 1 MiB with a cursor; following cursors yields every message in order
- [ ] T040 [P] [US3] `packages/node/src/routes/files.test.ts`: a file over `C9VIEW_FILE_BUDGET_BYTES` returns metadata and `notice: 'too-large'`
- [ ] T041 [P] [US3] `apps/web/src/session/paging.test.ts` and `apps/web/src/files/files.test.tsx`: cursors followed in order; partial-content notices with "Load more" in the session page, file viewer and diffs

### Implementation

- [ ] T042 [US3] `packages/node/src/budget.ts`: page builder per [research.md](research.md#r4-response-budgets)
- [ ] T043 [US3] Session route `packages/node/src/routes/sessions.ts`: byte-budgeted pages with cursors
- [ ] T044 [US3] Search, files (listing and view), git status, changes and diff routes in `packages/node/src/routes/search.ts`, `files.ts`, `changes.ts`: budgets and cursors
- [ ] T045 [US3] `apps/web/src/session/paging.ts`: follow returned cursors instead of counting messages
- [ ] T046 [US3] `apps/web/src/files/FileViewer.tsx`, `apps/web/src/files/SessionChanges.tsx`, `apps/web/src/files/ProjectChanges.tsx`, `apps/web/src/diff/DiffView.tsx`: partial-content notice with "Load more"
- [ ] T047 [US3] Measure the budgets on real sessions (maintainer, locally, no data committed) and record the numbers and any changed defaults in [design-notes.md](design-notes.md) and `packages/node/src/limits.ts`

---

## Phase 5: User Story 7 — c9view keeps everything it writes in one folder (P1) — PR 6.0d (new)

**Goal**: `~/.claude/c9view/` is c9view's only state folder; readers ignore it; hook events move with a read-only legacy fallback (FR-031, research R6). Starts after 6.0a; merges before 002's 6a and 7b.

### Tests

- [ ] T048 [P] [US7] `packages/core/src/hooks/state-dir.test.ts`: `C9VIEW_STATE_DIR` wins; default is `<home>/.claude/c9view`; folder created 0700, files 0600; symlinked or foreign-owned folder and symlinked file refused
- [ ] T049 [P] [US7] `packages/core/src/hooks/index.test.ts`: the hook-entry import scan allows the new `./state-dir.js` and still only `node:` imports (visited files 2 → 3); a hook fired with no `C9VIEW_STATE_DIR` writes `<home>/.claude/c9view/events.jsonl`
- [ ] T050 [P] [US7] `packages/core/src/hooks/events.test.ts`: with no `C9VIEW_STATE_DIR`, events at the legacy `${XDG_STATE_HOME:-~/.local/state}/c9view/events.jsonl` and at the new path are both read, merged by timestamp; the legacy file is never written, moved or deleted; with `C9VIEW_LEGACY_STATE_DIR` set (as in Docker, where `C9VIEW_STATE_DIR` is also set and `HOME=/tmp`), events in that folder are read too; without it and with `C9VIEW_STATE_DIR` set, no legacy path is read
- [ ] T051 [P] [US7] `packages/core/src/state/ignore.test.ts` plus cases in `packages/core/src/watch/index.test.ts`, `packages/core/src/projects/index.test.ts` and `packages/core/src/claude-config/documents.test.ts`: files under `<claudeDir>/c9view/` never reach the watcher, index, project discovery or config readers; also files under a `C9VIEW_STATE_DIR` that resolves inside the Claude dir under another name (for example `<claudeDir>/my-state/`, and through a symlinked path)

### Implementation

- [ ] T052 [US7] `packages/core/src/hooks/state-dir.ts` (`node:` imports only): resolver and the folder checks moved from `hook-entry.ts`. Permission rules per caller: the hook entry creates 0700/0600, tightens a folder it owns that is wider to 0700, and silently skips a symlinked or foreign-owned folder or symlinked file; node and hub callers never tighten — a wider folder or file, a symlink or a foreign owner stops them at startup with the `chmod` to run (research R6)
- [ ] T053 [US7] `packages/core/src/hooks/hook-entry.ts`: use `state-dir.ts`; keep `O_NOFOLLOW` appends and rotation rules
- [ ] T054 [US7] `packages/core/src/hooks/events.ts` and `packages/node/src/data/hook-events.ts`: tail the new path and the legacy folder read-only — `C9VIEW_LEGACY_STATE_DIR` when set, else the old default only when `C9VIEW_STATE_DIR` is unset; report both files in node health; `packages/cli/src/hooks.ts` `hooks status` reports both
- [ ] T055 [US7] `packages/core/src/state/ignore.ts`: `isC9viewStatePath(claudeDir, stateDir, path)` (real paths of `<claudeDir>/c9view/` and of the resolved state folder when inside the Claude dir); call it from `packages/core/src/watch/index.ts` (`ignored`), `packages/core/src/projects/index.ts`, `packages/core/src/claude-config/documents.ts`; export from `packages/core/src/index.ts`
- [ ] T056 [US7] `Dockerfile`: `C9VIEW_STATE_DIR=/data/claude/c9view`; `docker-compose.yml`: mount `${HOME}/.claude/c9view` writable at `/data/claude/c9view` over the read-only `/data/claude`, keep the old `~/.local/state/c9view` mount read-only at `/data/c9view-state` with `C9VIEW_LEGACY_STATE_DIR=/data/c9view-state` beside it (remove both together when no legacy events matter)
- [ ] T057 [US7] `docs/data-sources.md` (hook events path, legacy read, removal note) and `docs/deploy.md` (state folder, Docker mount, `C9VIEW_STATE_DIR` with a custom Claude dir and reinstalling hooks so the hook command carries it, `C9VIEW_LEGACY_STATE_DIR`)
- [ ] T058 [US7] `tests/fixtures/README.md`: note that fixtures never contain a `c9view/` state folder except in the ignore tests' temporary dirs
- [ ] T115 [P] [US7] `packages/core/src/hooks/settings.test.ts` and `packages/core/src/hooks/index.test.ts`: with a non-default state folder, `hookCommand` appends `--c9view-state-dir '<dir>'` (quoted like the other paths, also with spaces and quotes in the path), reinstalling replaces it, the default adds nothing; the hook entry run with that argument and no `C9VIEW_STATE_DIR` in its environment writes to `<dir>`; the argument wins over `C9VIEW_STATE_DIR`
- [ ] T116 [US7] `packages/core/src/hooks/settings.ts` (`hookCommand(execPath, entryPath, stateDir?)`), `packages/cli/src/hooks.ts` (pass the resolved state folder when not the default), `packages/core/src/hooks/state-dir.ts` (read `--c9view-state-dir` from argv first)

---

## Phase 6: User Story 4 — merged endpoints (P2) — PR 7a

**Goal**: one Overview, project list and usage across machines (FR-017, FR-019 live reads). Starts after 002's 6a merges.

- [ ] T059 [P] [US4] `apps/hub/src/aggregate.test.ts` with two fake transports: same `projectId` stays separate with `machineId`; a machine slower than `C9VIEW_MERGE_TIMEOUT_MS` is left out and listed in `partial`
- [ ] T060 [P] [US4] `apps/hub/src/aggregate.test.ts`: online machines are read live; an offline machine contributes its last snapshot, marked offline
- [ ] T061 [US4] `apps/hub/src/aggregate.ts`: merge `/api/overview`, `/api/projects`, `/api/usage` over every transport with `machineId` on each item and `partial`
- [ ] T062 [US4] `apps/hub/src/app.ts`: mount merged endpoints before the alias
- [ ] T063 [US4] `packages/api/src/`: additive `machineId?` on merged `ProjectSummary` and `SessionSummary`, and `partial?` on the merged responses
- [ ] T064 [US4] Web `apps/web/src/overview.tsx` and board: key items by `(machineId, projectId)`; show the `partial` notice naming the missing machine

---

## Phase 7: User Stories 4 and 5 — WebSocket transport, node mode, pairing (P2) — PR 7b

**Goal**: remote nodes dial out, pair and connect securely (FR-010–FR-016, FR-018, FR-025, FR-027, FR-029, FR-030). Maintainer adds `ws` and owns the lockfile.

### Tests (hub + two nodes in one process over a real loopback WebSocket, fixture data)

- [ ] T065 [P] [US4] `apps/hub/src/nodes/ws-transport.test.ts`: the WebSocket transport passes T006's contract suite, including a response larger than one chunk, `cancel` aborting the node's request, the open-request cap → 503, deadlines → 504, and the largest 6.0c pages
- [ ] T066 [P] [US4] `apps/hub/src/main.test.ts`: hub refuses auth `none` once a remote node is paired, including with `C9VIEW_INSECURE_NO_AUTH=1`; with `--no-local` no index, hooks reader or watcher is created and the Claude dir is never opened (FR-001); at runtime with auth `none`: `c9view hub pair` and `POST /api/machines/pair` refuse with "enable login first", and the socket closes on `pair` and `auth` frames without detail (FR-010)
- [ ] T067 [P] [US4] `apps/hub/src/nodes/pairing.test.ts`: a code works once and expires after `C9VIEW_PAIRING_CODE_TTL_MS`; unknown key, bad signature and revoked machine are closed with no detail; a wrong code and a reused code are refused the same way; pre-authentication limits: no `auth`/`pair` within `C9VIEW_NODE_HANDSHAKE_MS` closes, more than `C9VIEW_NODE_MAX_UNAUTHENTICATED` unauthenticated sockets get 503, a frame other than `auth`/`pair` or above 4 KiB before authentication closes, repeated failures from one address back off and then get 429, while a known machine's valid `auth` from that same address still connects; and in `packages/node/src/connect/dial.test.ts` a node with `--control` closes and exits with "the hub has no login" when the challenge says `auth: 'none'`
- [ ] T068 [P] [US5] `apps/hub/src/nodes/socket.test.ts`: mismatched `protocol` refused with the version range; a `hello` naming another `machineId` is ignored in favour of the verified key; a second connection replaces the first
- [ ] T069 [P] [US4] `packages/node/src/connect/serve.test.ts`: a `req` outside the allowlist → 404; a control path → 404 when control is off; no frame can change `control` or `bypass`
- [ ] T070 [P] [US5] `apps/hub/src/nodes/socket.test.ts`: a dropped node is marked offline, its cards stay `offline`, its detail routes → 503; a reconnect installs a fresh snapshot without losing an event sent during the install; a restart changes `bootId`
- [ ] T071 [P] [US4] `apps/hub/src/nodes/socket.test.ts`: `/api/nodes/connect` is accepted with a foreign or missing Origin when Host is allowed and the challenge passes, refused on a disallowed Host; every other path still refuses a foreign Origin (FR-030)
- [ ] T072 [P] [US4] `packages/node/src/connect/dial.test.ts`: with `C9VIEW_HUB_ACCESS_CLIENT_ID`/`SECRET` set the upgrade carries both headers and neither value is logged; no relayed request body appears in hub or node logs (FR-024); failed upgrades name no route, TLS, Access login page or refused pairing; `ws://` refused to a non-loopback hub
- [ ] T073 [P] [US5] `packages/node/src/connect/identity.test.ts`: state folder wider than 0700 or key wider than 0600 stops the node with the `chmod` to run; identity written under `<state>/node/identity.json`
- [ ] T074 [P] [US4] `packages/cli/src/node.test.ts`: with `C9VIEW_IN_CONTAINER=1`, `c9view node --control` and `--bypass` refuse with a pointer to the native install; `docker compose --profile hub config` has no `~/.claude` or workspace mount; the image's default command is `hub --no-local`; `c9view node --listen` applies every existing listener rule (loopback default, login with a non-loopback host)
- [ ] T075 [P] [US4] `apps/hub/src/nodes/store.test.ts`: after the suite the hub store holds only `machines` and `pairing_codes` (SC-007)
- [ ] T117 [P] [US5] `apps/hub/src/nodes/socket.test.ts`: a node that misses three pongs (`C9VIEW_HEARTBEAT_MS`, fake timers) is disconnected and marked offline; a message above `C9VIEW_WS_MAX_MESSAGE_BYTES` closes the socket with code 1009, from either side (FR-014)

### Implementation

- [ ] T076 [US4] `packages/node/src/tunnel/frames.ts`: Zod schemas per [contracts/ws-frames.md](contracts/ws-frames.md), unknown types ignored, exported for the hub
- [ ] T077 [US4] `packages/node/src/tunnel/chunks.ts`: split and join bodies and snapshots into ≤ 256 KiB chunks; bounded send and receive queues
- [ ] T078 [US4] `packages/node/src/connect/identity.ts`: Ed25519 key pair (`node:crypto`), `identity.json` in `<state>/node/` with 0700/0600 checks
- [ ] T079 [US4] `packages/node/src/connect/dial.ts`: connect with backoff, heartbeat, Access headers, challenge response (refuse and exit with control on when the challenge reports `auth: 'none'`), `hello`, chunked snapshot after every connect; `packages/node/src/connect/serve.ts`: answer `req` frames through the node app with the allowlist
- [ ] T080 [US4] `apps/hub/src/nodes/store.ts`: `hub.sqlite` under `<state>/hub/` with Drizzle migrations for `machines` and `pairing_codes`
- [ ] T081 [US4] `apps/hub/src/nodes/pairing.ts`: issue codes (hash stored), handle `pair` frames, assign UUID `machineId`; `POST /api/machines/pair` with the mutation guard; refuse to issue codes (CLI and route) and reject `pair` frames while auth mode is `none` ("enable login first")
- [ ] T082 [US4] `apps/hub/src/nodes/socket.ts`: `ws` server on the `upgrade` event for `/api/nodes/connect` only, Host check, challenge carrying the auth mode, protocol check, pre-authentication limits from research R12 (handshake deadline, unauthenticated cap, per-address backoff and 429, 4 KiB pre-auth frames), heartbeat and max message size; `apps/hub/src/nodes/ws-transport.ts`: `NodeTransport` over a socket with T010's limits
- [ ] T083 [US4] `apps/hub/src/main.ts`: refuse auth `none` with a paired remote node at startup, and reject `auth` frames at runtime while auth is `none` (FR-010); `apps/hub/src/app.ts`: exempt only `/api/nodes/connect` from the Origin check
- [ ] T084 [US4] CLI `packages/cli/src/hub.ts` (`hub`, `--no-local`, `hub pair`), `packages/cli/src/node.ts` (`node --hub`, `--listen`, `--name`; container refusal), `packages/cli/src/pair.ts` (`node pair`); register in `packages/cli/src/main.ts`
- [ ] T085 [US4] `Dockerfile` (default `CMD ["hub", "--no-local"]`, `C9VIEW_IN_CONTAINER=1`), `docker-compose.yml` (hub profile with only the hub state volume), `docs/deploy.md` (hub and node deployment, Access service token, back up `~/.claude/c9view/node/`)

---

## Phase 8: User Story 5 — hub with many nodes (P2) — PR 7c

**Goal**: registry, revoke, limits, offline handling and versions (FR-013, FR-016, FR-019, FR-023, FR-028).

- [ ] T086 [P] [US5] `apps/hub/src/nodes/registry.test.ts`: revoking closes an open socket at once and the node's next connect fails and logs "This machine was removed from the hub; pair it again."
- [ ] T087 [P] [US5] `apps/hub/src/nodes/registry.test.ts`: an old supported node is reported `outdated` with its c9view, protocol and Claude Code versions; only `lastSeenAt` is written for an offline machine
- [ ] T088 [P] [US5] `apps/hub/src/nodes/registry.test.ts`: pending control requests on a node that goes offline are refused with 503 on the hub; the hub never retries a mutation; a command retried across a node restart gets `unknown-outcome`, and a command whose response was lost is recovered by its receipt (with 002's fake control service)
- [ ] T118 [P] [US5] `apps/hub/src/routes/events.test.ts` and `apps/hub/src/nodes/ws-transport.test.ts`: a browser that stops reading the SSE stream or a streamed response is disconnected once its bounded queue fills, and the node keeps emitting events and answering other requests without waiting (FR-016)
- [ ] T089 [US5] `apps/hub/src/nodes/registry.ts`: paired machines, connection state, last `NodeHello` and snapshot in memory
- [ ] T090 [US5] `apps/hub/src/nodes/limits.ts`: hub-side Zod limits (open requests per node, queues)
- [ ] T091 [US5] `apps/hub/src/machines.ts`: replace the single `local` entry with the registry; versions and `outdated`
- [ ] T092 [US5] `POST /api/machines/:machineId/revoke` in `apps/hub/src/machines.ts` with 002's guard; `packages/cli/src/machines.ts` for `c9view hub machines list|revoke`
- [ ] T093 [US5] `apps/hub/src/routes/health.ts`: drop the deprecated `local` node fields from `/api/health`
- [ ] T094 [US5] `apps/hub/src/routes/events.ts`: `machine` events on connect (with `bootId`) and drop; slow-client disconnect

---

## Phase 9: User Stories 4 and 5 — web for many machines (P2) — PR 7d

- [ ] T095 [P] [US4] `apps/web/src/machines/machines.test.tsx`: switcher and machine chips appear only with more than one machine
- [ ] T096 [P] [US5] `apps/web/src/machines/machines.test.tsx`: offline cards, pages and controls show "offline · last seen …" in text and are disabled
- [ ] T097 [P] [US4] `apps/web/src/overview/overview.test.tsx`: a `partial` Overview names the missing machine
- [ ] T098 [US4] `apps/web/src/machines/useMachines.ts`: `GET /api/machines` with a global query key, refreshed on `machine` events
- [ ] T099 [US4] `apps/web/src/machines/MachineSwitcher.tsx`: "All machines" first, next to the project picker, hidden with one machine; mount in `apps/web/src/shell/TopBar.tsx`
- [ ] T100 [US4] `apps/web/src/machines/MachineBadge.tsx`: machine chip; add to Overview and board cards and project rows with a filter by machine
- [ ] T101 [US5] Offline states: greyed cards with text in the board, offline banner in `apps/web/src/session/header/` and `apps/web/src/project/` headers, disabled controls
- [ ] T102 [US5] `apps/web/src/machines/MachinesPage.tsx`: name, state, last seen, versions and what to upgrade, Control and Bypass badges, Pair (shows the code) and Revoke (kit `Dialog` from 002 PR 6c, with typed confirmation)
- [ ] T103 [US5] Route `/machines` in `apps/web/src/router.tsx` and a link in `apps/web/src/shell/Sidebar.tsx`
- [ ] T104 [US4] Maintainer renders at 1440×900 and 390×844 and checks keyboard and screen-reader access

---

## Phase 10: User Story 6 — node as a user service (P3) — PR 7e (after 7b)

- [ ] T105 [P] [US6] `packages/cli/src/service/service.test.ts` (temporary home only): `install-service` prints the unit or plist before writing and writes nothing without confirmation or `--yes`; the written file runs `c9view node` with the flags given; `uninstall-service` removes only that file; `service status` reports installed, running, connected
- [ ] T106 [US6] `packages/cli/src/service/systemd.ts`: `~/.config/systemd/user/c9view-node.service`, restart on failure, journald logs
- [ ] T107 [US6] `packages/cli/src/service/launchd.ts`: `~/Library/LaunchAgents/dev.c9view.node.plist`, `KeepAlive`, logs to `~/Library/Logs/c9view/`
- [ ] T108 [US6] `packages/cli/src/service/index.ts`: platform choice, print-confirm-write flow like `hooks install`, status probe
- [ ] T109 [US6] Register `node install-service`, `uninstall-service`, `service status` in `packages/cli/src/main.ts`
- [ ] T110 [US6] `docs/deploy.md`: service section (Linux, macOS, WSL)

---

## Phase 11: Polish

- [ ] T111 Maintainer's manual check per [quickstart.md](quickstart.md#step-7-us4us6--manual-check-by-the-maintainer): hub on 7790 with `C9VIEW_AUTH=token`, two nodes on two fixture dirs; pair both, revoke one, restart the other; 1440×900 and 390×844
- [ ] T112 `specs/README.md`: update the feature's status
- [ ] T113 Run `/speckit-converge` for this feature
- [ ] T114 Follow-up for a later release: remove the legacy hook-events read (research R6)

---

## Dependencies and order

- 6.0a (T001–T020) blocks everything.
- 6.0b (T021–T037) and 6.0d (T048–T058, T115–T116) depend only on 6.0a and share no source file; they can run in parallel (`docs/deploy.md`: whichever merges second rebases). 6.0c (T038–T047) starts after 6.0b merges.
- 7a and 7b both edit `apps/hub/src/app.ts` (7a: merged-endpoint mount; 7b: `/api/nodes/connect` and its Origin exemption); whichever merges second rebases, keeping the mount order in [plan.md](plan.md#pr-split).
- 002 PR 6a needs 6.0a, 6.0b and 6.0d; 6.0c merges before 002 PR 6b.
- 7a and 7b need 002 PR 6a; 7c needs 7b; 7d needs 7a, 7c and 002 PR 6c (kit `Dialog`); 7e needs 7b.
- Inside each PR: tests first (they fail), then implementation.

## Parallel examples

- 6.0a: T005–T009 together, then T010–T015 in order, T016–T020 in parallel.
- 6.0b: T021–T026 together; T027 then T028–T030 (hub) ∥ T031–T035 (web) ∥ T036 (node).
- 7b: T065–T075 and T117 together; T076–T079 (node) ∥ T080–T083 (hub), then T084–T085.

## Implementation strategy

MVP is US1 (6.0a): the split with no behaviour change. Then US2 and US7 (6.0b, 6.0d), which unblock session control (002). US3 (6.0c) follows. Step 7 (US4–US6) starts after 002's first PR.
