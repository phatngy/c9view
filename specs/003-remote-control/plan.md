# Implementation Plan: Remote Control of Terminal Sessions

**Branch**: `feat/003-remote-control` (docs); one branch per PR below | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-remote-control/spec.md` (clarified 2026-11-05) and the [spike](spike.md) (Linux, Claude Code 2.1.318). Builds on [002-session-control](../002-session-control/plan.md) as merged through 002 Phase 8 (main dc53729).

## Decisions for the maintainer

All seven decisions were accepted by the maintainer on 2026-11-05, as recommended. The plan is written on that basis. Exact amendment text is in [amendments.md](amendments.md).

1. **Minimum Claude Code version: 2.1.318** (FR-017), the only spike-verified version, as a code constant recorded in `docs/data-sources.md`; raised or confirmed by a short re-spike on every upgrade ([research R1](research.md#r1-minimum-claude-code-version-fr-017)). _Accepted 2026-11-05._
2. **No hook.** The address comes only from Claude Code's live status file `sessions/<pid>.json`, read at every check; c9view stores nothing ([R2](research.md#r2-address-source-live-status-file-no-hook)). This makes FR-004's storage clause and FR-005 moot and supersedes part of Clarification Q2; the 003 spec gets dated amendments (FR-002, FR-004, FR-005, edge case "Session started before…", US4 scenario 2, Key Entities, Constitution-impact assumption). _Accepted 2026-11-05._
3. **Outcome model** follows what an outside sender can observe: sent → delivered (new turn or next step, from the transcript) or not seen yet → may become delivered later; failed; "may have been sent" on a write timeout. "Held" and "refused" are never claimed after sending; a refusal or hold in the session's settings is shown before sending ([R5](research.md#r5-delivery-confirmation-and-outcomes-fr-007fr-009-us2-sc-002)). Needs dated amendments to US2 summary and scenarios 1–4, edge case "Held messages", FR-008, Key Entities and SC-002. _Accepted 2026-11-05._
4. **Linux (and WSL) only** in this feature; macOS after a re-spike of its socket folder and `procStart` ([R7](research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018)). Amends FR-018. _Accepted 2026-11-05._
5. **Remove `ReplyBody.fork` entirely**, including for `liveness-unknown` sessions ([R8](research.md#r8-replybodyfork-open-question)). A non-additive API change, justified below. _Accepted 2026-11-05._
6. **Label honesty**: "Sent from c9view" comes from an unauthenticated marker; it is "verified" only when the kernel-verified sender PID is the current node, otherwise the label says c9view can't confirm it ([R6](research.md#r6-sent-from-c9view-label-fr-013-us3)). Amends FR-013. _Accepted 2026-11-05._
7. **Constitution 1.1.0** (MINOR, Principle I) for delivering into processes c9view did not start; no state-folder change ([R3](research.md#r3-constitution-amendment)). Its own PR (003-0) before 003-b. _Accepted 2026-11-05._

## Summary

With control on, the node can send the owner's message into a Claude Code session that is live in a terminal on the same machine, through Claude Code's cross-session messaging socket. The node reads the socket path, version and protocol from `sessions/<pid>.json`, checks that the socket belongs to the live process and user (PID alive, same PID namespace, `procStart`, socket name, owner and mode, allowed folder), writes one frame with a c9view `msg_id` and `from` marker, and returns a 002 command receipt. Delivery is then confirmed from the session's transcript by `msg_id` (new turn or next step), or reported as "not seen yet". Before sending it also warns when the session will probably hold the message (its `crossSessionInbound` setting, or a `bypassPermissions` or unknown permission mode, taken from the last permission-mode record in a bounded transcript tail, since the status file has none), and offers remote send only to interactive terminal sessions (`kind` `interactive` and `entrypoint` `cli`). Everything is in `packages/node/src/remote/`, composed into 002's `ControlService` so it shares receipts, the per-session order and the control flag; the hub needs no change. Core learns to read peer records so the conversation shows "Sent from c9view". The web composer switches between 002's reply, remote send and a refusal with the fix. 002's "Fork and reply" is removed. No hook, no stored address, no new dependency.

## Technical Context

**Language/Version**: TypeScript (strict, ESM), Node 22.

**Primary Dependencies**: existing Hono, Zod, TanStack Query/Router, Base UI, lucide. New code uses only `node:net`, `node:fs/promises`, `node:crypto` ([R12](research.md#r12-dependencies)). No new runtime dependency, no lockfile change.

**Storage**: none new. Pending deliveries and receipts in memory (002's `receipts.ts` lifetimes). Reads `sessions/<pid>.json`, `/proc/<pid>/stat`, `lstat` of the socket and its folder, Claude settings (`crossSessionInbound`) and transcripts (from a byte offset). The node state store and SQLite index are unchanged (no migration).

**Testing**: Vitest with the fake terminal session (Unix-socket listener, fake `sessions/<pid>.json`, fixture transcript); Playwright with a control-on e2e server and the fake session in a child process, in Docker locally. No real Claude Code in CI. Manual check by the maintainer with consent.

**Target Platform**: Linux nodes (WSL included). macOS and native Windows: unavailable with a reason.

**Project Type**: pnpm workspace: web app + hub + node + CLI.

**Performance Goals**: "Sent" visible within 2 s (SC-002); availability check reads a handful of small files; the tracker reads only new transcript bytes.

**Constraints**: control off by default and every 002 rule inherited (login always, hub guard, per-machine capability); fail closed on any unknown; the socket path, token and text never leave the node or reach logs; never resend.

**Scale/Scope**: single owner; a few pending deliveries at a time, bounded by receipts' lifetime.

### Settings and constants

Parsed with Zod in `packages/node/src/control/config.ts` (002's settings file), each configurable by environment as in 002.

| Variable / constant | Default | FR |
| ------------------- | ------- | -- |
| `C9VIEW_REMOTE_SEND_TIMEOUT_SEC` | 3 | FR-008 |
| `C9VIEW_REMOTE_NOT_SEEN_SEC` | 20 (tracking continues after "not seen yet"; mid-turn delivery can lag by a long tool call) | FR-008 |
| `REMOTE_MIN_VERSION` (constant, `remote/version.ts`) | `2.1.318` | FR-017 |
| `FRAME_MAX_BYTES` (constant, `remote/frame.ts`) | 131,072 | edge case "Message size" |
| Text limit, body limit | 002's `C9VIEW_CONTROL_TEXT_MAX_CHARS` (20,000), 48 KiB | edge case "Message size" |

## Constitution Check

_GATE: checked against constitution v1.0.0 before Phase 0, re-checked after Phase 1 design. Result: **PASS with one amendment**: Principle I needs the 1.1.0 amendment (PR 003-0, merged before any PR that sends). One non-additive API change is justified under Complexity Tracking._

| Principle | Check | Result |
| --------- | ----- | ------ |
| I. Never change Claude data or projects | c9view's code writes no file: no hook change, no state-folder record, no index change. It writes one frame to a socket Claude Code created; the receiving process writes its own transcript. This is new for a process c9view did not start, so Principle I gains a bullet (1.1.0, [amendments.md](amendments.md#constitution)). Settings and `.claude.json` stay read-only; `crossSessionInbound` is read, never changed (FR-010). `no-write.test.ts` proves it (SC-006). | Pass after 003-0 |
| II. Private by default | Socket path, PID, version string, any `peerToken` from a status file, `*.key` files and message text never appear in responses, events, receipts or logs (fixed error strings; leak test SC-005). Text is kept only as 002's fingerprint. Displayed peer text passes through existing redaction (`redactStrings` in `packages/node/src/data/redaction.ts`, used by `messages.ts`). Fixtures are synthetic. | Pass |
| III. Local first, explicit exposure | Remote send exists only with control on, so login is required on every host with no override (002 FR-002); every POST passes `apps/hub/src/control/guard.ts`. The node reaches only sockets of its own uid on its own machine; the hub never sees an address (FR-019). | Pass |
| IV. Tolerant parsing | `sessions/*.json`, `origin` and `attachment` records, and settings parsed with Zod that tolerates unknown fields; unknown or missing values fail closed with a reason; unknown record types stay counted and skipped. No index or state-store change. | Pass |
| V. Strict, small, tested | Small modules in `packages/node/src/remote/` and `packages/core/src/transcript/peer.ts`, colocated tests. Contract types in `@c9view/api`, additive except `ReplyBody.fork` (justified). Shared barrels get additive edits only. No hook change. | Pass (one justified non-additive change) |
| VI. Fast on large data | The tracker reads from the byte offset at send time, on change events, never from the start; the conversation stays transcript-driven; availability is per session and bounded. No full scan. | Pass |
| VII. Honest and accessible UI | Outcomes never overstate ("Sent", "not seen yet", "may have been sent"; held and refused not claimed); the label's confidence is shown; reasons with fixes; live region announces once; 44 px targets; 390 px; text, not colour alone. | Pass |
| Technology constraints | No new dependency; Hono, Zod, SSE hints as in 002. | Pass |
| Workflow | Spec Kit steps; one worktree per PR; Playwright test for the UI change; independent Sonnet review per PR. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/003-remote-control/
├── spec.md
├── spike.md
├── plan.md              # this file
├── research.md
├── data-model.md
├── quickstart.md
├── amendments.md        # proposed text: 003 spec, 002 files, constitution, AGENTS.md, data-sources
├── contracts/
│   ├── remote-api.md
│   ├── remote-events.md
│   └── live-status.md
├── checklists/
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/
├── api/src/control.ts                  # 003-b additive types; 003-d removes ReplyBody.fork
├── api/src/index.ts                    # 003-a: Message.sentFrom, sentFromVerified
├── core/src/transcript/
│   ├── peer.ts  peer.test.ts           # 003-a: peer origin and attachment parsing
│   └── schemas.ts                      # 003-a: optional origin on user records
└── node/src/
    ├── data/messages.ts  messages.test.ts   # 003-a: peer messages, label fields
    ├── remote/                         # 003-b
    │   ├── version.ts      # REMOTE_MIN_VERSION, compare
    │   ├── proc.ts         # procStart from /proc, self identity
    │   ├── discovery.ts    # read and validate the live entry
    │   ├── socket-path.ts  # allowed folders, lstat owner and mode
    │   ├── inbound.ts      # crossSessionInbound: user base, project/local only tighten, three layers read directly (R7 step 15)
    │   ├── mode.ts         # receiver permission mode from a 64 KiB transcript tail
    │   ├── availability.ts # check(): the ordered gate
    │   ├── frame.ts        # the one frame and wrapper
    │   ├── send.ts         # connect, write, end, error mapping
    │   ├── tracker.ts      # msg_id → transcript record
    │   ├── service.ts      # availability(), send() with receipts
    │   ├── routes.ts       # GET and POST …/remote
    │   ├── fake-session.ts # test support (excluded from the build)
    │   └── *.test.ts
    └── control/                        # 002, additive edits in 003-b; fork removal in 003-d
apps/
├── hub/src/control/guard.test.ts       # 003-b: remote POST is guarded (test only)
└── web/src/
    ├── control/                        # 003-c
    │   ├── useRemote.ts  RemoteNotice.tsx  remote.test.tsx   (new)
    │   └── Composer.tsx  api.ts  control.test.tsx  recovery.test.tsx  (edits)
    ├── session/markup.ts  Conversation.tsx  (label)
    ├── live/index.tsx  queryKeys.ts
tests/e2e/
├── control-server.ts  fake-terminal.ts  remote.spec.ts   # 003-c
```

**Structure Decision**: everything that reads Claude files or touches the socket is on the node, under `packages/node/src/remote/`, composed into 002's `ControlService` (one receipts store, one control flag, one per-session order). Core owns only transcript parsing. The hub is unchanged: its guard already covers every POST under `/api/` and its relay is path-generic.

## PR split

Order: **003-0 → 003-a → 003-b → 003-c → 003-d**. 003-a may start in parallel with 003-0 (it only reads). 003-b needs 003-0 merged. Re-spike items 1–8 were answered on 2026-11-05 ([Re-spike (2026-11-05)](spike.md#re-spike-2026-11-05)); the plan applies them. 003-0, 003-b and 003-c start after 002 Phase 9 merges; 003-a may start now (see overlap below). _(Updated 2026-11-16: 002 PRs 6c, 6d and Phase 8 have merged; the open overlap is Phase 9.)_ Each PR passes root `lint`, `typecheck`, `test`, `build` and `test:e2e`, and gets a separate Sonnet review.

| PR | Responsibility | Owns (new) | Edits | Worker |
| -- | -------------- | ---------- | ----- | ------ |
| **003-0** constitution 1.1.0 | `/speckit-constitution` amendment with dependent docs and the spike answers | — | `.specify/memory/constitution.md`, `AGENTS.md`, `docs/data-sources.md` ([amendments.md](amendments.md#constitution)) | Sonnet |
| **003-a** peer messages in the conversation | Parse peer records (`origin`, `attachment.queued_command`), mark c9view ones, verified flag | `packages/core/src/transcript/peer.ts`, `peer.test.ts`; `packages/node/src/data/messages.test.ts`; `packages/node/src/remote/proc.ts` (+ test; self identity, reused by 003-b) | `packages/core/src/transcript/schemas.ts` (optional `origin`), `packages/core/src/transcript/index.ts`, `packages/core/src/index.ts` (additive), `packages/api/src/index.ts` (additive `Message` fields), `packages/node/src/data/messages.ts` | Sol |
| **003-b** remote send on the node | Availability gate, frame, socket send, tracker, routes, receipts and events; privacy and no-write tests | `packages/node/src/remote/` (all files above except `proc.ts`, including `mode.ts` and `mode.test.ts`) | `packages/api/src/control.ts` (additive types); `packages/node/src/control/receipts.ts`, `receipts.test.ts` (read-only `has(operation, id)`, additive); `packages/node/tsconfig.build.json` (add `src/remote/fake-session.ts` to `exclude`); `packages/core/src/claude-config/index.ts` (additive export of `readTextResult`, used by `inbound.ts`); `packages/node/src/control/service.ts` (compose remote, expose `remoteAvailability`/`remoteSend`, share receipts, emit, own-run check and the per-session chain); `packages/node/src/control/routes.ts` (mount remote routes); `packages/node/src/control/config.ts` (two settings); `packages/node/src/control/no-write.test.ts`, `logging.test.ts` (added cases); `apps/hub/src/control/guard.test.ts` (added case); `docs/deploy.md` (remote send section) | Sol (security-sensitive) |
| **003-c** web remote composer and label | Composer modes, outcomes, refusals with fixes, slash and permission notes, label, e2e | `apps/web/src/control/useRemote.ts`, `RemoteNotice.tsx`, `remote.test.tsx`; `tests/e2e/fake-terminal.ts`, `remote.spec.ts` | `tests/e2e/control-server.ts` and `control-fixture.ts` (extend; both exist from 002 T102), `apps/web/src/control/Composer.tsx` (mode switch, derived from `currentRun`; remove the "Fork and reply" UI), `apps/web/src/control/api.ts` (remote calls, `delivery` in the receipt schema), `apps/web/src/control/composer.test.tsx` (edit), `apps/web/src/control/control.test.tsx` (T042 rewritten), `apps/web/src/control/recovery.test.tsx` (fork case replaced), `apps/web/src/live/index.tsx` (`control.remote`), `apps/web/src/queryKeys.ts` (availability key), `apps/web/src/session/markup.ts` (+ `markup.test.ts`), `apps/web/src/session/Conversation.tsx` (label), `playwright.config.ts` (two Playwright projects for `remote.spec.ts`; the existing control web server is reused); read: `apps/web/src/control/runState.ts` | Sol |
| **003-d** remove fork, amend 002 | Drop `ReplyBody.fork` end to end; 002 dated amendments | — | `packages/api/src/control.ts`; `packages/node/src/control/routes.ts`, `routes.test.ts`, `service.ts`, `sdk.ts`, `liveness.ts` (409 texts), `service.test.ts` (T021, T024, T033 fork parts), `liveness.test.ts`; `apps/web/src/control/api.ts` (reply without `fork`), `Composer.tsx` (leftover fork state); `specs/002-session-control/spec.md`, `contracts/control-api.md`, `data-model.md`, `quickstart.md`, `tasks.md` ([amendments.md](amendments.md#002-files)) | Luna |
| Polish | maintainer | — | `specs/README.md` row; manual check ([quickstart](quickstart.md#manual-check-maintainer-with-consent-spends-real-tokens)) | — |

The 003 spec's own dated amendments ([amendments.md](amendments.md#003-spec)) go into the spec commit at approval (workflow step 8), not into a code PR.

### Overlap with 002 Phase 9

002 PRs 6c, 6d and Phase 8 have merged. 002 Phase 9 (`fix/002-phase9`) edits `apps/web/src/control/Composer.tsx` (T107, uses `currentRun` from `runState.ts`), `packages/node/src/control/service.ts` (T108), `tests/e2e/control-server.ts` (T105, gives the fixture a workspace root), `AGENTS.md`'s conventions line (T112), and 002's `research.md`, `spec.md`, `contracts/control-api.md` and `tasks.md`. Order: 003-a may start now. 003-0, 003-b and 003-c start after Phase 9 merges. 003-d's 002 doc amendments go after 002 T104 (status Implemented, T088 ticked). Phase 9 does not touch `api.ts`, `routes.ts`, `receipts.ts`, `config.ts`, `liveness.ts`, `sdk.ts`, `packages/api/src/control.ts`, the no-write and logging tests, `control.test.tsx` or `recovery.test.tsx`.

## Follow-ups

- Strip `peerToken` in 002's passthrough parsers (`packages/node/src/data/status.ts` `readLiveEntries`, `packages/node/src/control/liveness.ts` `liveSchema`). Not part of 003; a separate PR.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
| --------- | ---------- | ------------------------------------ |
| Non-additive API change: `ReplyBody.fork` removed (Principle V: "a non-additive route change MUST be justified") | FR-020 removes fork for terminal-live sessions; US4 scenario 5 refuses `liveness-unknown` with the reason only, so no caller remains. The only client is c9view's web, shipped in the same release; the hub relays bodies unchanged. | Keeping an unused, still-tested fork branch (dead API surface, and a way to fork that the spec rejects); ignoring the field silently (hides errors). |
| Principle I amendment (1.1.0) | Sending into a process c9view did not start makes that process write its transcript. | Not a workaround but a governance step: [R3](research.md#r3-constitution-amendment). |
