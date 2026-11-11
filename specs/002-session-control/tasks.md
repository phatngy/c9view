---
description: 'Task list for Session Control'
---

# Tasks: Session Control

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md), [design-notes.md](design-notes.md)

**Tests**: requested — the spec's acceptance scenarios and the design draft's test lists. All server tests use the fake `sdk.ts` adapter (`packages/node/src/control/fake-sdk.ts`); CI makes no real Claude calls.

**Organization**: one phase per PR (the design draft's 6a–6d), each task labelled with the user story it serves. Prerequisite: 001 PRs 6.0a, 6.0b and 6.0d merged; 001's 6.0c merged before 6b.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US8 from spec.md

## PR → tasks

| PR                                          | Phase | Tasks                | Stories                               |
| ------------------------------------------- | ----- | -------------------- | ------------------------------------- |
| 6a control on the node, guard on the hub    | 1–3   | T001–T040, T091–T092 | US1, US2, US3, US4, US5, US8 (server) |
| 6b web reply and approvals                  | 4     | T041–T056            | US2, US3, US5, US8 (web)              |
| 6c new session from the project page        | 5     | T057–T062            | US4 (web)                             |
| 6d new or imported projects, session labels | 6     | T063–T085, T093      | US6, US7                              |
| Polish                                      | 7     | T086–T090            | —                                     |

---

## Phase 1: Setup and spike — PR 6a

- [x] T001 Maintainer: add `@anthropic-ai/claude-agent-sdk` to `packages/node/package.json`, run `corepack pnpm install`, commit the lockfile
- [x] T002 Spike (maintainer, scratch folder, owner's consent for tokens) per [research.md](research.md#r9-spike-items-pr-6a-first-tasks): resume file behaviour, `sessions/<pid>.json` and `entrypoint` for SDK children, hooks firing, bypass options and `AskUserQuestion` under bypass, `extraArgs.name` and rename, project folder name rule, child PID exposure
- [x] T003 Record the spike answers in `docs/data-sources.md`; adjust [research.md](research.md) where an answer changes a decision

## Phase 2: Foundational — PR 6a (blocks every story)

- [x] T004 `packages/api/src/control.ts`: every type in [data-model.md](data-model.md) with its limits ("`text` (1–20,000 chars)", "`name?` (1–80 chars)", "`message?` ≤ 2,000", "Other ≤ 2,000", "`label` (0–80 chars)"); additive export in `packages/api/src/index.ts`
- [x] T005 [P] `packages/node/src/control/config.ts` + `config.test.ts`: Zod-parse every variable in [plan.md](plan.md#settings-and-their-environment-variables) with its default; bypass only with control
- [x] T006 [P] `packages/node/src/control/fake-sdk.ts`: fake adapter (init and result messages, `canUseTool` calls, `interrupt`, `setPermissionMode`, `close`, controllable start delay)
- [x] T007 `packages/node/src/control/sdk.ts`: the only SDK import, dynamic `import()` only when control is on; maps options per [research.md](research.md#r1-agent-sdk); `pathToClaudeCodeExecutable` from T005's binary resolution
- [x] T008 [P] `packages/node/src/control/env.ts`: child env = `process.env` minus the explicit strip list in [research.md](research.md#r11-child-environment) (`C9VIEW_TOKEN`, `C9VIEW_PASSWORD`, the hub Access keys and the rest), with `C9VIEW_STATE_DIR` set to the resolved state folder and, for a non-default `C9VIEW_CLAUDE_DIR`, `CLAUDE_CONFIG_DIR` set to it
- [x] T009 [P] `packages/node/src/control/receipts.ts` + `receipts.test.ts`: reservation by `(operation, clientRequestId)`, fingerprint, join in-flight, stored receipt, 409 `payload-mismatch`, `X-C9view-Boot-Id` mismatch with unknown key → 409 `unknown-outcome`, TTL `C9VIEW_CONTROL_RECEIPT_MIN`; after expiry the `(operation, clientRequestId)` key stays in a boot-long tombstone set capped at `C9VIEW_CONTROL_TOMBSTONE_MAX`; at the cap every new mutation is `unknown-outcome` and control reports `unavailable`
- [x] T010 [P] `packages/node/src/control/state.ts` + test: open `~/.claude/c9view/node/state.db` (state-dir resolver from 001 6.0d; 0700/0600), Drizzle migration for `trusted_folders`
- [x] T011 `packages/node/src/control/service.ts`: `ControlService` interface (`reply`, `start`, `decide`, `interrupt`, `stop`, `setMode`, `trust`, `snapshot`, `receipt`) and implementation skeleton; `routes.ts` calls only this interface
- [x] T012 `packages/node/src/control/routes.ts`: routes per [contracts/control-api.md](contracts/control-api.md) for 6a; `packages/node/src/app.ts` mounts them only when control is on; `packages/node/src/runtime.ts` closes every run on shutdown
- [x] T091 [P] `packages/node/src/control/receipts.test.ts` (fake clock): a repeat with a matching `bootId` after the receipt expired gets 409 `unknown-outcome` and the fake SDK is called once; with `C9VIEW_CONTROL_TOMBSTONE_MAX=3`, the fourth new command gets `unknown-outcome` without acting, control reports `unavailable` with "restart the node to accept new commands", and nothing is ever acted on twice (SC-003)
- [x] T092 [P] `packages/node/src/control/env.test.ts`: the child env has no `C9VIEW_TOKEN`, `C9VIEW_PASSWORD`, `C9VIEW_HUB_ACCESS_CLIENT_ID`, `C9VIEW_HUB_ACCESS_CLIENT_SECRET` or other listed or `*_TOKEN`/`*_SECRET`/`*_PASSWORD`/`*_KEY` `C9VIEW_` keys; it has `C9VIEW_STATE_DIR` equal to the resolved state folder (also when defaulted); with `C9VIEW_CLAUDE_DIR=/tmp/x` it has `CLAUDE_CONFIG_DIR=/tmp/x`, and without it `CLAUDE_CONFIG_DIR` is left as the owner had it

## Phase 3: User Stories 1, 2, 3, 4, 5, 8 (server) — PR 6a

### User Story 1 — control on safely (P1)

- [x] T013 [P] [US1] `packages/node/src/control/routes.test.ts`: control off → 404 on every control route, the SDK module never imported, `/api/machines` reports control `off`
- [x] T014 [P] [US1] `apps/hub/src/control/guard.test.ts` (hub with an in-process node): 403 for missing or foreign `Origin`, missing `X-C9view-Control`, non-JSON body, no session; a control call straight to the node app is not reachable from any listener
- [x] T015 [P] [US1] `apps/hub/src/main.test.ts` and `packages/node/src/control/config.test.ts`: startup refusals — auth `none` with control on any host including loopback, also with `C9VIEW_INSECURE_NO_AUTH=1`; hub refuses a node reporting control under auth `none`; Claude dir or project not writable (`fs.access(W_OK)`, no test write); executable not found; each names the fix
- [x] T016 [US1] `apps/hub/src/control/guard.ts`: mutation guard on control paths before relaying; wire in `apps/hub/src/app.ts`
- [x] T017 [US1] `apps/hub/src/main.ts`: refuse auth `none` when control is on or a node reports it; `packages/node/src/hello.ts` and `apps/hub/src/machines.ts`: control and bypass capabilities with reason
- [x] T018 [US1] `packages/cli/src/start.ts`, `packages/cli/src/main.ts`: `--control`, `--bypass`; startup warning when bypass is on

### User Story 2 — reply (P1)

- [x] T019 [P] [US2] `packages/node/src/control/runs.test.ts`: one run per session, the run cap (409/429), a reply goes onto an existing run's stream instead of a second process, queued while busy, idle timeout closes the run, shutdown closes all
- [x] T020 [P] [US2] `packages/node/src/control/liveness.test.ts`: a live terminal process → 409 `live-elsewhere`; unknown liveness → 409 `liveness-unknown`; checked again just before spawning
- [x] T021 [P] [US2] `packages/node/src/control/service.test.ts`: reply returns 202 before the fake SDK finishes starting; a 48 KiB-plus body → 413; fork passes `forkSession` and the receipt gains the new ID; a repeated reply with the same `clientRequestId` acts once; a response lost after acceptance is recovered through `GET …/control/receipts/:id`; a repeat after a simulated restart → `unknown-outcome`
- [x] T022 [US2] `packages/node/src/control/runs.ts`: registry, input queue, lifecycle states, idle close (`C9VIEW_CONTROL_IDLE_MIN`), optional `maxTurns`/`maxBudgetUsd`
- [x] T023 [US2] `packages/node/src/control/liveness.ts`: wraps `packages/node/src/data/status.ts`; excludes c9view's own runs
- [x] T024 [US2] `ControlService.reply` in `service.ts`: reservation, trust check, liveness, join run or resume with `cwd` = project folder; fork; follow `session_id` from the init message

### User Story 3 — approvals and questions (P1)

- [x] T025 [P] [US3] `packages/node/src/control/requests.test.ts`: decides once only; a second decision from another tab → 409 `decided`; same `clientRequestId` returns the receipt; timeout after `C9VIEW_CONTROL_APPROVAL_MIN` denies with "No answer from the c9view user"; `allow` sends the server-held input even when the body carries a different `input`; answers validated against labels and the 2,000-character "Other" cap; cards redacted
- [x] T026 [US3] `packages/node/src/control/requests.ts`: pending requests from `canUseTool`, single-use `requestId`, signal abort, timeout, permission summary in tool-row style through secret hiding
- [x] T027 [US3] `ControlService.decide`, `interrupt`, `stop`, `snapshot` in `service.ts`
- [x] T028 [US3] Events per [contracts/control-events.md](contracts/control-events.md) from `service.ts`; `packages/node/src/control/events.test.ts`: `control.*` events carry only IDs; the hub adds `machineId: 'local'` and overwrites a `machineId` a fake node sends; node routes work against a fake `ControlService`

### User Story 4 — new session (P2, server)

- [x] T029 [P] [US4] `service.test.ts`: the node generates the UUID inside the reservation and a repeated request returns the same `sessionId`; `name` reaches the fake SDK as `extraArgs.name`; a body asking for `bypassPermissions` → 400
- [x] T030 [US4] `ControlService.start` and `setMode` in `service.ts`: `default`, `acceptEdits`, `plan` only; settings that resolve to bypass start in `default` without the flag

### User Story 5 — folder trust (P2, server)

- [x] T031 [P] [US5] `packages/node/src/control/trust.test.ts`: untrusted folder → 409 `untrusted-folder` with a redacted summary; trusting with a stale fingerprint → `settings-changed`; a folder marked trusted in a fixture `~/.claude.json` starts without asking; `~/.claude.json` never written; the check runs before every new run
- [x] T032 [US5] `packages/node/src/control/trust.ts`: summary and fingerprint per [research.md](research.md#r5-folder-trust); `ControlService.trust` writes `trusted_folders`

### User Story 8 — bypass (P3, server)

- [x] T033 [P] [US8] `service.test.ts`: with the flag, new, resumed and forked runs get `bypassPermissions`, `setPermissionMode` can't leave it (409), `/api/machines` reports `bypass: true`; without it, settings resolving to bypass start in `default`
- [x] T034 [US8] Bypass handling in `service.ts` and `sdk.ts` (spike options), capability in `hello.ts`

### Cross-cutting checks for 6a

- [x] T035 [P] [US1] `packages/node/src/control/no-write.test.ts`: with the Claude dir pointed at a temporary folder and a fake SDK that writes nothing, nothing outside `<claudeDir>/c9view/` changes after every control operation
- [x] T036 [P] [US1] `packages/node/src/control/logging.test.ts`: prompts, tool inputs and answers never appear in logs; errors pass through `redactText`
- [x] T037 [US2] `ControlService.receipt` and the receipt route
- [x] T038 [US1] Run cost in `RunSummary` from `total_cost_usd`
- [x] T039 [US1] `docs/deploy.md`: enabling control, login always required, which Claude login or `ANTHROPIC_API_KEY` is used, binary choice; `AGENTS.md` write rule check
- [x] T040 [US1] Maintainer: run the [quickstart](quickstart.md) control-off, refusal and guard checks against a branch server on port 7790

---

## Phase 4: User Stories 2, 3, 5, 8 (web) — PR 6b

- [x] T041 [P] [US2] `apps/web/src/control/control.test.tsx`: composer hidden when control is not `ready`; Send posts `ReplyBody` with the guard header, `clientRequestId` and `X-C9view-Boot-Id`; queued state shown
- [x] T042 [P] [US2] `control.test.tsx`: a 409 `live-elsewhere`/`liveness-unknown` offers "Fork and reply" and navigates to the fork
- [x] T043 [P] [US2] `control.test.tsx`: after a timeout or 503 the UI shows "This may have been sent" and resolves it through the receipt; `unknown-outcome` says it may or may not have run
- [x] T044 [P] [US3] `control.test.tsx`: permission and question cards work from the keyboard, send the right bodies, and announce new requests in a live region
- [x] T045 [P] [US3] `apps/web/src/live/live.test.tsx`: a `control.request` event refetches runs and shows the card from the GET; after a reconnect the runs are refetched
- [x] T046 [P] [US5] `control.test.tsx`: `untrusted-folder` shows the trust card; "Trust this folder" posts `TrustBody`; `settings-changed` shows the new summary
- [x] T047 [P] [US8] `control.test.tsx`: with bypass the mode menu is a badge; "Bypass" badge has text, not colour alone
- [x] T048 [US2] `apps/web/src/control/api.ts`: mutations through 6.0b's machine-scoped helper with `clientRequestId`, guard and boot headers
- [x] T049 [US2] `apps/web/src/control/useControl.ts`: runs and requests from `GET …/control/runs` with 6.0b's query keys
- [x] T050 [US2] `apps/web/src/control/Composer.tsx`: sticky footer, textarea capped at 20,000 characters, Send, mode menu (`default`, `acceptEdits`, `plan`)
- [x] T051 [US2] `apps/web/src/control/RunBar.tsx`: state, "≈ API-equivalent" cost linked to the billing note, Interrupt, Stop
- [x] T052 [US3] `apps/web/src/control/PermissionCard.tsx` and `QuestionCard.tsx`: tool-row summary, Allow, Deny, Deny with a message (≤ 2,000); radio or checkbox options with "Other"; 44 px targets below 1024 px; pinned above the composer and inline at the tool row
- [x] T053 [US5] `apps/web/src/control/TrustCard.tsx`
- [x] T054 [US8] `apps/web/src/control/BypassBadge.tsx`; badges in the run bar, session header and board cards of c9view-owned runs; "Driven by c9view" badge in `apps/web/src/session/header/`
- [x] T055 [US2] Mount points in `apps/web/src/session.tsx` and the phone Chat tab; `control.*` invalidation in `apps/web/src/live/index.tsx`
- [x] T056 [US2] Maintainer renders at 1440×900 and 390×844, keyboard and screen reader

---

## Phase 5: User Story 4 (web) — PR 6c

- [x] T057 [P] [US4] `apps/web/src/control/NewSessionDialog.test.tsx`: navigates to the returned `sessionId`; sends `name` (≤ 80); "Starting…" until the transcript appears; bypass banner when the machine reports bypass
- [x] T058 [P] [US4] `apps/web/src/kit/Dialog.test.tsx`: focus trap, Escape, labelled title, return focus
- [x] T059 [US4] `apps/web/src/kit/Dialog.tsx` on Base UI Dialog; export from `apps/web/src/kit/index.ts`
- [x] T060 [US4] `apps/web/src/control/NewSessionDialog.tsx`: prompt, optional name, permission mode
- [x] T061 [US4] "New session" button in `apps/web/src/project/header.tsx`, only when control is `ready`
- [x] T062 [US4] "Starting…" state on the session page for a new `sessionId` without a transcript

---

## Phase 6: User Stories 6 and 7 — PR 6d

### User Story 6 — new or imported project (P3)

- [x] T063 [P] [US6] `packages/node/src/projects/roots.test.ts`: a location outside the roots, a `..` path and a symlink that escapes a root → 400 `outside-roots`; `~` expanded; without roots every project route → 404
- [x] T064 [P] [US6] `packages/node/src/projects/git-write.test.ts` with a fake `execFile`: no shell; env whitelist with `GIT_TERMINAL_PROMPT=0`; `protocol.file.allow=never`, `protocol.ext.allow=never`, `core.hooksPath=/dev/null`, `--no-recurse-submodules`, `--template=`; timeout `C9VIEW_CLONE_TIMEOUT_MIN`; env built from scratch with only `PATH`, `HOME`, `LANG`, `SSH_AUTH_SOCK`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https:ssh`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'`; no inherited `GIT_*`; no `core.sshCommand=false`; `--` before the URL and the directory
- [x] T065 [P] [US6] `packages/node/src/projects/clone.test.ts`: `file://`, `ext::`, `git://`, `http://` and local paths → 400 `bad-url`; clone into a non-empty folder → 400 `not-empty`; receipt `cloning` → `ready` / `failed` with redacted git error
- [x] T066 [P] [US6] `packages/node/src/projects/create.test.ts`: an existing folder opens as is; a missing one is created (only the last segments under a root) with `git init` when `gitInit`; a cloned or created folder is never trusted automatically; the project ID matches Claude Code's rule (spike)
- [x] T067 [P] [US6] `packages/node/src/projects/browse.test.ts`: lists only directories under the roots, one level at a time, hidden folders only on request
- [x] T068 [P] [US6] `packages/node/src/projects/routes.test.ts`: every project route → 404 with control off; `createGit` is not used by any writer and `git-write.ts` is the only module that spawns writing git commands (import scan)
- [x] T069 [US6] `packages/node/src/projects/roots.ts`: roots from `C9VIEW_WORKSPACE_ROOTS` and the repeatable `--workspace-root` flag (added to `packages/cli/src/start.ts` and `main.ts`), location resolution per [research.md](research.md#r8-workspace-roots-and-locations)
- [x] T070 [US6] `packages/node/src/projects/git-write.ts`: hardened runner per [research.md](research.md#r7-hardened-git-runner-6d): process, config, environment and credential whitelist; URL check in `packages/node/src/projects/url.ts`
- [x] T071 [US6] `packages/node/src/projects/create.ts` and `clone.ts`
- [x] T072 [US6] `packages/node/src/projects/browse.ts`
- [x] T073 [US6] `packages/node/src/projects/routes.ts`: `GET /workspace/roots`, `GET /workspace/browse`, `POST /projects` through `ControlService` receipts and `control.project` hints; then trust (R22) and first session (FR-010); mount in `packages/node/src/app.ts` only with control on
- [x] T093 [P] [US6] `packages/node/src/projects/url.test.ts`: 400 `bad-url` for whitespace or control characters anywhere, `ssh://-oProxyCommand=x/y`, `-oProxyCommand=x@host:p`, `user@-host:p`, a user or host with characters outside the allowed set, `x:y` without `user@`, `./x:y`, `/x:y`, `C:\\x`, `fd::x`, `file://`, `ext::`, `git://`, `http://`; accepted: `https://host/o/r.git`, `ssh://git@host:22/o/r.git`, `git@host:o/r.git`, bracketed IPv6; the parsed URL is what reaches `git-write.ts`
- [x] T074 [P] [US6] `apps/web/src/control/NewProjectDialog.test.tsx` and `FolderPicker.test.tsx`: validates the location, sends the optional git URL, shows clone progress, shows the trust summary and waits for "Trust this folder" before starting; machine field only with more than one machine; folder picker works from the keyboard
- [x] T075 [US6] `apps/web/src/control/FolderPicker.tsx`: tree of the roots, one level at a time, path field kept in sync
- [x] T076 [US6] `apps/web/src/control/NewProjectDialog.tsx`: Machine, Location with "Browse…", Git URL, "Initialize git" (on by default, only without a URL), session name, first prompt, permission mode; progress line; trust step
- [x] T077 [US6] "New project" button on the Overview (`apps/web/src/overview.tsx`) only, which is where the project list lives (`apps/web/src/project/list.tsx` is a per-project session table); only when control is `ready` and roots exist

### User Story 7 — labels (P3)

- [x] T078 [P] [US7] `packages/node/src/labels/labels.test.ts`: a label survives an index rebuild and never touches the Claude dir outside `c9view/`; empty label removes it; label routes → 404 with control off
- [x] T079 [P] [US7] `apps/web/src/control/SessionLabel.test.tsx`: a label replaces the title with the "label in c9view" tooltip; not shown with control off; inline edit from the keyboard
- [x] T080 [US7] `packages/node/src/control/state.ts`: `session_labels` migration (`label` 1–80)
- [x] T081 [US7] `packages/node/src/labels/labels.ts` and `routes.ts`: `POST …/label`, `GET /labels`, through receipts; mounted only with control on
- [x] T082 [US7] `apps/web/src/control/SessionLabel.tsx` in the session header; label in place of the title on cards and lists
- [x] T083 [US7] Rename in Claude Code itself only if T002 found a supported way; otherwise record it as not supported in [spec.md](spec.md) Assumptions
- [x] T084 [US6] `AGENTS.md`: confirm the write rule covers create, init and clone under roots (already amended); `docs/deploy.md`: workspace roots
- [ ] T085 [US6] Maintainer renders the dialogs at 1440×900 and 390×844

---

## Phase 7: Polish

- [ ] T086 Maintainer's manual end-to-end check per [quickstart.md](quickstart.md#manual-end-to-end-check-maintainer-with-consent-to-use-real-tokens)
- [ ] T087 Owner confirms the Agent SDK login policy before c9view is published to npm with control ([design-notes.md](design-notes.md) open question 3)
- [ ] T088 `specs/README.md`: update the feature's status
- [ ] T089 Run `/speckit-converge` for this feature
- [ ] T090 Revisit "always allow" and a `control` status source after use ([design-notes.md](design-notes.md) open questions 4 and 7), as new specs if wanted

## Dependencies and order

- Phase 1–2 (T001–T012) block every story. Inside 6a, each story's tests come first.
- 6b needs 6a and 001's 6.0c; 6c needs 6b (and project page PR 3b if open); 6d needs 6c.
- 001's 7a and 7b start after 6a merges; 001's 7d uses `apps/web/src/kit/Dialog.tsx` from 6c.

## Parallel examples

- 6a: T005, T006, T008, T009, T010, T091, T092 together; story tests T013–T015, T019–T021, T025, T029, T031, T033, T035, T036 together.
- 6d: T063–T068 together; server T069–T073 ∥ web T074–T077 once T073's contract is fixed; labels T078–T082 in parallel with projects.

## Implementation strategy

MVP is 6a + 6b: reply and approvals from the session page (US1–US3, US5). Then new sessions (6c), then projects and labels (6d).

## Phase 8: Convergence (after 6a–6c; found by `/speckit-converge` on 2026-11-11)

6d (T063–T085, T093) is not part of this pass. T094 and T096 reverse a deliberate maintainer change or choose between amending the spec and the code; the maintainer decides before they are built.

- [ ] T094 Decide and reconcile the run bar's cost and interrupt: restore the "≈ API-equivalent" cost linked to `#api-equivalent-cost` in `apps/web/src/control/RunBar.tsx` (and update `runbar.test.tsx`), or amend FR-019, T051 and the plan to say the run bar shows no cost and Interrupt lives in the composer, per FR-019, T051, Principle VII (contradicts)
- [ ] T095 Build the approval card summary in `packages/node/src/control/requests.ts` from the tool name and fields (command, file path, diff) instead of raw JSON, truncate it to a bounded length, and announce only the tool name in the live region (`Composer.tsx`), per FR-016, T052, Principle VI (partial)
- [ ] T096 Decide and reconcile where a pending approval card shows: render it at the matching tool row (`layout="inline"` in `cards.ts` is unused) or amend FR-016 to say pinned only, per FR-016, T052 (partial)
- [ ] T097 Show a failed run's state and error in the "Starting…" view in `apps/web/src/session.tsx` (read `control.data.runs`), with a test, per US4/AC1, FR-010, T062 (partial)
- [ ] T098 [P] Declare the `newSession` search param with `validateSearch` on the session route in `apps/web/src/router.tsx` and read it typed in `session.tsx`, per T062 (partial)
- [ ] T099 [P] Strip `?newSession=true` with a replace navigation once the transcript loads or the retry cap is reached, with a test, per T062 (partial)
- [ ] T100 [P] Add a "Project default" choice to `NewSessionDialog.tsx` that omits `permissionMode`, so the node falls back to the project's `defaultMode`, per FR-011 (partial)
- [ ] T101 [P] Show the "Driven by c9view" and Bypass badges (`project/board.tsx`, `session.tsx`) only while the run is not `ended` or `failed`, with a test, per FR-025, US8 (partial)
- [ ] T102 Add a control-on Playwright fixture and test: reply composer, an approval card, and the New session dialog from the project header, per Constitution Workflow (UI changes add a Playwright test) (partial)
- [ ] T103 Review the unrequested keyboard-shortcuts popover and "Copy last response" shortcut in `apps/web/src/control/Composer.tsx`: add them to the spec or remove them, per spec scope (unrequested)
