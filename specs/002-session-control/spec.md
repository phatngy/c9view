# Feature Specification: Session Control

**Feature Branch**: `docs/speckit-multi-machine`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Convert the earlier design draft `session-control.md` to a Spec Kit feature: Step 6 session control — reply, start sessions, approve tool calls and answer questions from the web through the Agent SDK running on the node, with the guard on the hub, retry-safe command receipts with a boot identity, events as refresh hints, folder trust, new or imported projects, session names and labels, and a per-node bypass flag. Depends on 001-multi-machine PRs 6.0a and 6.0b."

Source: an earlier design draft, `session-control.md`, written before the project adopted Spec Kit. Requirement IDs keep the draft's numbers: **FR-0NN (was RNN)**; R11a is **FR-025**. Implementation detail (SDK options, routes and bodies, files per PR, data shapes, spike list) is in [design-notes.md](design-notes.md) for `/speckit-plan`.

## Context

c9view shows every Claude Code session but cannot act on one. To reply, approve a tool call, answer a question or start work, the owner has to find the right terminal, which is impossible from a phone or another machine. This feature lets the owner, from the web UI:

1. reply in an existing session, resuming it;
2. start a new session in a known project, or in a new or imported project;
3. approve or deny tool calls, and answer Claude's questions, for sessions that c9view runs;
4. name a session when starting it, and label any session in c9view.

It is for the single owner of the machine, the same person who runs c9view. It is the first feature that changes anything, so it is **opt-in and off by default** (constitution Principle I). Sessions run on the machine that holds the project (the node, [001-multi-machine](../001-multi-machine/spec.md)); the browser-facing guard runs on the hub. Claude Code writes its own transcripts and session files exactly as in a terminal; c9view itself writes nothing under the Claude data directory except its own state folder `~/.claude/c9view/` (001 FR-031), and the conversation view keeps reading the transcript.

## Clarifications

### Session 2026-11-04

- Q: May c9view create project folders, run `git init` and clone repositories, given the constitution's read-only rule? → A: Yes, tightly scoped: only with control on, only under the configured workspace roots, only on an explicit request, never auto-trusted. Clone and init use a separate hardened git runner, not the read-only git helper. The constitution's Principle I allows this one exception.
- Q: Are session labels available when control is off? → A: No; labels exist only when control is on.
- Q: Which Claude Code binary runs sessions? → A: `C9VIEW_CLAUDE_BIN`, else `claude` on PATH, else the binary bundled with the session-running library; the node reports the version it uses.
- Q: Are 10 minutes idle, 30 minutes per approval, 3 runs at once and no budget cap the right defaults? → A: Yes, all configurable by environment.
- Q: Is login required on loopback when control is on? → A: Always, with no override, not even `C9VIEW_INSECURE_NO_AUTH`. The constitution's Principle III matches.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Turn control on safely, and only on purpose (Priority: P1)

The owner starts c9view with control explicitly enabled. Without that flag, nothing in the UI or API can act on a session. With it, c9view refuses to start unless login is on (even on loopback) and the machine can actually run Claude Code, and every action from the browser passes a strict guard.

**Why this priority**: Everything else depends on control being impossible to turn on by accident or to reach from another site.

**Independent Test**: Start with and without the flag and with each refusal condition; send guarded and unguarded requests.

**Acceptance Scenarios**:

1. **Given** control is off, **When** any control action is requested, **Then** it answers "not found", the session-running library is never loaded, and the machine reports control `off`.
2. **Given** control is requested with auth mode `none` on any host, including loopback, **When** c9view starts, **Then** it refuses, even with the insecure no-auth override, and names the fix.
3. **Given** control is requested and the Claude data dir or projects aren't writable, or the Claude Code executable can't be found, **When** the node starts, **Then** it refuses and names the fix.
4. **Given** control is on, **When** a control request arrives with a missing or foreign Origin, without the control header, with a non-JSON body, or without login, **Then** it is refused as forbidden.
5. **Given** control is on, **When** the owner views a session, **Then** controls appear only because that machine reports control `ready`.

---

### User Story 2 - Reply to a session from the web (Priority: P1)

The owner opens a session on any device, types a reply and sends it. c9view resumes the session and the new messages appear in the conversation as they do for terminal sessions. If the session is open in a terminal, c9view refuses and offers to fork it instead.

**Why this priority**: The core user value: act on a session without the terminal.

**Independent Test**: With a fake session runner, reply to an idle session, to a session c9view already runs, and to a session held by a live terminal process.

**Acceptance Scenarios**:

1. **Given** an idle session, **When** the owner sends a reply, **Then** c9view accepts it at once (before Claude starts) with a receipt, and progress then shows as run state.
2. **Given** c9view already runs the session, **When** the owner sends another reply, **Then** it goes into the same run (queued and shown as queued while busy), not a second process.
3. **Given** a live terminal process holds the session, or liveness can't be decided, **When** the owner replies, **Then** c9view refuses with "live elsewhere" or "liveness unknown" and offers "Fork and reply".
4. **Given** the owner picks "Fork and reply", **When** the fork starts, **Then** a new session branches off, the original is untouched, and the UI navigates to the new session.
5. **Given** the owner's connection drops after sending, **When** the UI recovers, **Then** it says "This may have been sent", looks up the command's receipt and shows the real outcome; the reply is never sent twice.

---

### User Story 3 - Approve tool calls and answer questions (Priority: P1)

While c9view runs a session, Claude asks to run a tool that no rule has approved, or asks the owner a multiple-choice question. A card appears on the session page (pinned above the composer and at the tool row) showing what Claude wants to do, with secrets hidden. The owner allows, denies (optionally with a message) or answers.

**Why this priority**: Without approvals, a resumed session stalls at its first unapproved tool.

**Independent Test**: With a fake runner, raise a permission request and a question; decide them from the keyboard; decide twice; let one time out.

**Acceptance Scenarios**:

1. **Given** a pending tool request, **When** the owner allows it, **Then** the tool runs with the input the node holds, even if the browser sent a different input.
2. **Given** a pending request, **When** a second decision arrives from another tab, **Then** the first decision wins and the second is refused as a conflict; repeating the same command returns its receipt.
3. **Given** no decision within the approval timeout, **When** it expires, **Then** the request is denied with "No answer from the c9view user".
4. **Given** a question with options, **When** the owner answers, **Then** each answer must match an option label or a free-text "Other" within its length limit.
5. **Given** a keyboard or screen-reader user on a phone, **When** a card appears, **Then** it is announced, operable from the keyboard, and its targets are at least 44 px below 1024 px wide.

---

### User Story 4 - Start a new session in a project, with a name (Priority: P2)

From a project's page the owner opens "New session", types a prompt, optionally a name and a permission mode, and lands on the new session page, which shows "Starting…" until the transcript appears.

**Why this priority**: Starts new work from anywhere; builds on Stories 2–3.

**Independent Test**: Start a session with a fake runner and check the returned session ID, navigation and name.

**Acceptance Scenarios**:

1. **Given** a known project, **When** the owner starts a session, **Then** the node returns the new session's ID at once and the UI navigates to it; repeating the same command returns the same ID.
2. **Given** a name, **When** the session starts, **Then** Claude Code receives it as the session's name.
3. **Given** the permission menu, **When** the owner picks a mode, **Then** only `default`, `acceptEdits` and `plan` are offered; a request for bypass from the browser is refused as invalid.

---

### User Story 5 - Trust a folder before Claude runs in it (Priority: P2)

Runs started by c9view skip Claude Code's own workspace-trust question. So before the first run in a folder that neither Claude Code nor c9view trusts, c9view shows what the folder would load (hook commands, MCP servers, allow rules, plugins, whether it has a `CLAUDE.md`), with secrets hidden, and starts nothing until the owner chooses "Trust this folder".

**Why this priority**: Prevents a cloned or unfamiliar repo from running its hooks and servers silently.

**Independent Test**: Run in an untrusted fixture folder, trust it, change its settings, and run again.

**Acceptance Scenarios**:

1. **Given** an untrusted folder, **When** a reply or new session targets it, **Then** c9view refuses with "untrusted folder" and a redacted summary.
2. **Given** the folder's settings change after the summary was shown, **When** the owner trusts it, **Then** c9view refuses with "settings changed" and shows the new summary.
3. **Given** a folder Claude Code already trusts, **When** a run starts, **Then** it starts without asking; c9view never changes Claude Code's own trust record.

---

### User Story 6 - Create or import a project (Priority: P3)

From the Overview or the project list, the owner picks or types a location under the machine's configured workspace roots, optionally gives a git URL to clone, then passes the trust step and starts the first session.

**Why this priority**: Useful but the riskiest write; depends on Stories 4–5.

**Independent Test**: With fake git, create and clone into fixture roots, and try every escape.

**Acceptance Scenarios**:

1. **Given** no workspace roots configured, **When** the owner looks for "New project", **Then** it is hidden and the actions answer "not found".
2. **Given** a location outside the roots, a `..` path, or a symlink that escapes a root, **When** the owner submits it, **Then** it is refused as "outside roots".
3. **Given** a git URL, **When** the clone runs, **Then** only `https` and `ssh` URLs are accepted, the target must be missing or empty, progress shows in the dialog, and a cloned repo is never trusted automatically.
4. **Given** the folder is ready and trusted, **When** the first session starts, **Then** the UI can open the project before its first transcript exists.
5. **Given** the folder picker, **When** used from the keyboard, **Then** it lists only directories under the roots, a few levels at a time.

---

### User Story 7 - Label any session (Priority: P3)

With control on, the owner gives any session, even one open in a terminal, a short label from its header. The label replaces the title in c9view, with a tooltip saying it is a c9view label, survives an index rebuild, and never touches Claude data.

**Why this priority**: Organisation aid; independent of running sessions.

**Independent Test**: Set, show, rebuild the index, and clear a label on a fixture session.

**Acceptance Scenarios**:

1. **Given** a session, **When** the owner sets a label, **Then** it replaces the title with "label in c9view" as tooltip; an empty label removes it.
2. **Given** a labelled session, **When** the index is rebuilt, **Then** the label is still there and the Claude data dir outside `~/.claude/c9view/` is unchanged.
3. **Given** control is off, **When** the owner views a session, **Then** no label is shown or editable, and label actions answer "not found".

---

### User Story 8 - Bypass permissions on a machine the owner chooses (Priority: P3)

On a machine the owner fully trusts (for example a sandbox), the owner starts its node with a bypass flag. Every session c9view runs there starts in bypass mode, which the browser and the hub can neither turn on nor off, and every place that shows those runs carries a clear "Bypass" badge.

**Why this priority**: Power-user option; must never become reachable by accident.

**Independent Test**: Start with and without the flag and check run modes, mode changes, badges and reported capabilities.

**Acceptance Scenarios**:

1. **Given** no bypass flag, **When** the project's settings resolve to bypass, **Then** the run starts in `default` instead.
2. **Given** the bypass flag, **When** any new, resumed or forked run starts, **Then** it is in bypass mode, cannot leave it, the mode menu becomes a badge, and the machine reports bypass on.
3. **Given** the bypass flag, **When** c9view starts, **Then** it prints a warning and all startup refusals still apply.

---

### Edge Cases

- A command repeated with the same ID but a different body: refused as "payload mismatch".
- A command repeated after the node restarted (its receipt is gone): "unknown outcome"; the node never runs it again.
- A receipt older than its lifetime: lookup answers "not found".
- The hub gives up waiting (deadline or node offline): the hub never retries a mutation; the UI checks the receipt.
- The machine goes offline with requests pending: they stay on the node and time out there; the hub refuses decisions as unavailable (001 FR-023).
- Too many runs (per session or in total): refused as conflict or "too many".
- An idle run closes after the idle timeout; the next reply resumes it.
- A reply body above the size limit: refused as "too large"; the composer also caps text length.
- Resume writes to a new transcript file instead of appending: c9view follows the session ID Claude reports at start.
- The folder's settings change after trust: the trust check runs again before every new run.
- A clone into a non-empty folder or with a `file://`, `ext::` or other scheme: refused.
- c9view shuts down: every run is closed; runs and pending approvals are not kept across restarts.

## Requirements _(mandatory)_

### Functional Requirements

**Enablement and safety**

- **FR-001 (was R1)** Control is off by default and turns on only with an explicit flag on the machine that runs the sessions (the node). When off, the node exposes no control actions and never loads the session-running library, and the hub's guard rejects control for that machine. The node reports control as `off`, `ready` or `unavailable` (with a reason) per machine; the web reads it per machine and shows no controls unless it is `ready`. The node rechecks its own flag on every call, so a stale capability in the browser authorizes nothing. The project's write rule becomes: "c9view writes under the Claude data directory only to its own state folder `~/.claude/c9view/`. With control enabled, the Claude Code processes it starts write their own data."
- **FR-002 (was R2)** Startup refusals with control on: the hub refuses to start, or to accept a node that reports control, when auth mode is `none`, on any host including loopback, and the insecure no-auth override does not change this. The node refuses to start with control when the Claude data dir or the projects to run in aren't writable (checked without writing), or when the Claude Code executable can't be found. The executable is `C9VIEW_CLAUDE_BIN` if set, else `claude` on PATH, else the binary bundled with the session-running library; the node reports which one and its version (001 FR-028). Each refusal names the fix; on one machine both checks run at start.
- **FR-003 (was R3)** Every control request passes the hub's guard before it reaches a node: it must be a JSON POST, carry an allowed Origin (a missing Origin is refused), carry a custom control header that forces a cross-site preflight c9view never answers, and be authenticated. This adds to the existing Host/Origin check and strict same-site session cookie. Any failure is "forbidden".
- **FR-004 (was R4)** Paths never come from the browser, except a new project's location (FR-023), which the node checks against its workspace roots. For an existing project the working folder is the project's resolved folder, which must exist and be a directory. Session and project IDs are looked up in the node's store; unknown IDs answer "not found".
- **FR-005 (was R5)** Environment and secrets: a started Claude Code process gets the owner's environment without c9view's own secrets (login token and password, hub access credentials and similar); c9view's state-folder setting is passed through so the session's hooks write where c9view reads; and when c9view is pointed at a non-default Claude data directory, the process is pointed at the same one. c9view never reads, stores or forwards Claude credentials; Claude Code uses its own login or an API key the owner set. Prompts, tool inputs and answers are never logged; errors pass through secret hiding.

**Running sessions**

- **FR-006 (was R6)** At most one run per session and at most a configured number of runs in total (default 3, configurable by environment); more are refused as conflict or "too many". Runs live in memory only; on shutdown every run is closed.
- **FR-007 (was R7)** Reply (resume): the owner sends text with a command ID. The body and text are size-limited (values in notes). The node accepts at once with a receipt (FR-021) and never waits for liveness, starting or Claude; progress arrives as run state (FR-018). If c9view already runs the session the text joins that run (queued while busy); otherwise a run resumes the session in the project folder.
- **FR-008 (was R8)** Refuse while another process holds the session: before resuming, and again just before starting, the node checks for a live Claude Code process holding the session that isn't c9view's own. If one holds it, or liveness can't be decided, the reply is refused with "live elsewhere" or "liveness unknown". c9view never drives a terminal session's process.
- **FR-009 (was R9)** Fork instead: the refusal offers "Fork and reply", which resumes into a new branched session and leaves the original untouched. The receipt gains the new session ID once Claude reports it, and the UI navigates to it.
- **FR-010 (was R10)** New session: the owner starts a session in a known project with text, an optional permission mode and a command ID. The node chooses the new session ID inside the command reservation and returns it at once, so the UI can navigate before the transcript exists; a repeated command returns the same ID. An optional name (at most 80 characters) is passed to Claude Code (FR-024). The session page shows "Starting…" until the transcript appears.
- **FR-011 (was R11)** Permission mode: settings decide the mode by default, as in the terminal. The UI offers `default`, `acceptEdits` and `plan`, at start and on a live run. The browser can never request bypass; such a request is invalid. Without the bypass flag (FR-025), a run whose settings resolve to bypass starts in `default`, so settings can't turn bypass on silently.
- **FR-012 (was R12)** Run lifecycle: `starting`, then `running` or `waiting` (requests pending), then `idle` (after a result), then `ended` or `failed`. Interrupt stops the current turn; Stop ends the run. An idle run closes after a configured idle time (default 10 minutes, configurable by environment); the next reply resumes it. Optional per-run turn and budget caps are configurable by environment and unset by default (no budget cap).

**Approvals and questions**

- **FR-013 (was R13)** Pending requests: when Claude asks to use a tool that no rule or mode approved, the node stores a pending request with a random single-use ID, emits a refresh hint, and waits until the owner decides, the run aborts, or a configured approval time passes (default 30 minutes, configurable by environment), which denies with "No answer from the c9view user". The first decision wins; repeating the same command returns its receipt; any other decision on a decided request, including from another tab, is a conflict.
- **FR-014 (was R14)** Deciding: allow uses the **node-held original tool input**; the browser never sends tool input. Deny takes an optional message of at most 2,000 characters. There is no "always allow" in v1 (it would write project settings).
- **FR-015 (was R15)** Questions: the browser sends answers keyed by question; the node checks every key against the held questions and every value against the option labels or a free-text "Other" of at most 2,000 characters.
- **FR-016 (was R16)** The permission card shows the tool name and a summary in the style of the existing tool rows (command, file path and diff, …), with secrets hidden, and offers Allow, Deny, and Deny with a message. The question card shows options as radio buttons or checkboxes with "Other". Both are keyboard and screen-reader accessible, with 44 px targets below 1024 px.

**Live view**

- **FR-017 (was R17)** The conversation stays transcript-driven: new messages appear through the existing file watching and live updates, exactly as for terminal sessions.
- **FR-018 (was R18)** Run events are refresh hints, not data (001 FR-007): the node emits run, request and request-resolved hints carrying only IDs (no card content, tool input or state); the hub wraps each with its machine. On any control hint the web refetches the control state, which returns current runs (state, cost, error) and pending requests with their redacted cards; that read is the only source of truth.
- **FR-019 (was R19)** Cost: the run bar shows the run's cost labelled "≈ API-equivalent" and linked to the billing note. Session and project totals keep coming from the transcript.

**Multi-machine readiness**

- **FR-020 (was R20)** Control is built for the hub and node split from the start: control actions are machine-scoped; runs and requests are keyed by (machine, ID) because IDs are unique per node only; only the hub assigns machine identity (001 FR-005); the node's routes call one control-service interface (reply, start, decide, interrupt, stop, set mode, snapshot, receipt) and never reach into run or request storage directly; the control-state read returns the complete control state; browser checks live only in the hub's guard, and the node trusts only its channel and still applies every rule; browser ↔ hub stays request/response plus live stream, hub ↔ node goes through the node channel.

**Command receipts**

- **FR-021 (was R21)** Every control mutation is safe to retry. The browser sends a unique command ID with reply, fork, new session, decide, interrupt, stop, set mode, trust, new project and label. Before acting the node atomically reserves (operation, command ID) and stores a fingerprint of the body, then acts and stores a receipt (command ID, boot identity, operation, status, run and session IDs, error). A repeat with the same fingerprint joins the in-flight action or returns the stored receipt and never acts twice; a different body is a "payload mismatch" conflict. Receipts live in memory for 10 minutes and can be looked up by command ID until then. After a receipt expires, the node still remembers for the rest of its boot that the command ID was used (for that operation), so a late repeat is an "unknown outcome" conflict and never acts again; this memory is capped (default 100,000 IDs per boot), nothing is ever forgotten before a restart, and once the cap is reached the node can no longer prove a command is new, so it answers every new command "unknown outcome" without acting and reports control `unavailable` with "restart the node to accept new commands". A command never acts twice. The boot identity is random per node process and reported in the greeting; a repeat whose receipt is unknown after a restart is an "unknown outcome" conflict, never run again. The hub never retries a mutation; when the browser gets no answer it says "This may have been sent", looks up the receipt and refetches the runs.

**Folder trust, projects and names**

- **FR-022 (was R22)** Folder trust: before the first run in a folder, the node checks trust — trusted if Claude Code's own trust record (read only) marks it, or if the owner trusted it in c9view. An untrusted folder is refused as "untrusted folder" with a redacted summary of what it would load (hook commands, MCP servers, allow rules, enabled plugins, `CLAUDE.md` present). "Trust this folder" records trust in the node state store under `~/.claude/c9view/node/`, never in Claude Code's record, so the terminal still asks its own question. The trust carries a fingerprint of the files the summary came from; if they change before the owner confirms, trust is refused as "settings changed" and the new summary is shown. The check runs before every new run.
- **FR-023 (was R23)** New or imported project: the node is configured with workspace roots; without roots, "New project" is hidden and its actions answer "not found". The location (typed or picked) must resolve inside a root with no symlink or `..` escape, else "outside roots". Creating folders, `git init` and `git clone` happen only with control on, only under the workspace roots, only on an explicit request, and through a separate hardened git runner; every other git use stays read-only. With a git URL, the node clones into a missing or empty location, accepting only `https` and `ssh` URLs, with no prompts, no local or external protocols, no submodules, a 10-minute limit, and the owner's own SSH agent and credentials. Without a URL, an existing folder is opened as is; a missing one is created (only the last segments under a root), with `git init` when asked. The request is accepted at once with a receipt whose status reports cloning, ready or failed. When ready, the trust check runs; a clone is never trusted automatically. After trust the first session starts as in FR-010, and the receipt carries the project and session IDs; the node computes the project ID the same way Claude Code does. The folder picker lists only directories under the roots, a few levels at a time, hidden folders on request. This is the only write c9view makes to a project working folder; constitution Principle I and `AGENTS.md` list it as an exception.
- **FR-024 (was R24)** Session names and labels: a new session (FR-010, FR-023) can take a name that Claude Code shows in its own resume picker and terminal title. When control is on, any session, including one open in a terminal, can get a c9view label from its header, stored in the node state store under `~/.claude/c9view/node/` (never in Claude data, never in the rebuildable index). With control off, labels are neither shown nor editable and their actions answer "not found"; an empty label removes it; the UI shows the label in place of the title with "label in c9view" as tooltip. Renaming a session in Claude Code itself ships only if the spike shows a supported way.
- **FR-025 (was R11a)** Bypass flag, per machine: bypass turns on only with an explicit flag on the machine that runs the sessions, and only together with control; in multi-machine mode it is the node's flag, set at start and reported to the hub, which can't set or change it. With it on, every run on that machine (new, resumed, forked) starts in bypass mode, cannot leave it, and the mode menu becomes a badge. The machine reports bypass on; the UI shows a red "Bypass" badge (never colour alone) in the run bar, session header and board cards of runs c9view owns, and a banner in the new-session dialog. Startup warns every time; all FR-002 refusals still apply. Ordinary tools then need no approval; whether questions still reach the question card under bypass is a spike item.

### Key Entities _(include if feature involves data)_

- **Control capability**: per machine; state `off`, `ready` or `unavailable` with a reason; bypass on or off.
- **Run**: one c9view-owned Claude Code process for one session on one node; state, cost, error; keyed by (machine, run ID); memory only.
- **Control request**: a pending permission or question for a run; single-use ID; redacted card; node-held original input; keyed by (machine, request ID).
- **Command receipt**: command ID, boot identity, operation, status, run and session IDs, error; kept 10 minutes in memory.
- **Trust record**: folder path and fingerprint, in the node state store (`~/.claude/c9view/node/`).
- **Trust summary**: the redacted list of what a folder would load.
- **Workspace root**: an absolute folder on the node under which projects may be created or cloned.
- **Session label**: c9view-only label per session, in the node state store; only with control on.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With control off, 0 control actions succeed and no session-running code is loaded.
- **SC-002**: A reply is acknowledged before Claude starts, and its messages appear in the conversation view with no manual reload.
- **SC-003**: In every retry test (repeat, lost response, restart), each command acts at most once and the owner sees its real outcome or "unknown outcome".
- **SC-004**: An allowed tool always runs with the node-held input; 0 cases where browser-sent input reaches the tool.
- **SC-005**: Nothing under the Claude data directory outside `~/.claude/c9view/` is written by c9view's own code, apart from the separately run hooks installer (verified with a temporary Claude dir).
- **SC-006**: 100% of runs in a folder that neither Claude Code nor the owner trusted are blocked until the owner confirms the current summary.
- **SC-007**: 100% of location escapes (outside root, `..`, escaping symlink) and disallowed clone URLs are refused.
- **SC-008**: The owner can reply, approve, deny and answer from a 390 px phone using only the keyboard or a screen reader.

## Assumptions

- Single owner of the machine; multiple users and Codex control are out of scope.
- Sessions run through the Agent SDK in the node (rejected: driving the Claude CLI's stream protocol directly, which would re-implement prompts, interrupts and framing).
- Login is required whenever control is on, even on loopback, with no override ([design-notes.md](design-notes.md) open question 1; confirmed 2026-11-04; FR-002).
- Claude Code binary: `C9VIEW_CLAUDE_BIN`, else `claude` on PATH, else the SDK's bundled one, so web and terminal sessions write the same format; the node reports the version (open question 2; confirmed 2026-11-04).
- c9view handles no credentials; the deploy docs say which login is used; the owner confirms the Agent SDK login policy before c9view is published to npm with control (open question 3, proposed).
- No "always allow" in v1 (open question 4).
- Timeouts and limits: 10 minutes idle, 30 minutes per approval, 3 runs at once, no budget cap, all configurable by environment (open question 5; confirmed 2026-11-04).
- "Fork and reply" is offered for live terminal sessions with a one-line explanation (open question 6).
- No new status source from run state in v1; add one only if the spike shows gaps (open question 7).
- Bypass is a per-machine node flag (open question 8, resolved: FR-025).
- No default workspace roots: "New project" stays hidden until the owner sets roots (open question 9).
- "Initialize git" defaults on (open question 10).
- Trust is recorded by c9view only, never in Claude Code's file (open question 11).
- Renaming a session inside Claude Code is not supported: the spike found only `renameSession()`, which writes a `custom-title` entry into the transcript from c9view's process, and c9view does not write Claude data. Names are set only when a session starts (FR-010, FR-024); later naming is a c9view label.
- A spike in the first PR answers: resume file behaviour, whether SDK runs write session files and with which entry point, whether installed hooks fire, what bypass needs and whether questions reach the card under bypass, how names are set and stored and whether rename is possible, and how project folder names are derived (list in notes); answers go to `docs/data-sources.md`.
- Depends on 001-multi-machine PRs 6.0a and 6.0b (component split and machine-scoped API); 001's 6.0c may run in parallel with the first PR here and merges before the second.
- Non-goals: driving a terminal-started process; Docker for control; "always allow", editing tool input, plan approval UI, model choice; token streaming and image attachments; keeping runs across restarts; editing configs (separate item); deleting, moving or renaming projects or deleting sessions; clones with submodules, LFS or a non-default branch; picking folders outside the roots.
