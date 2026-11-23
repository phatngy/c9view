# Tasks: Remote Control of Terminal Sessions

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md), [amendments.md](amendments.md) and [spike.md](spike.md).

**Order**: **003-0 → 003-a → 003-b → 003-c → 003-d**. 002 Phase 9 (`fix/002-phase9`) must merge before 003-0, 003-b and 003-c start; 003-a may start now. Each PR has its own worktree and branch. Story sections follow the plan's file ownership: US3 parsing must precede US1 sending; the web completes the stories in priority order. Do not ship the node increment as a finished web feature.

**Tests**: Write colocated Vitest tests first and observe the relevant failure before implementation. Use synthetic fixtures and the fake terminal; automated tests and CI never execute real Claude Code. No new dependency, lockfile change, hook, persistent address store or database migration. The removal of `ReplyBody.fork` in `packages/api/src/control.ts` is the justified non-additive change (plan Complexity Tracking). The barrels get additive edits only.

**Format**: `- [ ] Tnnn [P?] [USn?] Description with exact paths`. `[P]` means separate files with no incomplete prerequisite. Tasks in setup, foundation, PR gates and polish have no story label. Tick tasks only after verification; preserve existing 002 ticks. Each PR's final task commits its verified task ticks. Existing checklist wording needs the maintainer's approval before edits.

## Phase 1: Setup — PR 003-0 (constitution 1.1.0)

**Prerequisites**: 002 Phase 9 merged; rebase on it first (T112 rewrites the `AGENTS.md` conventions bullet this PR appends to).

**Goal**: Authorize the new socket write before implementation that sends. Apply the settled amendment text, not a new storage exception.

- [x] T001 Invoke `/speckit-constitution` for `.specify/memory/constitution.md`: apply [amendments.md](amendments.md#constitution), add the same-user, same-machine live-session delivery exception and revised receiving-process sentence; bump 1.0.0 → 1.1.0 (MINOR), set Last Amended to the merge date and include the sync impact report. Keep state-folder rules unchanged.
- [x] T002 Update `AGENTS.md` and `docs/data-sources.md` from [amendments.md](amendments.md): describe control-on socket delivery, per-check live-status discovery, no stored address, no `*.key` opens and no kept `peerToken`; document the live fields (and correct the `*.key` paragraph: `peerToken` can also appear in some `sessions/*.json` and is dropped at parse time; c9view never opens `*.key` files), exact frame, silent socket, transcript records, inbound behaviour, Linux-only minimum 2.1.318 and upgrade re-spike procedure. Record the 2026-11-05 re-spike answers (R13 items 1–8) and keep the still-open parts (item 8's `-p` frame acceptance and `bg`/`daemon` kinds, item 9 macOS) marked untested; document the `crossSessionInbound` precedence and per-mode default, the `kind` + `entrypoint` gate and the `procStart` format. Use existing spike evidence, without running Claude.
- [x] T003 Validate `.specify/memory/constitution.md`, `AGENTS.md` and `docs/data-sources.md` together against `specs/003-remote-control/amendments.md`; verify no broader write permission or template change slipped in and arrange independent PR review under `docs/ai-workflow.md`.
- [x] T004 Run root `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm test:e2e` for 003-0; run Playwright in the matching Docker image as described in `specs/003-remote-control/quickstart.md`; resolve failures before marking `specs/003-remote-control/tasks.md`.
- [x] T005 After review and green checks, tick verified 003-0 tasks in `specs/003-remote-control/tasks.md` and commit that task update as the last commit of PR 003-0; merge before 003-b.

## Phase 2: Foundation — PR 003-a (peer parsing)

**Goal**: Read both peer record forms and expose honest marker metadata without sending anything.

- [x] T006 Check that R13 item 1 is answered in `specs/003-remote-control/spike.md` under `Re-spike (2026-11-05)` before 003-a merges. Already satisfied: answered yes on 2026-11-05 (mid-turn `attachment.queued_command` keeps `origin.msg_id`, `from`, `name`), so the parser needs no wrapper fallback. Tick after confirming the evidence is unchanged; do not run Claude.

### User Story 3 — clear labelling (P2, parser)

**Independent test**: Synthetic idle and queued peer records produce the right text and metadata; terminal input is unchanged. Matching both kernel-verified PID and process start proves current-node identity; a marker alone never does.

- [x] T007 [P] [US3] Write `packages/core/src/transcript/peer.test.ts` for idle `user` origin and `attachment.queued_command`, c9view marker (`origin.from` and `origin.name` both required, in both record types), attribution stripping, ordinary peers, a peer record missing `from` or `name` (peer, no label, no error, no wrapper fallback), human/no-origin prompts, malformed/unknown fields and missing optional values; test the R13 item 1 answer.
- [x] T008 [P] [US3] Write `packages/node/src/remote/proc.test.ts` for `/proc/self/stat` field 22 extraction (including spaces/parentheses in command names), current-node identity, malformed/missing stat and PID reuse comparison; fail closed on unreadable identity.
- [x] T009 [P] [US3] Write `packages/node/src/data/messages.test.ts` for queued peer inclusion, stable record UUID and ordering/pagination, c9view vs ordinary peer metadata, exact-body display and existing redaction, matching/mismatching verified PID plus procStart, and unchanged terminal-typed messages.
- [x] T010 [US3] Implement `packages/core/src/transcript/peer.ts` and extend `packages/core/src/transcript/schemas.ts`: origin fields `kind`, `from`, `name`, `msg_id`, `verifiedPeerPid`, `verifiedPeerProcStart`, `body` are “all optional, passthrough”; queued records use `attachment.type: "queued_command"`, `prompt` and `origin`. Recognize c9view only with exact `origin.from` `uds:/dev/null/c9view` and `origin.name` `c9view`, with no wrapper-content fallback (missing fields: no label); remove only the exact attribution line and preserve other peers' display.
- [x] T011 [US3] Add parser exports in `packages/core/src/transcript/index.ts` and additive exports in `packages/core/src/index.ts`; add `Message` fields in `packages/api/src/index.ts`: “`sentFrom?: 'c9view' | 'peer'` and `sentFromVerified?: boolean` (only with `'c9view'`)”. Keep all existing barrel exports.
- [x] T012 [US3] Implement `packages/node/src/remote/proc.ts` using `/proc/self/stat` field 22; cache only node self identity for the process lifetime and expose safe target-process start comparison for 003-b. Do not leak raw proc errors.
- [x] T013 [US3] Integrate peer parsing in `packages/node/src/data/messages.ts`, including queued attachment records; pass text through existing `redactStrings`; set verification only when both verified PID and procStart equal the current node. Keep transcript-driven paging and the SQLite index unchanged.

### PR 003-a gate

- [x] T014 Review only the 003-a paths listed in `specs/003-remote-control/plan.md`, including additive barrel edits, and verify T006's evidence gate; arrange independent review through `docs/ai-workflow.md`.
- [x] T015 Run root `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm test:e2e` for 003-a, with Playwright in Docker per `specs/003-remote-control/quickstart.md`; fix failures.
- [x] T016 Tick verified 003-a tasks in `specs/003-remote-control/tasks.md` after review and checks, and commit the task update as PR 003-a's last commit.

## Phase 3: Node stories — PR 003-b

**Prerequisites**: 003-0 merged and 002 Phase 9 merged (T108 edits `packages/node/src/control/service.ts`).

**Goal**: Deliver one frame into the verified local terminal socket and track its receipt without taking over the process.

- [x] T017 **Merge gate:** R13 items **1–8** were answered on 2026-11-05 on Claude Code 2.1.318 in `specs/003-remote-control/spike.md`'s **Re-spike (2026-11-05)** section, and tasks T020–T043 already reflect the answers (item 2 no: no earlier acknowledgement step; item 7: inbound precedence and mode default; item 8: `kind` + `entrypoint` gate). The installed Claude Code is now 2.1.323 (2026-11-16). Before 003-b merges, re-run the R13 items 1–8 on the installed version and record the version and results in `docs/data-sources.md`. The maintainer runs it, or an agent runs it only with the maintainer's consent, because it spends real tokens (about two Haiku turns). Also confirm 003-0 and 003-a merged. Item 8's untested parts (`-p` accepting a frame; `bg`/`daemon`) stay open and are covered by fail-closed gating. Do not change the minimum version (2.1.318). CI and agents never run Claude on their own.

### Cross-cutting regression tests — write before node implementation

- [x] T018 Extend `packages/node/src/control/no-write.test.ts` first: snapshot temporary Claude dir/project/state writes before/after all remote modes, exclude only fake terminal's own transcript append, assert no new c9view files outside allowed state/index, no settings/socket/key mutation; spy on opens and assert no `*.key` file is opened and no token field appears in any output (a sentinel `peerToken` in the fake's status JSON never surfaces); verify remote sending does not call stop/signal/resume SDK methods.
- [x] T019 Extend `packages/node/src/control/logging.test.ts` first: search captured stdout/stderr, events, receipts, errors and hub responses for sentinel socket/address, the fake session's sentinel `peerToken`, PID/version and message content across success/refusal/error modes; verify only redacted transcript text leaves the node and fixed errors never embed native errors. Exercise both machine-scoped and local relay paths.

### User Story 1 — send to the same session (P1, node)

**Independent test**: A fake live terminal receives exactly one frame for a command; its PID and session ID remain unchanged, no SDK run is started, and control-off routes are absent. Repeat, lost-response and two-tab cases preserve at-most-once delivery and arrival order.

- [x] T020 [P] [US1] Write `packages/node/src/remote/discovery.test.ts` for tolerant live-file parsing, exact session matching, optional/malformed fields, duplicate entries, ignored `*.key` files and fresh reads per check; a token-only fixture (`peerToken`, `pidDomain`, `procStart`, no `sessionId`) is skipped silently and does not cause liveness-unknown; a `.json` with a sentinel `peerToken` beside a `sessionId` parses, and the sentinel never appears in parse results, availability, errors or logs. Quote source constraints in assertions: `pid` “positive integer”, `procStart` “decimal string of digits”, `pidDomain` “string or number”, `version` “string `x.y.z`”, `peerProtocol` “integer”; also `kind` and `entrypoint`, and a stale file (dead PID, old `status`).
- [x] T021 [P] [US1] Write `packages/node/src/remote/frame.test.ts` for the exact R4 one-line frame, UUID v4 msg_id, no auth or `from-mode`, safe attribution, plain slash text, case-insensitive wrapper injection rejection and UTF-8/escaping byte cap `FRAME_MAX_BYTES` = 131,072.
- [x] T022 [P] [US1] Write `packages/node/src/remote/send.test.ts` for connect/write/end without reading replies, three-second default timeout, partial-write uncertainty and every R7 mapping (`ENOENT`, `ECONNREFUSED`, `ENOTSOCK`, `EACCES`, `EPIPE`, `ECONNRESET`), including `ECONNREFUSED` and `ENOENT` with a dead PID or `procStart` mismatch → `session-ended` (and with a live matching process → `unreachable`) and no retries.
- [x] T023 [P] [US1] Write `packages/node/src/remote/service.test.ts` for reserve-before-send, same-body replay with one frame, changed body `payload-mismatch`, restart/expiry/tombstone/cap `unknown-outcome`, concurrent command ordering shared with 002, own-run reply routing and no new run/session/process; use an injectable fake transport first.
- [x] T024 [P] [US1] Write `packages/node/src/remote/routes.test.ts` for GET/POST machine-scoped remote routes, 404 with control off or unknown project/session, strict body validation, 400 `bad-text`, 413 above 48 KiB/frame cap, 409 fresh availability and receipt conflicts, and 202 sent/uncertain/failed receipts.
- [x] T025 [P] [US1] Extend `apps/hub/src/control/guard.test.ts` for the remote POST: authentication, Origin, JSON, `X-C9view-Control: 1` and boot ID remain required; local alias and target-node relay preserve scope and never retry. Change hub tests only.
- [x] T026 [US1] Implement `packages/node/src/remote/fake-session.ts` as unexported test support: temporary Claude/project dirs, real process PID/procStart, owner-only allowed socket folder and 0600 socket, synthetic live JSON (with a sentinel `peerToken`) and a `<pid>.<hash>.key` file, a transcript, frame capture, idle/queued append, hold/drop/reset/close modes and cleanup. Also add `src/remote/fake-session.ts` to `packages/node/tsconfig.build.json`'s `exclude`. Never execute Claude, read keys or change a real session.
- [x] T027 [US1] Add contract types in `packages/api/src/control.ts` per `specs/003-remote-control/data-model.md`: full `RemoteUnavailableReason` union; availability `reason` “set iff not available”, `minVersion` “with `too-old`”, `inbound?: 'hold' | 'may-hold'`, `sessionState?: 'idle' | 'busy' | 'waiting' | 'unknown'`, `checkedAt` “ISO”; never expose socket/PID/raw version. Add `RemoteSendBody`: `text` “1–20,000 characters”, “must not contain `cross-session-message`, case-insensitive”, `clientRequestId` “uuid”, “Strict: unknown fields → 400”. Add operation `remote`, optional receipt `delivery`, conflict `remote-unavailable` with optional availability, bad request `bad-text`, and IDs-only `control.remote`; keep fork until 003-d.
- [x] T028 [US1] Implement tolerant per-check reading in `packages/node/src/remote/discovery.ts` using `specs/003-remote-control/contracts/live-status.md`: “every field optional except `sessionId`”, no stored address, parse with an explicit pick schema (`z.object({...}).strip()`, never passthrough) so `waitingFor`, `name`, `tmux`, `peerFeatures`, `peerToken` and key files are dropped; map unknown `status` to `unknown`. Read `kind` and `entrypoint`; `procStart` is a decimal string. A `.json` without `sessionId` (token-only: `peerToken`, `pidDomain`, `procStart`) is skipped silently and does not cause liveness-unknown. Feed duplicates/unparsable matching files to fail-closed availability.
- [x] T029 [US1] Implement `packages/node/src/remote/frame.ts` from `specs/003-remote-control/contracts/remote-api.md`: one JSON line with msgV 1, UUID v4 msg_id, type user, priority next, exact wrapper and `from`, attribution and no authority claim. Enforce text, 48 KiB body and 131,072-byte frame bounds before any write; reject wrapper injection as `bad-text`.
- [x] T030 [US1] Implement `packages/node/src/remote/send.ts` with one connect/write/end and fixed error strings from R7; distinguish errors before/after bytes, map timeout to uncertain, drop address after use and never resend, read socket responses, signal or take over the terminal.

### User Story 4 — refuse unsafe or unreachable sends (P2, node)

**Independent test**: Each R7 refusal yields the specified reason and zero frames; stale page data cannot bypass a fresh send-time check. Same-user ownership, same PID namespace and procStart are all required.

- [x] T031 [P] [US4] Write `packages/node/src/remote/version.test.ts` for minimum 2.1.318, numeric comparison, newer versions and unknown/malformed/prerelease/build suffix versions failing closed as too-old.
- [x] T032 [P] [US4] Write `packages/node/src/remote/socket-path.test.ts` for every allowed folder, absolute normalized bare paths, exact `<pid>.sock`, wrong folder/name/uid, `uds:` prefix, traversal, symlink folder/socket, non-socket, 0644/socket access bits and group/world-writable folders; mock foreign ownership without changing host files.
- [x] T032a [P] [US4] Write `packages/node/src/remote/mode.test.ts` first: the last `permission-mode` record wins; else the last `permissionMode` string on a record; no record → unknown; a record outside the final 64 KiB is not seen (bounded read from the end, never the whole file); malformed lines and unknown fields tolerated; text not retained or logged.
- [x] T033 [P] [US4] Write `packages/node/src/remote/inbound.test.ts` for the R7 step 15 rule, read-only, three layers only (user `<claudeDir>/settings.json`, project `<cwd>/.claude/settings.json`, local `<cwd>/.claude/settings.local.json`; `cwd` from the status file): `<claudeDir>/settings.local.json` `accept` is ignored; user `hold` + project `accept` → `hold`; cwd differs from the project path; a malformed or unreadable layer → `hold`; user wins over repo `accept`; repo `hold`/`refuse` tighten a user `accept` or unset; repo `accept` alone changes nothing; invalid value → `hold`; `refuse` → refusal; unset with receiver mode `default`/`acceptEdits`/`plan`/`auto` → no warning; `bypassPermissions` → `may-hold`; no mode record → `may-hold`; explicit `accept` → no warning in any mode; mode is an input to `inbound.ts` (from `mode.ts`); managed/flag sources never read; `readSettings`/`mergeSettings`/`settingSource` are not used.
- [x] T034 [P] [US4] Write `packages/node/src/remote/availability.test.ts` for all fifteen ordered R7 checks: disabled/cap, non-Linux, missing session, own run, duplicate/malformed entry, absent/dead PID, namespace mismatch/missing PID, procStart mismatch, noninteractive (`kind` other than `interactive`, `entrypoint` `sdk-cli` or missing), stale JSON with dead PID, old/unknown version, unknown protocol, missing/bad address, folder/socket ownership/mode and refused settings, plus the `hold` and `may-hold` warnings staying available; verify fresh recheck defeats a check-to-send change and never reads tokens.
- [x] T035 [US4] Implement `packages/node/src/remote/version.ts`, `packages/node/src/remote/socket-path.ts` and `packages/node/src/remote/inbound.ts`: minimum 2.1.318; allow only R7 folders with real owned non-group/world-writable directories and owned mode-0600 socket; implement `inbound.ts` as the R13 item 7 rule: a small dedicated reader over exactly three layers (user `<claudeDir>/settings.json` only; project `<cwd>/.claude/settings.json`; local `<cwd>/.claude/settings.local.json`) through core's root-confined `readTextResult` (`packages/core/src/claude-config/shared.ts`, exported additively via `packages/core/src/claude-config/index.ts`), parsing only `crossSessionInbound` with Zod; the user value is the base, project/local replace it only when stricter (accept < hold < refuse); an invalid value or an existing but unparsable layer = `hold`; unset by receiver mode, which is an input from `mode.ts` (bypass or unknown → `may-hold`); no writes, not through `readSettings`/`mergeSettings`/`settingSource`; the result is advisory because managed and flag sources are unreadable.
- [x] T035a [US4] Implement `packages/node/src/remote/mode.ts`: read at most the last 64 KiB of the session transcript, Zod-tolerant, using core's `permissionModeRecordSchema` and the record logic of `permissionModes` (`packages/core/src/transcript/summary.ts`); return the mode or unknown. Node-only; never stored, logged or returned.
- [x] T036 [US4] Implement `packages/node/src/remote/availability.ts` in exact R7 order, reusing `remote/proc.ts`, 002 liveness and `runs.bySession`; Linux/WSL only; own-run/not-live select 002 reply, ambiguity refuses. `token-required` stays reserved; unsupported Windows/macOS return unsupported-platform. Gate step 9 on `kind === "interactive"` and `entrypoint === "cli"` (else `not-interactive`, “not an interactive terminal session”); treat a stale JSON with a dead PID as not live and read `status` only after the pid and `procStart` checks (field 22 parsed after the last `)`); read the receiver mode with `mode.ts`, pass it to `inbound.ts`, set `inbound` to `hold` or `may-hold` and keep `refuse` as `inbound-refused`. Return only safe reason/hint fields and minimum version, never raw session metadata.

### User Story 2 — observable delivery outcomes (P1, node)

**Independent test**: Fake transcript writes cause sent → delivered/new-turn or next-step; hold/drop causes not-seen then late delivered. Timeout/partial-write stays uncertain and can become delivered. Receipt lifetime bounds all tracking, without waiting for Claude's answer.

- [x] T037a [P] [US2] Extend `packages/node/src/control/receipts.test.ts` first for a read-only `has(operation, id)`: true while the reservation or receipt lives, false after expiry/sweep or for an unknown key, no state change.
- [x] T037 [P] [US2] Write `packages/node/src/remote/tracker.test.ts` for idle and queued `origin.msg_id` correlation (no `queue-operation enqueue` matching), unrelated IDs, `deliveredAt` equal to the record timestamp, a released hold keeping its `msg_id` (record timestamp = release time), record-derived turn despite changed status, hold/drop and late release, uncertain → delivered, partial JSON lines/UTF-8 boundaries, duplicate events, two-second fallback, byte-offset-only reads and cleanup when `has` turns false/restart; an unresolvable transcript leaves `sent` then `not-seen`, no error; no text retained or resend.
- [x] T038 [US2] Extend `packages/node/src/remote/service.test.ts` for each delivery transition and IDs-only event, `done` once sent/uncertain and `failed` when nothing was sent, fast receipt settlement without a response, late delivery and expiry/tombstone behaviour; assert sent visible within two seconds on the reachable fake and delivery within two seconds of a record.
- [x] T039 [US2] Define `RemoteDelivery` constraints in `packages/api/src/control.ts`: `state` “`'sent' | 'delivered' | 'not-seen' | 'uncertain' | 'failed'`”; `turn?: 'new-turn' | 'next-step'` “only with `delivered`”; `reason?: 'session-ended' | 'unreachable'` “only with `failed`”; `sentAt?`, `deliveredAt?` “ISO”; receipt delivery “set only for operation `remote`”.
- [x] T040 [US2] Add Zod-parsed `C9VIEW_REMOTE_SEND_TIMEOUT_SEC` default 3 and `C9VIEW_REMOTE_NOT_SEEN_SEC` default 20 (tracking continues after not-seen; mid-turn delivery can lag by a long tool call) to `packages/node/src/control/config.ts`; cover valid/invalid environment inputs in `packages/node/src/remote/service.test.ts` before implementation, using 002's configuration conventions.
- [x] T040a [US2] Add read-only `has(operation, id)` (additive) to `packages/node/src/control/receipts.ts` for the tracker.
- [x] T041 [US2] Implement `packages/node/src/remote/tracker.ts`: pending entry holds only msg_id, operation key, project/session IDs, transcript path, send-time byte offset and timer; resolve the transcript file through the node's existing session lookup (the one `data/messages.ts` uses); if it can't be resolved the receipt stays `sent` and becomes `not-seen` after the timer, never an error; read complete new lines on session changes and every two seconds, preserve partial lines, stop on delivered, or on each tick drop the entry when `Receipts.has(operation, id)` is false (receipt gone; 002 default ten minutes). Track not-seen and uncertain without resending; match peer origin and derive turn from user vs queued attachment records, not live status; take `deliveredAt` from the record's timestamp; ignore `queue-operation` records.
- [x] T042 [US2] Implement `packages/node/src/remote/service.ts` and compose it into `packages/node/src/control/service.ts`: expose `remoteAvailability`/`remoteSend`, share existing receipts/control flag/per-session chain/events, reserve before side effects, recheck immediately before connection and capture tracker offset before send; give the tracker `Receipts.has` (T040a). Emit IDs-only `control.remote` on each transition; never create a 002 run or persist pending delivery/text.
- [x] T043 [US1] Implement `packages/node/src/remote/routes.ts` and mount through `packages/node/src/control/routes.ts` only with control on; enforce the route contract, existing request limits and strict Zod body, fresh availability refusal and existing receipt polling route. Keep 002 messages route's live-session refusal and generic hub relay unchanged.

### PR 003-b safety and gate

- [x] T044 Update `docs/deploy.md` with control/login requirements, Linux/WSL local-user/PID-namespace constraints, two timeout settings, version floor, refusal fixes, the hold and may-hold warnings, the interactive-terminal-only gate and upgrade re-spike link; explain containers lacking host process visibility fail closed, without exposing example real addresses.
- [x] T045 Confirm `specs/003-remote-control/plan.md`'s 003-b ownership, no dependencies/lockfile/hooks/state schema changes, root privacy/no-write tests and T017 gate; arrange independent security review under `docs/ai-workflow.md`.
- [x] T046 Run root `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm test:e2e` for 003-b using Docker Playwright per `specs/003-remote-control/quickstart.md`; fix failures.
- [x] T047 Tick verified 003-b tasks in `specs/003-remote-control/tasks.md` after review/checks and commit the task update as PR 003-b's last commit.

## Phase 4: Web stories — PR 003-c

**Prerequisites**: 003-b and 002 Phase 9 merged. Keep T107's `currentRun` use in `apps/web/src/control/Composer.tsx` and 002's existing `start` call in `apps/web/src/control/api.ts`.

### User Story 1 — remote composer (P1, web)

**Independent test**: Authenticated desktop fake-terminal e2e sends into the existing session with one frame, no new session/process and no fork UI; control-off page exposes no send control.

- [x] T048 [US1] Confirm 002 Phase 9 merged and rebase 003-c on it (keep T107's `currentRun` use in Composer.tsx); keep the plan's web ownership boundaries in `specs/003-remote-control/plan.md`.
- [x] T049 [P] [US1] Write `apps/web/src/control/remote.test.tsx` for remote/reply/refused modes, control off, own-run path, command ID reuse after lost response, pending Send lock and text preservation, plus exact terminal-session heading and slash/plain-text note.
- [x] T050 [P] [US1] Write `tests/e2e/remote.spec.ts` desktop cases at 1440×900 for login/guarded send, same-session transcript/assistant updates without reload, one frame per retry, no extra session/process and control-off 404/no composer; use the planned fake server, never Claude.
- [x] T051 [US1] Extend the existing control-on e2e server `tests/e2e/control-server.ts` and fixture `tests/e2e/control-fixture.ts` (both exist from 002 Phase 8 T102, with token login, synthetic Claude/project data and a fake `C9VIEW_CLAUDE_BIN` that only prints a version) with the fake terminal session in a new `tests/e2e/fake-terminal.ts` child-process support file. 002 T105 also edits `control-server.ts` (workspace root), so rebase on Phase 9 first and keep its change. Reuse `packages/node/src/remote/fake-session.ts` by its exact relative import from `tests/e2e` (`../../packages/node/src/remote/fake-session.js` or the extension the e2e tsconfig needs) and confirm `tests/e2e/tsconfig.json` resolves it (it is excluded from the node build, so no production export), provide test-only scenario controls and deterministic cleanup.
- [x] T052 [US1] Reuse the existing control web server in `playwright.config.ts` (port 7793 from `control-fixture.ts`, own temp state dir, `C9VIEW_TOKEN` env); no fourth server is needed because the fake terminal runs as a child of `control-server.ts` and needs no separate env. Add two Playwright projects with `testMatch: ['remote.spec.ts']`, `chromium-remote` at 1440×900 and `chromium-remote-phone` at 390×844 (Pixel 7), both with `baseURL: controlBaseURL`. Keep existing projects and servers intact (the existing control projects match only `control.spec.ts` and `control-phone.spec.ts`) and ensure Linux socket checks run inside Docker and CI without real Claude.
- [x] T053 [US1] Add remote GET/POST helpers and receipt `delivery` parsing in `apps/web/src/control/api.ts`; use strict command inputs, existing control headers/machine scope and receipt recovery, tolerate contract additions, and carry no address or raw version. Add `(machineId, projectId, sessionId)` availability key in `apps/web/src/queryKeys.ts`.
- [x] T054 [US1] Implement `apps/web/src/control/useRemote.ts` availability/receipt queries keyed by machine/session and `(machineId, clientRequestId)`; use existing polling/recovery conventions, preserve command IDs and never auto-retry a send. Switch `apps/web/src/control/Composer.tsx` among reply, remote and refused, deriving the mode from `currentRun` in `apps/web/src/control/runState.ts` (as used since 002 T107) and keeping draft text, with exact contract send label, attribution expectation and slash warning.

### User Story 2 — delivery feedback (P1, web)

**Independent test**: Component and fake-terminal e2e cover all contract outcomes, late delivery, lost response, missed/reordered events and receipt expiry; feedback never claims held/refused after sending and never waits for Claude's answer.

- [x] T055 [US2] Extend `apps/web/src/control/remote.test.tsx` first for sent, both delivered turns, not-seen → delivered, uncertain → delivered, failed reasons, receipt 404, lost POST and reconnect; verify no automatic resend and no duplicate announcements from repeated/refetched state.
- [x] T056 [US2] Extend `tests/e2e/remote.spec.ts` first for idle/busy transcript delivery, hold/drop not-seen then release, failed and partial-write uncertain, lost response and two tabs ordered at-most-once with both outcomes visible in every tab after refresh/reconnect; assert sent and post-record delivery each visible within two seconds in the reachable case.
- [x] T057 [US2] Implement `apps/web/src/control/RemoteNotice.tsx` with exact delivery texts from `specs/003-remote-control/contracts/remote-api.md`, advisory hold and may-hold warnings (texts in `contracts/remote-api.md`, send stays enabled), expiry guidance and terminal-only permission/question notice; retain draft on failures and announce a changed outcome once through the existing live region.
- [x] T058 [US2] Update `apps/web/src/live/index.tsx` for IDs-only `control.remote`: refetch receipt/availability, refresh availability on session/control.run events and gaps/SSE reopen/machine reconnect; refetch receipts for hinted commands even when initiated in another tab, reconcile them on polling/gaps, and show both commands’ outcomes in every open tab after its next refresh; complete visible-page ten-second availability polling in `apps/web/src/control/useRemote.ts` and render notices from `apps/web/src/control/Composer.tsx`. Transcript remains the only source of conversation content.

### User Story 3 — accessible conversation label (P2, web)

**Independent test**: Rendering transcript fixtures labels every c9view marker with its confidence, labels zero terminal prompts, and survives receipt expiry/node restart through transcript metadata.

- [x] T059 [P] [US3] Extend `apps/web/src/session/markup.test.ts` first for both peer forms, exact c9view text/label fields, human/ordinary-peer exclusions, unverified marker description and existing escaping/redaction behaviour; add label assertions to `apps/web/src/control/remote.test.tsx` after T055.
- [x] T060 [US3] Extend `tests/e2e/remote.spec.ts` for c9view label and accessible confidence on idle/queued records, no label on terminal input, attribution in fake-received frame and label persistence after receipt loss/restart.
- [x] T061 [US3] Extend `apps/web/src/session/markup.ts` and `apps/web/src/session/Conversation.tsx` for visible and accessible “Sent from c9view”; unverified description is “Marked as sent from c9view; c9view can't confirm this after a restart”. Keep terminal prompts unlabelled, display safe text and retain existing conversation virtualization.

### User Story 4 — reasons, fixes and no fallback (P2, web)

**Independent test**: Parameterized component cases cover every availability reason and fix with preserved text. A live → dead change selects reply but sends nothing; unknown liveness selects refusal. No page action offers fork or queue.

- [x] T062 [US4] Rewrite 002 T042's fork expectations in `apps/web/src/control/control.test.tsx` before implementation: live-elsewhere refetches/switches to 003 remote mode; liveness-unknown keeps text and offers only the reason. Replace the fork recovery case in `apps/web/src/control/recovery.test.tsx` with Stop waiting unlocking normal remote recovery without creating a second command.
- [x] T063 [US4] Extend `apps/web/src/control/remote.test.tsx` first with every reason/fix in `specs/003-remote-control/contracts/remote-api.md`, too-old minimum version, reserved token-required presentation, offline/control-unavailable, hold and may-hold warnings with Send enabled, not-interactive text, stale-check 409 and live → dead preserving text with zero auto-send; assert no fork/queue/resume of live/unknown sessions anywhere.
- [x] T064 [US4] Extend `tests/e2e/remote.spec.ts` for old/no-address/bad-owner-or-mode/procStart/inbound-refused/not-interactive (`sdk-cli`)/unknown-liveness/unsupported cases, the hold and may-hold warnings, zero frames, preserved text and no fork anywhere; cover process exit switching to reply without auto-send and terminal-only permission guidance.
- [x] T065 [US4] Complete refusal rendering in `apps/web/src/control/RemoteNotice.tsx` and `apps/web/src/control/Composer.tsx` with contract reasons/fixes and disabled Send; remove the fork UI branches (“Fork and reply”, live-elsewhere and unknown-liveness recovery) while keeping the mode derived from `currentRun` (`runState.ts`, after T107); the `reply(..., fork)` parameter in `api.ts` stays until T074. On own-run/not-live use 002 reply with the draft kept and explicit new Send required; permission/questions show “Approve in the terminal” with no decision control.

### User Story 5 — phone and accessibility (P3)

**Independent test**: At 390×844 the owner can send by keyboard, follow live outcome/response and read the label/reason without horizontal scrolling; touch targets are at least 44 px and a screen reader gets each outcome once.

- [x] T066 [US5] Add mobile/keyboard/live-region assertions first in `tests/e2e/remote.spec.ts` and `apps/web/src/control/remote.test.tsx`: 390×844, no horizontal overflow, 44 px targets, focus retained, label accessible name, one announcement per outcome and terminal-only permission message; exercise refusal and recovery as well as success.
- [x] T067 [US5] Adjust `apps/web/src/control/Composer.tsx`, `apps/web/src/control/RemoteNotice.tsx` and `apps/web/src/session/Conversation.tsx` within existing design tokens/kit conventions for keyboard focus, screen-reader descriptions, reduced motion, readable text and 390 px layout/44 px targets; no new kit or route files.

### PR 003-c gate

- [x] T068 Search captured server stdout/stderr, SSE, receipt and hub-response bodies in `tests/e2e/remote.spec.ts` for fake socket path, token and sentinel remote text outside redacted transcript content; assert no address/secret reaches the browser and do not include the authorized owner-to-node POST body or redacted transcript display in the zero-echo assertion.
- [x] T069 Arrange independent UI/accessibility review under `docs/ai-workflow.md`; verify only 003-c-owned paths from `specs/003-remote-control/plan.md` changed and 002's start flow and T107's `currentRun` use are preserved.
- [x] T070 Run root `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm test:e2e` for 003-c; run Playwright in the installed-version-matched Docker image per `specs/003-remote-control/quickstart.md`, including desktop/mobile remote specs and the existing suite; fix failures.
- [x] T071 Tick verified 003-c tasks in `specs/003-remote-control/tasks.md` after review/checks and commit that update as PR 003-c's last commit.

## Phase 5: Remove fork end to end — PR 003-d

**Prerequisites**: 003-c merged. The 002 doc amendments (T075, T076) go after 002 T104 (status Implemented, T088 ticked).

**Goal**: Remove the executable fork API, including unknown-liveness cases, and date the changes to 002. 003-c has already removed the UI. The non-additive change is justified in the plan; shared barrels stay additive.

### User Story 4 — refusal without a fork (P2, API cleanup)

**Independent test**: `fork` in a reply body is 400; live or unknown sessions cannot bypass liveness; no SDK forkSession option or web fork argument remains. Normal ended-session reply and new/resumed bypass behaviour still pass.

- [x] T072 [US4] Update `packages/node/src/control/service.test.ts` first for strict reply-body fork rejection, removal of 002 T021/T024 fork cases and 002 T033 fork bypass expectation, retained new/resumed bypass tests and no live/unknown resume; update `packages/node/src/control/liveness.test.ts` to assert 409 reasons without a fork suggestion. Add the strict reply-body 400 for `fork` to `packages/node/src/control/routes.test.ts` (owned by 003-d in the plan).
- [x] T073 [US4] Remove `ReplyBody.fork` from `packages/api/src/control.ts` and the strict reply schema in `packages/node/src/control/routes.ts`; remove service liveness bypass/new-ID/forkSession branches from `packages/node/src/control/service.ts`, the `forkSession` option from `packages/node/src/control/sdk.ts` and fork suggestions from both 409 texts in `packages/node/src/control/liveness.ts`.
- [x] T074 [US4] Remove the fork argument from `apps/web/src/control/api.ts`; verify no fork argument or state remains and remove anything T065 left in `apps/web/src/control/Composer.tsx`; audit every executable R8 caller including `apps/web/src/control/control.test.tsx` and `apps/web/src/control/recovery.test.tsx` for dead fork branches, preserving the replacement tests written in 003-c.

### PR 003-d amendments and gate

- [x] T075 Apply [amendments.md](amendments.md#002-files) with inline `_(Amended 2026-11-05 by 003.)_` notes to `specs/002-session-control/spec.md`, `specs/002-session-control/contracts/control-api.md`, `specs/002-session-control/data-model.md`, `specs/002-session-control/quickstart.md` and `specs/002-session-control/tasks.md`: remove active fork semantics, route terminal-held sessions to 003 and unknown liveness to refusal; amend 002 T020/T021/T024/T033/T042 without changing any existing ticks.
- [x] T076 Add dated supersession notes for active fork claims in `specs/002-session-control/plan.md` and `specs/002-session-control/research.md` R1, the additional files named by R8 outside the plan's ownership table; preserve historical context while stating fork is removed by 003. Leave historical `specs/002-session-control/design-notes.md` R9 unchanged as explicitly required by `specs/003-remote-control/amendments.md`.
- [x] T077 Audit all R8 paths against `specs/003-remote-control/research.md` using `rg` for `fork`, `forkSession` and “Fork and reply”: executable API/service/SDK/web uses must be gone; remaining docs must be dated superseded history or removal notes. Verify additive barrels and arrange independent review under `docs/ai-workflow.md`.
- [x] T078 Run root `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build` and `corepack pnpm test:e2e` for 003-d; use Docker Playwright per `specs/003-remote-control/quickstart.md` and recheck the no-fork UI plus normal resume regressions; fix failures.
- [x] T079 Tick verified 003-d tasks in `specs/003-remote-control/tasks.md` after review/checks and commit that task update as PR 003-d's last commit.

## Phase 6: Polish and feature closure

- [ ] T080 Have the maintainer perform the consented manual check in `specs/003-remote-control/quickstart.md` on Linux and record evidence for same-session continuity, busy delivery, held release, refusal, exit and 390 px keyboard/screen-reader use in `specs/003-remote-control/tasks.md`; agents and CI do not execute real Claude.
- [x] T081 Run `/speckit-converge` against `specs/003-remote-control/spec.md`, `specs/003-remote-control/plan.md` and `specs/003-remote-control/tasks.md`, resolve remaining implementation work, and update the `specs/README.md` feature row only when the feature is actually complete.

## Dependencies and execution order

- Merge PRs in order: **003-0 → 003-a → 003-b → 003-c → 003-d**. Read-only 003-a preparation may overlap 003-0, but merges retain that order.
- 002 Phase 9 (`fix/002-phase9`) overlaps: 003-a may start now; 003-0, 003-b and 003-c start after Phase 9 merges; 003-d's 002 doc amendments go after 002 T104. Phase 9 edits `Composer.tsx` (T107), `service.ts` (T108), `tests/e2e/control-server.ts` (T105), the `AGENTS.md` conventions line (T112) and 002's docs; it does not touch the other 003 files (see [plan.md](plan.md#overlap-with-002-phase-9)).
- T006 is an evidence check already satisfied by the 2026-11-05 re-spike (R13 items 1–8); it only needs the spike section to be unchanged. T017 also needs a re-spike on the installed Claude Code (2.1.323) before 003-b merges. Item 2 was a “no”: no queue acknowledgement step exists.
- US3 parser tests T007–T009 precede T010–T013. T010 precedes T011/T013; T012 precedes verification in T013.
- Within 003-b, T020–T025 establish failing tests; T026 supplies the fake and T027 the contract before route/service integration. T031–T034 (with T032a) precede T035–T036 (T035a precedes T036). T037a precedes T040a. T037–T038 precede tracker/service implementation. T039–T041 and T036 precede T042, then T043. T018–T019 are failing privacy/no-write regressions written before any node implementation.
- 003-c requires 002 Phase 9 and 003-b. T049/T050 precede T051–T054; outcome tests T055/T056 precede T057/T058; label tests T059/T060 precede T061; refusal tests T062–T064 precede T065; mobile tests T066 precede T067. These story slices share the composer/test files, so integrate them sequentially.
- US1 needs node safety from US4 and delivery receipt basics from US2. US2 needs the send reservation/frame and US3 transcript parser. US3 UI needs parser metadata only and is independently testable with fixtures. US4 UI needs availability but can test refusals without sending. US5 reuses US1–US4 behaviour.
- 003-d follows 003-c so the only web client stops sending fork before the node/API rejects it. T072 precedes T073/T074. T075 preserves 002's completed ticks and goes after 002 T104 (status Implemented, T088 ticked).
- Each PR gate is sequential: implementation → review/fixes/re-review → root checks → task ticks and final commit. Run `corepack pnpm test:e2e` in every PR; local execution uses the matching Playwright Docker image, without real Claude. Do not claim a blocked check passed.

## Parallel examples

Tasks marked `[P]` can run together once their prerequisites are complete. The cross-story examples below are also safe with those prerequisites; never assign the same file to two workers.

| Story | Safe parallel example | Join before |
| ----- | --------------------- | ----------- |
| US1 | T020 discovery tests, T021 frame tests, T022 transport tests, T023 service tests, T024 route tests and T025 hub guard tests | T026–T030 and T042–T043 |
| US2 | T037 tracker tests can run alongside US4 T031–T034; after contracts settle, tracker and availability modules have separate files | T042 integration; T055/T056 share files with other web story tasks and run sequentially |
| US3 | T007 parser tests, T008 process tests and T009 message tests | T010–T013; T059 markup tests may overlap T051 server support |
| US4 | T031 version tests, T032 path tests, T033 settings tests and T034 gate tests | T035–T036; T062 existing control/recovery tests may overlap T059 markup tests |
| US5 | After T064, mobile Playwright authoring in T066 can overlap a separate-worker audit of completed parser tests | T067; keep its component-test edits serial with other `remote.test.tsx` tasks |

## Implementation strategy

Land the constitution and peer parser first. Build the protected node path with tests, including delivery tracking and every refusal, then demonstrate US1 with the fake terminal. The first usable MVP is 003-c's same-session send plus honest outcomes, refusal and label; these safety pieces cannot be postponed. Complete mobile/accessibility coverage in that same UI PR, then remove the obsolete fork API in 003-d. Close only after convergence and the maintainer's consented manual check.

## Task counts

85 tasks: US1 **19**, US2 **12**, US3 **10**, US4 **15**, US5 **2**; setup, foundation, PR gates and closure **27**. Story totals include both node and web work; PR totals are 003-0 **5**, 003-a **11**, 003-b **35**, 003-c **24**, 003-d **8**, closure **2**.

## Coverage

| Requirement / criterion | Tasks |
| ----------------------- | ----- |
| FR-001, FR-019 | T023–T025, T027, T036, T042–T043, T049–T054, T068 |
| FR-002, FR-003, FR-017, FR-018 | T020, T028, T031–T036 (incl. T032a, T035a), T044, T063–T065 |
| FR-004, FR-006, FR-010; SC-005, SC-006 | T001–T002, T028–T030, T036, T042, T018–T019, T068 |
| FR-005 (moot: no hook) | T001–T003, T045 |
| FR-007; SC-003 | T023–T024, T027, T038, T042–T043, T049–T050, T055–T056 |
| FR-008, FR-009; SC-002 | T021–T022, T029–T030, T037–T042 (incl. T037a, T040a), T055–T058 |
| FR-011, FR-013; SC-007 | T007–T013, T021, T029, T059–T061 |
| FR-012; SC-001 | T009, T013, T037–T043, T050–T058, T080 |
| FR-014; SC-008 | T057, T065–T067, T080 |
| FR-015, FR-016, FR-020; SC-004 | T031–T036 (incl. T032a, T035a), T062–T065, T072–T079 |

## Phase 7: Convergence (whole feature; found by `/speckit-converge` on 2026-11-23)

One CRITICAL constitution gap (T082); every other FR, US, SC, plan and constitution check passes. Marking 003 Implemented waits for the maintainer and T080.

- [x] T082 CRITICAL: parse `sessions/<pid>.json` with explicit-pick (or strip) schemas in `packages/node/src/data/status.ts` and `packages/node/src/control/liveness.ts` instead of `.passthrough()`, so a `peerToken` is never kept in a `LiveEntry` or any other parsed field, and add a test that a sentinel `peerToken` never reaches either parser's output per Constitution I, FR-004, SC-005 (contradicts)
