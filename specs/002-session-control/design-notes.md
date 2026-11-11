# Design notes: Session Control

Input for `/speckit-plan` on [spec.md](spec.md). This file keeps the implementation detail that `spec.md` leaves out: the Agent SDK options c9view relies on, the routes and request bodies, size limits, the PR split (6a–6d) with the files each PR owns, contract types, the spike list and the full test lists. The text under "Design draft source text" is copied verbatim from the earlier design draft `session-control.md`, with headings demoted one level, links repointed, and the node state paths changed from `~/.local/state/c9view/node/` to `~/.claude/c9view/node/` per the 2026-11-04 clarifications (`multi-machine.md` → [001-multi-machine](../001-multi-machine/spec.md)). Where it and `spec.md` differ, `spec.md` and its clarifications win.

## Requirement mapping

`spec.md` keeps the design draft's numbers: FR-001 is R1, … FR-024 is R24; R11a (bypass flag) is FR-025. The design draft's acceptance criteria (server tests, web tests, manual end-to-end check) became User Stories 1–8 and SC-001–SC-008; the complete test lists below should become `tasks.md` test tasks.

| Design draft                                                                 | spec.md                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Problem and users                                                            | Context                                                                                                                                |
| Approach (Agent SDK, Claude Code writes its own data, where each part lives) | Context; Assumptions; FR-020; detail below                                                                                             |
| Scope and PRs (6a–6d)                                                        | Story priorities: 6a → Stories 1–3 (server side) and 5; 6b → Stories 2, 3, 5 (web); 6c → Story 4; 6d → Stories 6–7. Files per PR below |
| R1–R24, R11a                                                                 | FR-001–FR-024, FR-025                                                                                                                  |
| Acceptance criteria                                                          | Story acceptance scenarios; SC-001–SC-008; full list below                                                                             |
| Data                                                                         | Key Entities; contract types and spike list below                                                                                      |
| Design reference                                                             | Stories 2–8; detail below                                                                                                              |
| Non-goals and later                                                          | Assumptions (non-goals)                                                                                                                |
| Open questions 1–11                                                          | Assumptions (proposals taken as defaults); top ones in the clarification list                                                          |

Small change in conversion: FR-021 lists trust, new project and label among the retry-safe commands, because their design draft bodies (`TrustBody`, `NewProjectBody`, `LabelBody`) already carry a `clientRequestId`; R21's own list named only reply, fork, new session, decide, interrupt, stop and set-mode.

## Values the plan must carry

- Reply body ≤ 48 KiB encoded (413 above; same as 001's transport limit); composer caps `text` at 20,000 characters.
- Session name ≤ 80 characters; deny message and "Other" answer ≤ 2,000 characters.
- `C9VIEW_CONTROL_MAX_RUNS` (default 3), `C9VIEW_CONTROL_IDLE_MIN` (10), `C9VIEW_CONTROL_APPROVAL_MIN` (30); optional `maxTurns` and `maxBudgetUsd` from env, unset by default.
- Receipts in memory for 10 minutes; clone limit 10 minutes.
- Flags and env: `C9VIEW_CONTROL=1` / `--control`; `C9VIEW_CONTROL_BYPASS=1` / `--bypass`; `C9VIEW_WORKSPACE_ROOTS` (colon-separated) / repeatable `--workspace-root`; `C9VIEW_CLAUDE_BIN` (open question 2).
- Status words in the spec map to HTTP: "not found" 404, "forbidden" 403, "invalid" 400, "conflict" 409 (with `reason`: `live-elsewhere`, `liveness-unknown`, `payload-mismatch`, `unknown-outcome`, `untrusted-folder`, `settings-changed`), "too many" 429, "too large" 413, "accepted" 202, "unavailable" 503; `outside-roots` is a 400 reason.
- New runtime dependency: `@anthropic-ai/claude-agent-sdk` in `packages/node`, loaded only by `control/sdk.ts` with a dynamic `import()` when control is on (justify in the plan; the maintainer owns the lockfile).

## Changes from the design draft after clarification (2026-11-04)

- Open questions 1, 2 and 5 confirmed as proposed, all limits configurable by environment; login with control has no override at all.
- Project create, init and clone allowed as scoped in R23, through a separate hardened git runner (not `createGit`); constitution Principle I covers it.
- Labels (R24) only with control on.
- Node state store moves to `~/.claude/c9view/node/state.db` (001 FR-031).

## Constitution check

The phase-1 check against the first draft of the constitution found conflicts in Principles I, III, IV and V and the technology list. The owner's answers of 2026-11-04 resolved them in the constitution; the current check is in [plan.md](plan.md#constitution-check).

## Design draft source text

### Approach

**c9view runs sessions through the TypeScript Agent SDK** (`@anthropic-ai/claude-agent-sdk`). The SDK starts the Claude Code binary as a child process and speaks its control protocol. It gives c9view:

- `query({ prompt, options })` with `prompt` as an `AsyncIterable<SDKUserMessage>`. This is **streaming input mode**: one long-lived process takes several replies, and `interrupt()`, `setPermissionMode()` and `close()` work.
- `resume: <sessionId>`, plus `forkSession: true` to branch into a new ID and leave the original untouched.
- `sessionId: <uuid>` to choose a new session's ID before it starts.
- `cwd`.
- `settingSources`, which defaults to all of user, project and local, so a web session sees the same settings, hooks, skills, `CLAUDE.md` and allow rules as the terminal.
- `canUseTool(toolName, input, { signal, suggestions })`, which returns `{ behavior: 'allow', updatedInput }` or `{ behavior: 'deny', message }`.
  - It fires only for calls that no rule or mode has approved already.
  - `AskUserQuestion` comes through the same callback: `input.questions[]` holds `question`, `header`, 2–4 `options` with `label` and `description`, and `multiSelect`.
  - The answer goes back as `updatedInput: { questions, answers: { [question]: label | label[] | freeText } }`.
  - The callback may wait indefinitely.
- `abortController`, `env`, `maxTurns`, `maxBudgetUsd` and `pathToClaudeCodeExecutable`.
- The init system message and the result message carry `session_id`. The result message also carries `total_cost_usd`.

**Rejected: spawning `claude -p --input-format stream-json` directly.** It is the same protocol without types, so c9view would re-implement permission prompts, interrupts and message framing that the SDK already maintains.

**Claude Code writes its own data.** The child process writes the transcript, file history, `sessions/<pid>.json` and hook events, exactly as a terminal session does. c9view keeps reading those files through the existing watcher, so the conversation view needs no second rendering path. **c9view itself still writes nothing under the Claude data dir.**

**Where each part lives.** Control follows the three components in [multi-machine.md](../001-multi-machine/design-notes.md#components):

- the **node** (`packages/node`) owns everything that touches `~/.claude`, project folders and processes: the SDK, the run registry, pending requests, liveness and the `ControlService`;
- the **hub** (`apps/hub`) owns everything that touches the browser: login, the Host/Origin check and the control guard (R3). It reaches the node only through `NodeTransport`;
- the **web UI** (`apps/web`) talks only to the hub.

On one machine (`c9view start`) the node runs inside the hub process with an in-process transport, so the same code serves one machine and many.

### Scope and PRs

Four PRs, in order, each with its own branch and worktree (`AGENTS.md`). They start after PRs 6.0a (component split) and 6.0b (machine-scoped API and web) in [multi-machine.md](../001-multi-machine/design-notes.md#scope-and-prs) merge, so the control code is written once, in its final place and machine-aware. 6.0c (response budgets) may run in parallel with 6a and merges before 6b.

All control paths below are relative to `/api/m/:machineId`; the hub relays them to that machine's node.

- **6a, control on the node and its guard on the hub** (Implementation: security-sensitive, multi-file).
  - Owns:
    - `packages/node/src/control/` (new):
      - `config.ts`: flag, limits and the node's startup checks;
      - `sdk.ts`: the only file that imports the SDK, loaded with a dynamic `import()` only when control is on;
      - `runs.ts`: the run registry;
      - `requests.ts`: pending approvals and questions;
      - `receipts.ts`: command reservations and receipts (R21);
      - `trust.ts`: the folder trust check, summary and fingerprint (R22);
      - `state.ts`: the node state store (`state.db`) for trusted folders, later also labels;
      - `liveness.ts`: wraps the live-process check in `packages/node/src/data/status.ts`;
      - `service.ts`: the `ControlService` interface and its implementation (R20);
      - `routes.ts`: the control routes on the node app;
      - colocated tests.
    - `apps/hub/src/control/guard.ts` (new): the mutation guard middleware (R3), and its tests.
    - `packages/api/src/control.ts` (new): contract types. Add an additive export to the barrel.
  - Additive edits:
    - `packages/node/src/app.ts`: mount the control routes when the node's control is on;
    - `packages/node/src/hello.ts`: report the `control` and `bypass` capability states (R1);
    - `apps/hub/src/app.ts`: run the guard on control paths before relaying;
    - `apps/hub/src/main.ts`: refuse auth `none` when any node has control (R2);
    - `apps/hub/src/machines.ts`: include the node's control capabilities in `/api/machines`;
    - `packages/cli/src/`: the `--control` and `--bypass` flags;
    - `packages/node/package.json`: add the SDK dependency. The maintainer installs it and owns the lockfile.
  - Also updates the read-only convention in `AGENTS.md` (see R1) and `docs/deploy.md`.
- **6b, web reply and approvals on the session page**.
  - Owns `apps/web/src/control/` (new):
    - `api.ts`: mutations through 6.0b's machine-scoped API helper, sending the guard header and a `clientRequestId`;
    - `useControl.ts`: runs and requests from `GET …/control/runs`, refreshed by `control.*` events through 6.0b's query-key factories;
    - `Composer.tsx`;
    - `PermissionCard.tsx`;
    - `QuestionCard.tsx`;
    - `RunBar.tsx`: state and Stop (Interrupt is in the composer);
    - `TrustCard.tsx`: the R22 summary and "Trust this folder", shown when a reply or new session gets `untrusted-folder`.
  - Additive edits:
    - mount points in `apps/web/src/session.tsx` and in the phone layout's Chat tab;
    - `control.*` invalidation in `apps/web/src/live/index.tsx`.
- **6c, new session from the project page, with a name**.
  - Owns `apps/web/src/control/NewSessionDialog.tsx`.
  - Adds a "New session" button to the project header in `apps/web/src/project.tsx`.
  - The dialog has an optional session name (R24).
  - Starts after 6b merges. If project page PR 3b is open at the same time, it starts after 3b merges, because both edit `project.tsx`.
- **6d, new or imported projects, and session labels**.
  - Owns `packages/node/src/projects/` (new):
    - `roots.ts`: workspace roots and location checks (R23);
    - `browse.ts`: the folder picker's directory listing;
    - `create.ts`: create a folder, optional `git init`;
    - `clone.ts`: `git clone` with the R23 limits;
    - `routes.ts`, colocated tests.
  - Owns `packages/node/src/labels/` (new): session labels in the node's state store (R24), routes and tests.
  - Owns `apps/web/src/control/NewProjectDialog.tsx`, `apps/web/src/control/FolderPicker.tsx` and `apps/web/src/control/SessionLabel.tsx` (new).
  - Additive edits: a "New project" button on the Overview and the project list; the label in the session header; `AGENTS.md`'s write rule (R23).
  - Starts after 6c merges.

### Requirements

**Enablement and safety**

1. **R1** Control is off by default. It turns on only with `C9VIEW_CONTROL=1` or `c9view start --control`.
   - It is the node's flag. When off, the node doesn't mount the control routes and never imports the SDK, and the hub's guard rejects control paths for that machine.
   - The node reports its control capability as `off`, `ready` or `unavailable` (with a reason) in `hello`. The web reads it per machine from `/api/machines`, never from `/api/health`, and shows no controls unless it is `ready`. The node rechecks its own flag on every call, so a stale capability in the browser authorizes nothing.
   - `AGENTS.md`'s rule becomes: "c9view never writes to `~/.claude`. With control enabled, the Claude Code processes it starts write their own data."
2. **R2** Startup refusals with control on.
   - The hub refuses to start, or to accept a node that reports control, when its auth mode is `none`, on any host including loopback. `C9VIEW_INSECURE_NO_AUTH` does not override this.
   - The node refuses to start with control when any of these holds:
     - the Claude data dir or the projects to run in aren't writable. This is checked with `fs.access(W_OK)`, never with a test write.
     - the Claude Code executable can't be found.

   Each refusal names the fix. On one machine both checks run in the same process at `c9view start`.

3. **R3** Every control request passes the hub's `guard.ts` before it is relayed to a node:
   - it is a `POST` with `Content-Type: application/json`;
   - it carries an `Origin` header from the allowed set, and a missing `Origin` is refused, unlike today's read middleware;
   - it carries the header `X-C9view-Control: 1`, which forces a CORS preflight that c9view never answers;
   - it is authenticated.

   This adds to the existing Host/Origin check and the `SameSite=Strict` session cookie. Any failure returns 403.

4. **R4** Paths never come from the browser, with one exception: a new project's location (R23), which the node checks against its workspace roots.
   - For an existing project, the `cwd` is the project's resolved folder from discovery, which must exist and be a directory.
   - Session and project IDs are looked up in the store; unknown IDs return 404.
5. **R5** Environment and secrets.
   - The child gets `process.env` without `C9VIEW_TOKEN`, `C9VIEW_PASSWORD` or any other `C9VIEW_*` key.
   - c9view never reads, stores or forwards Claude credentials. The child uses whatever login Claude Code already has, or `ANTHROPIC_API_KEY` if it is set.
   - Prompts, tool inputs and answers are never logged. Errors pass through `redactText`.

**Running sessions**

6. **R6** One run per session.
   - The registry holds at most one run per session ID, and at most `C9VIEW_CONTROL_MAX_RUNS` runs in total (default 3).
   - Starting more returns 409 or 429.
   - Runs live in memory only. On shutdown (`SIGINT` or `SIGTERM`), c9view calls `close()` on every run.
7. **R7** Reply (resume).
   - `POST …/projects/:projectId/sessions/:sessionId/messages` with `{ text, clientRequestId }`.
   - The encoded body is at most 48 KiB; the composer also caps `text` at 20,000 characters.
   - The node returns **202 with a receipt** (R21) as soon as it has accepted the reply. It never waits for liveness, spawning or Claude; progress arrives as run state (R18).
   - If c9view already runs this session, the text goes onto that run's input stream. While the run is busy it is queued and shown as queued.
   - Otherwise c9view starts a run with `resume: sessionId` and `cwd` set to the project folder.
8. **R8** Refuse while another process holds the session.
   - Before resuming, `liveness.ts` checks `sessions/*.json` for a process that is alive, has a matching `pidDomain` and isn't c9view's own child. It checks again just before spawning.
   - If such a process holds the session, or its liveness can't be decided (for example in Docker without `--pid=host`), the reply returns 409 with `reason: 'live-elsewhere' | 'liveness-unknown'`.
   - c9view never drives a terminal session's process.
9. **R9** Fork instead. The 409 response offers "Fork and reply": the same call with `{ text, fork: true, clientRequestId }` resumes with `forkSession: true`. The receipt gains the new session ID once the init message arrives, and the UI navigates to it.
10. **R10** New session.
    - `POST …/projects/:projectId/sessions` with `{ text, permissionMode?, clientRequestId }`.
    - The node generates the UUID inside the reservation (R21), passes it as `sessionId`, and returns it in the 202 receipt, so the UI can navigate before the transcript exists. A repeated request returns the same session ID.
    - An optional `name` (at most 80 characters) is passed to Claude Code as `--name` (R24).
    - The session page shows "Starting…" until the transcript appears.
11. **R11** Permission mode.
    - The settings decide the mode by default, as in the terminal.
    - The UI offers `default`, `acceptEdits` and `plan`, at start and on a live run (`setPermissionMode`).
    - The browser can never send `bypassPermissions`; a body that asks for it gets 400.
    - Without the bypass flag (R11a), a run whose settings resolve to `bypassPermissions` starts in `default` instead, so settings can't turn bypass on silently.
    - **R11a** Bypass flag, per machine:
      - Bypass turns on only with `C9VIEW_CONTROL_BYPASS=1` or `--bypass`, on the machine that runs the sessions, and only together with control. In multi-machine mode it is the node's flag, set when the node starts and connects to the hub. The node reports it to the hub, and the hub can't set or change it.
      - With the flag on, every run on that machine inherits it: new sessions, resumes and forks all start with `permissionMode: 'bypassPermissions'`. `setPermissionMode` can't leave bypass, and the mode menu is replaced by a badge.
      - `/api/machines` reports `bypass: true` for that machine (R1). The UI shows a red "Bypass" badge in the run bar, on the session header and on the board cards of runs c9view owns, and a banner in the new-session dialog. The badge never relies on colour alone.
      - Startup prints a warning every time the flag is on. All R2 refusals still apply.
      - `canUseTool` doesn't fire for ordinary tools. `AskUserQuestion` still reaches the question card if the SDK routes it there under bypass (check this in the spike).
12. **R12** Run lifecycle.
    - A run's state is `starting`, then `running` or `waiting` (requests pending), then `idle` (after a result), then `ended` or `failed`.
    - **Interrupt** calls `interrupt()`. **Stop** calls `close()`.
    - An idle run closes after `C9VIEW_CONTROL_IDLE_MIN` minutes (default 10). The next reply resumes it again.
    - Optional per-run `maxTurns` and `maxBudgetUsd` come from env. They are unset by default.

**Approvals and questions**

13. **R13** Pending requests.
    - `canUseTool` stores a pending request with a random single-use `requestId`, emits a `control.request` hint (R18), then waits.
    - The waiting stops when the browser decides, when `signal` aborts, or after `C9VIEW_CONTROL_APPROVAL_MIN` minutes (default 30). A timeout returns `deny` with the message "No answer from the c9view user".
    - The first decision wins. Repeating the same command (same `clientRequestId`) returns its receipt; any other decision on a decided request, including from another tab, gets 409.
14. **R14** Deciding a request. `POST …/control/requests/:requestId` with a `clientRequestId` and:
    - `{ decision: 'allow' }`: the server returns `updatedInput` set to the **server-held original input**. The browser never sends tool input.
    - `{ decision: 'deny', message? }`: the message is at most 2,000 characters.

    There is no "always allow" (`updatedPermissions`) in v1, because it writes `.claude/settings.local.json` (see open questions).

15. **R15** Questions.
    - For `AskUserQuestion`, the browser sends `{ answers: Record<question, string | string[]> }`.
    - The server checks each key against the held questions, and each value against the option labels or a free-text "Other" of at most 2,000 characters.
    - It returns `{ questions, answers }`.
16. **R16** The permission card shows:
    - the tool name and a summary in the style of the existing tool rows (Bash command, Edit file path and diff, and so on), passed through secret hiding;
    - Allow, Deny, and Deny with a message.

    The question card renders options as radio buttons or checkboxes, with "Other". Both cards are keyboard and screen-reader accessible, with 44 px targets below 1024 px.

**Live view**

17. **R17** The conversation stays transcript-driven. The existing watcher, SSE and query invalidation already tail the file Claude Code writes, so new messages appear as they do for terminal sessions.
18. **R18** The SDK stream feeds only the control state, and events are **refresh hints, not data** ([multi-machine.md](../001-multi-machine/spec.md) R7).
    - The node emits `control.run { runId, sessionId, projectId }`, `control.request { requestId, runId, sessionId }` and `control.request.resolved { requestId }`. They carry no card content, tool input or state.
    - The hub wraps each in `{ machineId, … }` from the transport it came through; the node never sends `machineId`.
    - On any `control.*` event, the web refetches `GET …/control/runs`, which returns the current runs (state, cost, error) and pending requests with their redacted cards. That GET is the only source of truth, so a missed or reordered event can only delay an update, never corrupt it.
19. **R19** Cost.
    - The run bar shows no cost; Interrupt lives in the composer's square button.
    - Session and project totals keep coming from the transcript, as today.

**Multi-machine readiness** (so [multi-machine.md](../001-multi-machine/spec.md) needs no control rewrite)

20. **R20** Control is built for the hub and node split from the start.
    - Control routes live under `/api/m/:machineId/`. The key for a run or request is `(machineId, runId)` or `(machineId, requestId)`; IDs are unique per node only.
    - Only the hub sets `machineId`, from the transport a response or event came through, overwriting anything a node sent ([multi-machine.md](../001-multi-machine/spec.md) R5). Node payloads omit it.
    - The node's `routes.ts` calls a `ControlService` interface (`reply`, `start`, `decide`, `interrupt`, `stop`, `setMode`, `snapshot`, `receipt`) and never reaches into `runs.ts` or `requests.ts` directly.
    - `GET …/control/runs` (`ControlService.snapshot`) returns the complete control state.
    - The browser checks live only in the hub's `guard.ts`. The node trusts only its transport (in-process, or a paired WebSocket) and still applies every rule inside the service.
    - Browser ↔ hub stays REST plus SSE. Hub ↔ node goes through `NodeTransport`: in-process on one machine, WebSocket for remote nodes.

**Command receipts**

21. **R21** Every control mutation is safe to retry.
    - The browser sends a `clientRequestId` (UUID) with reply, fork, new session, decide, interrupt, stop and set-mode.
    - Before acting, the node atomically reserves `(operation, clientRequestId)` and stores a fingerprint of the request body. Then it acts and stores a **receipt**: `{ clientRequestId, bootId, operation, status, runId?, sessionId?, error? }`.
    - A repeat with the same fingerprint joins the in-flight action or returns the stored receipt; it never acts twice. A repeat with a different body gets 409 `reason: 'payload-mismatch'`.
    - Receipts live in memory for 10 minutes. `GET …/control/receipts/:clientRequestId` returns one, or 404 once expired.
    - `bootId` is random per node process and is reported in `hello`. A repeat whose receipt is unknown after a restart gets 409 `reason: 'unknown-outcome'`; the node never runs it again.
    - The hub never retries a mutation. If the browser gets no answer (timeout, 503 or a dropped connection), the UI says "This may have been sent", looks up the receipt, and refetches the runs.

**Folder trust, projects and names**

22. **R22** Folder trust.
    - Claude Code skips its workspace trust dialog in non-interactive mode, which is how the SDK runs it. A run would load the folder's `.claude/settings.json` hooks, `.mcp.json` servers, allow rules, plugins and `CLAUDE.md` without asking.
    - So before the first run in a folder, the node checks trust: a folder is trusted if `~/.claude.json` marks it `hasTrustDialogAccepted: true` (read-only), or if the owner trusted it in c9view.
    - An untrusted folder gets 409 `reason: 'untrusted-folder'` with a summary of what it would load: hook commands, MCP servers, allow rules, enabled plugins, and whether `CLAUDE.md` exists, all passed through secret hiding.
    - The UI shows that summary and a "Trust this folder" button. `POST …/projects/trust` with `{ path, fingerprint, clientRequestId }` records trust in the node's own state, never in `~/.claude.json`, so the terminal still asks its own question there.
    - The fingerprint covers the files the summary came from. If they change before the owner confirms, trust gets 409 `reason: 'settings-changed'` and the UI shows the new summary.
    - The check runs again before every new run, so a project whose settings change after trust shows the summary again.
23. **R23** New or imported project.
    - The node is configured with workspace roots (`C9VIEW_WORKSPACE_ROOTS`, absolute paths, or `--workspace-root`, repeatable). Without roots, the "New project" button is hidden and the routes return 404.
    - `POST …/projects` with `{ location, gitUrl?, gitInit?, text, name?, permissionMode?, clientRequestId }`:
      - `location` is typed or picked in the folder picker. The node expands `~`, resolves the real path of its nearest existing parent, and requires the result to be inside a root with no symlink or `..` escape. Anything else gets 400 `reason: 'outside-roots'`.
      - **With `gitUrl`:** the node clones into `location`, which must not exist or must be an empty folder. Only `https://` and `ssh` URLs (`ssh://` or `user@host:path`) are accepted. Git runs with no shell, `GIT_TERMINAL_PROMPT=0`, `protocol.file.allow=never`, `protocol.ext.allow=never`, no submodules, and a 10-minute limit, using the owner's own SSH agent and credential helper.
      - **Without `gitUrl`:** an existing folder is opened as it is. A missing folder is created (only the last segments under a root), with `git init` when `gitInit` is true.
    - The request returns 202 with a receipt (R21) at once; cloning reports progress through the receipt's `status` (`cloning`, `ready`, `failed`) and `control.project` hints.
    - When the folder is ready, the R22 trust check runs. A cloned repo is never trusted automatically. After trust, the first session starts as in R10, and the receipt carries the project ID and session ID. The node computes the project ID from the path the same way Claude Code does, so the UI can open the project before its first transcript exists.
    - The folder picker lists only directories under the roots, a few levels at a time, with hidden folders shown on request.
    - Writing outside `~/.claude`: c9view creates folders and clones only under workspace roots, only with control on, and only on an explicit request. `AGENTS.md` lists this next to the hooks exception.
24. **R24** Session names and labels.
    - **Name at start:** `NewSessionBody` and `POST …/projects` take an optional `name`, passed to Claude Code as `--name` through the SDK's `extraArgs`. Claude Code then shows it in its own `/resume` picker and terminal title.
    - **Label in c9view:** any session, including one open in a terminal, can get a label from its header. The node stores it in its own state store, never in `~/.claude` and never in the index cache (which can be rebuilt). `POST …/projects/:projectId/sessions/:sessionId/label` with `{ label, clientRequestId }`; an empty label removes it. The UI shows the label in place of the title, with "label in c9view" as its tooltip, because Claude Code doesn't show it.
    - **Rename in Claude Code itself** for runs c9view owns is a spike item; it ships only if the spike shows a supported way to do it.

### Acceptance criteria

- **Checks:** the root `lint`, `typecheck`, `test` and `build` pass.
- **Server tests** use a fake `sdk.ts` adapter. CI makes no real Claude calls. They cover:
  - with control off: 404 on control routes, the SDK never imported, and `/api/machines` reports control `off`;
  - startup refusals for each case in R2, including `C9VIEW_INSECURE_NO_AUTH=1` with auth `none`;
  - the guard returns 403 for a missing or foreign `Origin`, a missing `X-C9view-Control`, a non-JSON body and no session;
  - a live terminal process returns 409 `live-elsewhere`, and unknown liveness returns 409 `liveness-unknown`;
  - fork passes `forkSession` and returns the new ID;
  - one run per session, and the run cap;
  - a reply goes onto an existing run's stream instead of starting a second process;
  - a request decides once only, the timeout denies, and an `allow` sends the server-held input even when the body carries a different `input`;
  - answers are validated against labels and the free-text cap;
  - the child env has no `C9VIEW_*` keys;
  - `control.*` events carry only IDs; the hub adds `machineId: 'local'` and overwrites a `machineId` that a fake node sends; the node's routes work against a fake `ControlService`;
  - receipts: a repeated reply, new session or decision with the same `clientRequestId` acts once and returns the same receipt (and the same session ID); a changed body gets 409 `payload-mismatch`; a repeat after a simulated node restart gets 409 `unknown-outcome`; a response lost after the node accepted is recovered by the receipt lookup;
  - a 48 KiB-plus body gets 413, and reply returns 202 before the fake SDK finishes starting;
  - the guard tests run against the hub with an in-process node; a control call that skips the hub (straight to the node app) is not reachable from any listener;
  - bypass: a body asking for `bypassPermissions` gets 400; without the flag, settings that resolve to bypass start the run in `default`; with the flag, new, resumed and forked runs all get `bypassPermissions`, `setPermissionMode` can't leave it, and `/api/machines` reports `bypass: true`;
  - the idle timeout closes the run, and shutdown closes all runs;
  - nothing under the configured Claude dir is written by c9view's own code. The test points the Claude dir at a temporary folder and checks it is unchanged when the fake SDK doesn't write;
  - trust: an untrusted folder gets 409 `untrusted-folder` with a redacted summary; trusting with a stale fingerprint gets `settings-changed`; a folder marked trusted in a fixture `~/.claude.json` starts without asking; `~/.claude.json` is never written;
  - projects: a location outside the roots, a `..` path and a symlink that escapes a root all get `outside-roots`; a clone into a non-empty folder is refused; `file://`, `ext::` and other URL schemes are refused; the fake git is run with no shell and the R23 settings; a clone is never trusted automatically; without roots the routes return 404;
  - names and labels: `name` reaches the fake SDK as `extraArgs.name`; a label survives an index rebuild and never touches the Claude dir.
- **Web tests:**
  - the composer is hidden when control is off;
  - the 409 offers "Fork and reply";
  - the permission and question cards work from the keyboard and send the right bodies;
  - a `control.request` event refetches the runs and shows the card from the GET; after a reconnect the runs are refetched;
  - after a timeout, the UI shows "This may have been sent" and resolves it through the receipt;
  - the new-session dialog navigates to the returned ID, and sends the name;
  - the new-project dialog validates the location, sends the optional git URL, shows clone progress, shows the trust summary and waits for "Trust this folder" before starting;
  - the folder picker works from the keyboard;
  - a label replaces the title and says it is a c9view label.
- **Manual end-to-end check** by the maintainer, with the owner's consent, because it spends real tokens:
  - start a branch server on port 7790 with `C9VIEW_CONTROL=1 C9VIEW_AUTH=token`, in a scratch project folder;
  - start a new session; reply; approve a Bash call; deny one; answer a question; interrupt; stop;
  - try to reply to a session open in a terminal and see the 409; fork it;
  - create a project in a scratch root, and import a small public repo; check the trust summary for a repo with a project hook;
  - check at 1440×900 and 390×844.
  - Never use port 7777.

### Data

- **Session and project lookup:** existing store, `ProjectSummary` path and `SessionSummary`.
- **Liveness:** `sessions/<pid>.json` (`pid`, `sessionId`, `cwd`, `pidDomain`, `entrypoint`) and the alive check in `packages/node/src/data/status.ts` (moved from `apps/server` by PR 6.0a). c9view's own runs are recognised by the session IDs in the registry, and by child PID if the spike shows the SDK exposes it.
- **New contract types in `packages/api/src/control.ts`:**
  - `ControlCapability { state: 'off' | 'ready' | 'unavailable'; bypass; reason? }`
  - `RunState`
  - `RunSummary`
  - `ControlRequest` (permission or question, already redacted)
  - `ReplyBody { text; fork?; clientRequestId }`
  - `NewSessionBody { text; permissionMode?; name?; clientRequestId }`
  - `NewProjectBody { location; gitUrl?; gitInit?; text; name?; permissionMode?; clientRequestId }`
  - `TrustSummary { path; fingerprint; hooks; mcpServers; allowRules; plugins; hasClaudeMd }` (redacted)
  - `TrustBody { path; fingerprint; clientRequestId }`
  - `LabelBody { label; clientRequestId }`
  - `DecisionBody` (with `clientRequestId`)
  - `CommandReceipt { clientRequestId; bootId; operation; status; runId?; sessionId?; error? }`
  - `ControlConflict { error; reason }`
- Node payloads omit `machineId`; the hub adds it in the envelope it returns to the browser (R20).
- **Node state store** (`~/.claude/c9view/node/state.db`, separate from the rebuildable index): trusted folders with their fingerprints, and session labels. Read from `~/.claude.json`: `projects[path].hasTrustDialogAccepted` only.
- **Workspace roots:** `C9VIEW_WORKSPACE_ROOTS` (colon-separated absolute paths) or repeatable `--workspace-root`, set on the node.
- **Check in a 6a spike before building:**
  - With the Claude Code version installed now, does `resume` append to the same `<sessionId>.jsonl`? [data-sources.md](../../docs/data-sources.md) notes that some resumed sessions copy history into a new file. Handle both cases by following `session_id` from the init message.
  - Does an SDK-started child write `sessions/<pid>.json`, and with which `entrypoint`?
  - Do the owner's installed c9view hooks fire for SDK runs?
  - Does the installed SDK need an extra option (such as `allowDangerouslySkipPermissions`) to run `bypassPermissions`, and does `AskUserQuestion` still reach `canUseTool` under bypass?
  - Does `extraArgs: { name }` set the session name, and where does Claude Code store a name (the `sessions/<pid>.json` `name`, a transcript record, or both)? Is there a supported way to rename a session after it starts (R24)?
  - Does the project folder name under `~/.claude/projects/` follow a rule the node can compute from a path (R23)?
  - Record the answers in `data-sources.md`.

### Design reference

- **Session page:**
  - a composer under the conversation, as a sticky footer with a textarea, Send and a permission-mode menu;
  - a run bar above it (state, Stop);
  - pending request cards pinned above the composer only;
  - on phones, the composer stays in the Chat tab.
- **Project header:** a "New session" button opens a dialog with the prompt, an optional name and the permission mode.
- **New project dialog** (from the Overview and the project list):
  - Machine (only with more than one machine), Location (a text field with "Browse…" opening the folder picker), Git URL (optional), "Initialize git" (only without a Git URL, on by default), session name (optional), first prompt, permission mode;
  - while cloning, a progress line from the receipt; on failure, git's error passed through secret hiding;
  - then the trust step: the folder's hooks, MCP servers, allow rules, plugins and `CLAUDE.md`, with "Trust this folder" and "Cancel".
- **Folder picker:** a tree of the workspace roots, one level at a time, with a path field kept in sync.
- **Session header:** the c9view label, editable inline, with "label in c9view" as its tooltip.
- **Session header:** a "Driven by c9view" badge on runs c9view owns.
- **Accessibility:**
  - the kit `Dialog`, `Menu` and `Button`;
  - live-region announcements for new requests and run end;
  - nothing conveyed by colour alone.
- No mock exists. Use the existing tokens and kit components.

### Non-goals and later

- Driving or attaching to a process started in a terminal. Neither the SDK nor Claude Code offers this.
- Docker. It needs:
  - a writable `~/.claude` and project mounts at the **same absolute paths** as the host, because the project folder name is derived from `cwd`;
  - the platform's Claude Code binary;
  - credentials (on macOS these live in the Keychain, so `ANTHROPIC_API_KEY` is needed).

  R2 refuses to enable control with the default read-only mounts.

- "Always allow" rules, editing tool input before approving, plan approval as its own UI (`ExitPlanMode` arrives as a normal permission request), and choosing a model.
- Token-by-token streaming (`includePartialMessages`) and image attachments.
- Keeping runs and pending approvals across a c9view restart. A later version could return the `PreToolUse` hook's `defer` decision so a run can exit and resume.
- Multiple users, and Codex control.
- Editing configs from the web is a separate Step 6 item.
- Deleting, moving or renaming projects; deleting sessions.
- Cloning with submodules, LFS, or a branch other than the default.
- Picking folders outside the workspace roots.

### Open questions

1. **Login on loopback.** Proposal: required whenever control is on, even on 127.0.0.1. Any local process or user could otherwise run code as the owner. (R2)
2. **Which Claude Code binary.** By default the SDK runs the binary it bundles, which may be a different version from the owner's terminal `claude`. Proposal: use `C9VIEW_CLAUDE_BIN`, else the `claude` found on `PATH`, else the bundled one, so terminal and web sessions write the same transcript format. Show the version in health.
3. **Subscription login.** Anthropic's Agent SDK docs say third-party developers may not offer claude.ai login or rate limits in their products without approval. For a tool the owner runs on their own machine with their own Claude Code login, this is a grey area. Proposal: c9view handles no credentials (R5); `docs/deploy.md` states that the user's Claude Code login or `ANTHROPIC_API_KEY` is used; the owner confirms the policy before c9view is published to npm with control.
4. **"Always allow".** It writes `.claude/settings.local.json` in the project. Proposal: leave it out of v1 and revisit after use.
5. **Timeouts and limits.** Proposal: 10 min idle, 30 min per approval, 3 runs at once, no budget cap by default. Are these right?
6. **"Fork and reply" for live terminal sessions.** It leaves the terminal session untouched but creates a second session on the board. Proposal: offer it, with a one-line explanation in the 409 message.
7. **Status from run state.** Runs already show through hooks and `sessions/*.json`. Proposal: no new status source in v1; add a `control` source only if the spike shows gaps.
8. **Bypass permissions.** Resolved: a per-machine flag (R11a). It is set on the node when it starts and connects to the hub, every session run on that node inherits it, and the browser and the hub can't turn it on.
9. **Default workspace roots.** Proposal: none. "New project" stays hidden until the owner sets roots on the node, so c9view never creates folders somewhere unexpected.
10. **"Initialize git" default.** Proposal: on, because most projects are git repos and the Changes tab needs git.
11. **Trust recorded by c9view only.** Proposal: c9view keeps its own trust list and never writes `~/.claude.json`, so trusting in c9view doesn't silently trust the folder for the terminal.
