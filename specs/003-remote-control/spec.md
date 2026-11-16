# Feature Specification: Remote Control of Terminal Sessions

**Feature Branch**: `feat/003-remote-control`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Remote control: from the c9view web UI, send a new message into a Claude Code session that is already running interactively in a terminal on that machine, the way Claude Code's Remote Control lets claude.ai or the app continue a live terminal session. Today 002 refuses such replies with 409 `live-elsewhere` and offers "Fork and reply". The maintainer rejected forking because it duplicates the session. They want to continue the same live session, not a fork, without killing the terminal process."

## Context

[002-session-control](../002-session-control/spec.md) lets the owner reply to a session from the web by resuming it in a process c9view starts. When the session is already open in a terminal, two processes would write the same transcript, so 002 refuses with "live elsewhere" and offers "Fork and reply" (002 FR-008, FR-009). Forking creates a second session, which the maintainer does not want: the owner wants to keep talking to the **same** live session, from a phone or another room, while the terminal keeps running it.

Claude Code itself offers two ways into a live session, and neither fits as is:

- **Remote Control** relays through Anthropic's service to claude.ai and the Claude apps only. It has no third-party interface and no documented local way to find a session's link. It stays out of scope.
- **Cross-session messaging** (Claude Code v2.1.224 and later; Windows v2.1.234) lets one session send a message to another running session on the same machine. Each interactive session listens on its own local address and token. A message arrives between tool calls if Claude is working, or starts a new turn if the session is idle. The receiver is told the message came from another session, not from the user: it cannot approve permissions or change configuration, and slash commands arrive as plain text. Each session decides whether to accept, hold or refuse such messages through its `crossSessionInbound` setting.

This feature uses cross-session messaging as the delivery path: c9view delivers the owner's message into the live terminal session, and the terminal process writes the result to the same transcript that c9view already shows. c9view does not start, stop, take over or write to the terminal process or its files. Three parts of the path are undocumented (the message format after the first line, whether a process that is not a Claude Code session may send, and how to find the address of a session c9view did not start); a spike confirms them before planning (see Assumptions).

**Relation to 002's "Fork and reply".** For a session held by a live terminal process on a machine with control on, this feature replaces 002's "live elsewhere" refusal (the 409 `live-elsewhere` path) with sending to the same session. When 003 cannot deliver (too old, inbound refused, no address, token required, liveness unknown), the owner sees a refusal with reasons and the fix, not a fork offer, and c9view does not queue the message. This feature also **removes** 002's "Fork and reply" for sessions that are live in a terminal: c9view offers no fork anywhere for them, neither in the composer nor as a separate action. A reply either goes into the session through 003 or is refused with the reason and fix (FR-020).

The owner is the single person who runs c9view and the terminal sessions, as in 002.

## Clarifications

### Session 2026-11-05

- Q: When a live session can't receive the message, what should c9view offer? → A: Refuse only, with no fallback. c9view explains why and how to fix it (for example update Claude Code, or allow inbound messages) and keeps the typed text. It offers no "send when free" and no fork from this flow; 002's "Fork and reply" stays where 002 shows it.
- Q: What may c9view's installed hook record about a session's messaging endpoint? → A: The address only, never the token. The hook records only the session's messaging socket path, in c9view's state folder. Sessions that require the token (native Windows, and any platform where the spike shows it is required) are unreachable and refused with a reason. No new secret is stored at rest; the token and Claude Code's per-session key files are never read. _Superseded 2026-11-05 by the plan (research R2): no hook is needed; the node reads the address from Claude Code's live status file at each check and records nothing. The rest of the answer (token never read or stored) stands._
- Q: Does 002's "Fork and reply" stay reachable for a session that is live in a terminal? → A: No, remove it entirely. For a terminal-live session c9view offers no fork anywhere, neither in the composer nor as a separate action. A reply either goes into the session through 003 or is refused with the reason and fix. This changes 002's behaviour (FR-020).
- Q: Which minimum Claude Code version should remote send support? → A: The version the spike verifies end to end, which may be newer than the documented v2.1.224. Below it, c9view refuses with "Update Claude Code to X or newer".

### Session 2026-11-05 (plan review)

- Q: Which minimum Claude Code version should remote send support? → A: 2.1.318, the version the spike verified end to end.
- Q: Should a hook record the session's address? → A: No hook. The node reads the address from Claude Code's live status file at each check and stores nothing.
- Q: How are delivery outcomes reported? → A: By what an outside sender can observe: sent, then delivered (new turn or next step), not seen yet, may have been sent, or failed. "Held" and "refused" are never claimed after sending.
- Q: Which platforms does this feature support? → A: Linux (and WSL) only. macOS waits for a re-spike of its socket folder and process start time.
- Q: What happens to `ReplyBody.fork`? → A: Remove it entirely, including for `liveness-unknown` sessions.
- Q: How is the "Sent from c9view" label worded? → A: Honestly: verified only when the sender's verified process is the current node, otherwise the label says c9view can't confirm it.
- Q: Which constitution change covers delivering into processes c9view did not start? → A: Version 1.1.0 (MINOR, Principle I), in its own PR (003-0) before 003-b, with no state-folder change.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Send a message to a session open in a terminal (Priority: P1)

The owner opens a session that is running in a terminal on one of their machines. Instead of the "live elsewhere" refusal, the composer offers "Send to the terminal session". The owner types a message and sends it; c9view delivers it into that same session, and the terminal process keeps running it. No new session appears on the board.

**Why this priority**: This is the feature: continue the live session without forking or killing it.

**Independent Test**: With control on and a fake terminal session that listens like a Claude Code session, open its page, send a message, and check that the fake session received exactly one message and that no new session or second process was created.

**Acceptance Scenarios**:

1. **Given** control is on and a session is held by a live terminal process that can receive messages, **When** the owner opens it, **Then** the composer offers sending to the terminal session, and neither 002's "live elsewhere" refusal nor "Fork and reply" is shown anywhere for that session.
2. **Given** the owner sends a message, **When** c9view delivers it, **Then** it goes into the same session ID, no new session is created, and the terminal process is neither stopped nor replaced.
3. **Given** the owner sends the same command again (retry after a dropped connection), **When** the node receives it, **Then** the message is delivered at most once and the owner sees the original outcome (002 FR-021).
4. **Given** control is off, **When** the owner views a terminal session, **Then** no send control appears and the send action answers "not found".

---

### User Story 2 - See that it was delivered and what happened (Priority: P1)

After sending, the owner sees the delivery outcome (sent, delivered, not seen yet, or failed) and, once delivered, whether Claude picks it up at its next step in the current turn or starts a new turn. Claude's response then appears in the conversation view as the terminal session continues, with no reload.

**Why this priority**: Without feedback the owner cannot tell whether the message reached the session, and a silent failure would leave them waiting.

**Independent Test**: With the fake session, deliver to an idle session and to a busy one, and make it hold, refuse and drop the connection; check the outcome shown each time and that transcript updates appear live.

**Acceptance Scenarios**:

1. **Given** an idle terminal session, **When** the session records the message as a new prompt, **Then** the UI shows "Delivered: Claude is starting a new turn", and the session's new messages appear in the conversation view as the transcript grows.
2. **Given** a session in the middle of a turn, **When** the session records the message as queued for its next step, **Then** the UI shows "Delivered: Claude sees it at its next step", and the reply appears when the session writes it.
3. **Given** the session holds or silently refuses incoming messages, **When** the owner sends, **Then** the UI shows "Sent" and, after a time limit, "Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages", never "Delivered"; if the session's settings say it holds messages, the composer says so before sending. If the message is let in later, the outcome becomes "Delivered" while c9view still tracks it.
4. **Given** the session's settings refuse incoming messages, or the delivery fails, **When** the owner sends, **Then** the UI says so with the reason, keeps the typed text in the composer, and shows how to fix it (User Story 4); it offers no fallback.
5. **Given** the outcome is lost (connection dropped), **When** the UI recovers, **Then** it says "This may have been sent", looks up the command's receipt and shows the real outcome.

---

### User Story 3 - Clear labelling that the message came through c9view (Priority: P2)

Messages the owner sends this way are marked in c9view's conversation view as "Sent from c9view", distinct from messages typed in the terminal and from replies c9view made through its own runs. The person at the terminal, and Claude, can tell that the message came from c9view on behalf of the owner rather than from another Claude session.

**Why this priority**: The session's history mixes terminal input and remote input; the owner must be able to tell them apart later, and Claude must not mistake the message for another agent's.

**Independent Test**: Send a message to a fake session, then render the resulting transcript and check the label and its accessible name; check the delivered text carries c9view's attribution.

**Acceptance Scenarios**:

1. **Given** a message delivered through c9view, **When** it appears in the conversation view, **Then** it carries a visible "Sent from c9view" label with an accessible name, not colour alone.
2. **Given** a message typed in the terminal, **When** it appears, **Then** it carries no such label.
3. **Given** the receiving session reads the message, **When** Claude sees it, **Then** the message states that it was sent by the session's owner through c9view.

---

### User Story 4 - Clear refusal when the session can't receive (Priority: P2)

Some live sessions can't receive a message: Claude Code is too old, the session refuses inbound messages, its address can't be found, it requires an access token c9view does not hold, or liveness can't be decided. c9view never guesses and never forks silently: it shows why, names the fix (for example "update Claude Code" or "this session refuses messages from other sessions; change `crossSessionInbound` in its settings"), and keeps the typed text. It offers no fallback: no fork and no "send when free".

**Why this priority**: Delivery depends on things c9view does not control; failing clearly is required for the feature to be trusted.

**Independent Test**: Run each refusal case against fixtures (old version, inbound refused, no address recorded, token required, unknown liveness, address owned by another user) and check the reason and the fix text, and that no fork, queue or resume is offered.

**Acceptance Scenarios**:

1. **Given** the session's Claude Code version is below the supported minimum, **When** the owner opens it, **Then** sending is unavailable with "Update Claude Code to X or newer", where X is the supported minimum version.
2. **Given** c9view has no address for the session, **When** the owner opens it, **Then** sending is unavailable with "This session can't be reached: it has no messaging address" and the fix (update Claude Code, or turn on cross-session messaging in that session).
3. **Given** the session refuses inbound messages, **When** the owner sends, **Then** the message is not delivered, the reason and the fix are shown (for example allow inbound messages in that session's settings), the typed text is kept, and no fork or "send when free" is offered, in the composer or as a separate action.
4. **Given** the session requires an access token (native Windows, or any platform the spike shows requires it), **When** the owner opens it, **Then** sending is unavailable with "This session can't be reached: it requires a token c9view doesn't keep", and nothing is read or stored to work around it.
5. **Given** liveness can't be decided (002 "liveness unknown"), **When** the owner opens the session, **Then** neither remote send nor 002's resume is offered as if safe; the reason is shown.
6. **Given** the terminal process exited before the owner sends, **When** c9view sees the session is no longer live, **Then** the composer switches to 002's normal reply (resume), and nothing is sent until the owner sends again.

---

### User Story 5 - Use it from a phone (Priority: P3)

The owner, away from the desk, opens c9view on a phone at 390 px width, finds a session marked as running in a terminal, sends a message, sees the outcome and follows Claude's response, using touch, keyboard or a screen reader.

**Why this priority**: Phone use is the main reason to continue a terminal session remotely, but it reuses the composer and outcomes from Stories 1–4.

**Independent Test**: End-to-end at 390 px: open a fixture terminal session, send, see the outcome announced, see the label.

**Acceptance Scenarios**:

1. **Given** a 390 px viewport, **When** the owner sends a message, **Then** the composer, outcome and refusal reasons fit without horizontal scrolling and their targets are at least 44 px.
2. **Given** a screen reader, **When** the outcome changes, **Then** it is announced once through a live region.
3. **Given** a session that is waiting for a permission decision in its terminal, **When** the owner views it on the phone, **Then** the page says the decision must be made in the terminal.

---

### Edge Cases

- **Idle versus mid-turn**: an idle session starts a new turn; a busy one reads the message between tool calls in the current turn. The outcome text says which (User Story 2). If the session's state changes between check and delivery, the outcome reflects what the session reports, not the earlier guess.
- **Held messages**: a session that holds inbound messages keeps up to 100; past that, delivery fails as "session's message queue is full". c9view can't see that a message is held; it shows "not seen yet", never "delivered" until the session records it, and never resends. A full queue also shows as "not seen yet".
- **Multiple c9view tabs or devices**: each send is its own command; the same command is delivered at most once; two different messages from two tabs are both delivered in the order the node receives them, and every open tab shows both outcomes after its next refresh.
- **Terminal exits mid-send**: if the process ends before delivery completes, the outcome is "not delivered: the terminal session ended"; c9view never resends on its own. If the session is no longer live, 002's normal reply is offered with the text kept.
- **Terminal exits after delivery**: the message counts as delivered; whatever the session wrote before exiting appears in the transcript; nothing is retried.
- **Permission prompts**: if the message leads Claude to a tool that needs approval, the prompt appears in the terminal only. c9view cannot approve it through this path (the receiver treats the sender as another session, which cannot approve). The session page shows the session as waiting for approval (from existing status signals) with "Approve in the terminal".
- **Slash commands**: text starting with `/` is delivered as plain text; the composer warns that slash commands don't run this way.
- **Message size**: the same size limit as a 002 reply; above it, "too large" before anything is sent. The session's own limit (about 1 million characters) is never reached.
- **Session requires an access token**: unreachable and refused with a reason (User Story 4 scenario 4); c9view never reads or stores a token to reach it. This includes native Windows sessions.
- **Session without a messaging address**: the session's live status file names no messaging socket (older Claude Code, or messaging off in that session); sending is unavailable with that reason (User Story 4 scenario 2).
- **Address reused or stale**: an address recorded for a session whose process ended, or that now belongs to a different session or user, is never used; c9view checks that the address belongs to the live process holding that session before every delivery.
- **c9view's own runs**: sessions c9view runs itself (002) keep using 002's reply path; remote send is only for sessions held by a process c9view did not start.
- **Multi-machine**: the session's own node delivers the message locally; the hub only relays the request to that node as for other control actions. A node never delivers to another machine, and nothing about a session's address leaves its node.
- **Node offline**: send is unavailable, as for other control actions (001 FR-023).
- **Containers**: a node in a container without the host's processes can't decide liveness or reach sessions; send is unavailable (as 002 control is).

## Requirements _(mandatory)_

_Amended 2026-11-05 by the 003 plan: no hook records the address (research R2); outcomes follow what an outside sender can observe (research R5); Linux only until a macOS re-spike (research R7)._

### Functional Requirements

**Enablement and safety**

- **FR-001** Remote send is part of session control: it exists only when 002's control flag is on for the machine that holds the session, and inherits every 002 enablement rule: login required on every host with no override (002 FR-002, constitution Principle III), the hub's control guard on every request (002 FR-003), and per-machine capability reporting. With control off, remote send is neither shown nor reachable and answers "not found".
- **FR-002** The machine reports, per session, whether remote send is available and, if not, why: control off, platform not supported, Claude Code too old (with the minimum version), unknown messaging protocol, no messaging address, address not confirmed as the session's own, not an interactive session, token required, inbound refused (by its settings), liveness unknown, or session not live in a terminal. The web shows the send control only when the session's machine reports it available, and the node rechecks every condition on each send, so a stale page authorizes nothing.
- **FR-003** Remote send targets only a session held by a live Claude Code process on the **same machine** and running as the **same operating-system user** as c9view's node, and not one of c9view's own runs. Before every delivery the node confirms that the address it will use belongs to that live process and that user; otherwise it refuses without sending.
- **FR-004** A session's messaging address (a local socket path) is kept on the node only: it never goes to the hub, the browser, live events or receipts, is never logged, and is never stored: the node reads it from Claude Code's live status file (`sessions/<pid>.json`) at each check and holds it in memory only for that check or send. c9view never opens `*.key` files and never keeps, parses into a field, logs, stores or returns a `peerToken` that appears in a status file. A session that requires the token (native Windows, where it is mandatory, and any platform where the spike shows it is required) is unreachable and refused with a reason (FR-002).
- **FR-005** _(Moot 2026-11-05: no hook records the address; c9view's hooks are unchanged.)_
- **FR-006** Message text is never logged, never stored by c9view beyond the in-memory command receipt's fingerprint, and passes through secret hiding wherever c9view shows it back before the transcript has it.

**Sending**

- **FR-007** The owner sends text with a command ID; the node reserves the command, delivers the message, and returns a receipt with the outcome, following 002's command receipt rules (002 FR-021): at most one delivery per command, "payload mismatch" for a changed body, "unknown outcome" after a node restart or expiry. The hub never retries.
- **FR-008** Outcomes are: **sent** (the message was written to the session), then **delivered** (with "new turn" or "next step", from how the session records it in the transcript) or **not seen yet** (no record within a time limit; the session may be busy, holding or refusing it; tracking continues while the receipt lives), and **failed** (with a reason: session ended, address unreachable). Held and refused can't be told apart from outside; c9view never claims either after sending, and a refusal by the session's settings is reported before sending (FR-002). Too large is refused before sending. Writing has a time limit; a write that times out is reported "may have been sent", tracked, and never resent.
- **FR-009** Delivery never waits for Claude's answer: the receipt reports delivery only, and Claude's response is followed through the transcript (FR-012).
- **FR-010** c9view never changes the receiving session's settings, permission mode or `crossSessionInbound` value, never stops, signals or takes over the terminal process, and never writes to the session's transcript or other Claude files. The terminal process writes the result itself.
- **FR-011** The message tells the receiving session that it was sent by the session's owner through c9view (for example a short attribution line), so neither Claude nor the person at the terminal mistakes it for another agent's message. It carries no instruction meant to raise its authority; the receiving session still treats it as coming from another session.

**Live view and labelling**

- **FR-012** The conversation stays transcript-driven: the delivered message and Claude's response appear through c9view's existing file watching and live updates (002 FR-017). Delivery outcomes arrive as refresh hints carrying IDs only (002 FR-018).
- **FR-013** Messages delivered through c9view are labelled "Sent from c9view" in the conversation view with an accessible name, recognised from the transcript by c9view's sender marker; the label says when c9view can't confirm the marker (the sender's verified process is not the current node); terminal-typed messages are not labelled. If the spike shows that delivered messages can't be recognised in the transcript, the label appears only while the receipt lives and the conversation view says so. _(Moot 2026-11-05: the transcript carries the markers.)_
- **FR-014** While the session waits for a permission decision or a question in its terminal, the session page says the decision must be made in the terminal; c9view offers no approve or answer control for terminal-held sessions.

**Refusal (no fallback)**

- **FR-015** When remote send is unavailable or refused (FR-002, FR-008), the UI names the reason and the fix, keeps the typed text, and offers no fallback: no "send when free", no fork, and no resume of a live session. c9view never forks, queues or resumes on the owner's behalf. This refusal replaces 002's fork offer for live terminal sessions (FR-020).
- **FR-016** When the session stops being live, the composer switches to 002's reply (resume), with the text kept; nothing is sent until the owner sends again.

**Versions and platforms**

- **FR-017** Remote send requires the receiving session's Claude Code version to be at least the version the spike verifies end to end, recorded in `docs/data-sources.md`; it may be newer than the documented v2.1.224. The version is taken from the session's live status record; an unknown version is treated as too old. Below the minimum, c9view refuses with "Update Claude Code to X or newer", where X is that version.
- **FR-018** Nodes on Linux (and WSL) are supported. macOS is supported once a spike confirms its socket folder and process start time; until then sending is unavailable there with a reason. Native Windows sessions are out of scope: the token is mandatory there and c9view never stores it (FR-004).

**Change to 002**

- **FR-020** This feature changes 002's behaviour. For a session held by a live terminal process, the web no longer offers "Fork and reply", and the 409 `live-elsewhere` refusal path is replaced by 003's delivery (FR-007) or its refusal with reason and fix (FR-015). No fork control exists for such a session anywhere in the web.

**Multi-machine**

- **FR-019** Remote send is machine-scoped like other control actions (002 FR-020): the hub relays it to the node that holds the session; only that node looks up the address and delivers, locally. Sessions on another machine are reached only through their own node.

### Key Entities _(include if feature involves data)_

- **Remote send availability**: per session on a node: available or not, with a reason (control off, too old, no address, token required, inbound refused, liveness unknown, not live in a terminal).
- **Session messaging address**: the local socket path a live terminal session listens on, tied to its session ID, process and user; read from Claude Code's live status file at each check, never stored; node-only. The access token is not part of it and is never held.
- **Remote message command**: command ID, session, text fingerprint; follows 002's command receipt lifetime.
- **Delivery outcome**: sent, delivered (new turn or next step), not seen yet, may have been sent, or failed with a reason; part of the command receipt.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The owner can send a message to a session open in a terminal and see Claude's response in c9view in the same session, with 0 new sessions created and the terminal process still running, in 100% of runs of the end-to-end check on a supported version.
- **SC-002**: For a reachable session on the same machine, "Sent" is visible within 2 seconds of sending, and "Delivered" within 2 seconds of the session recording the message.
- **SC-003**: In every retry test (repeat, lost response, node restart, two tabs), each command is delivered at most once.
- **SC-004**: 100% of refusal cases (too old, no address, address not confirmed, inbound refused by settings, liveness unknown, other user's address, session ended, unsupported platform) show a reason and a fix, keep the typed text, deliver nothing and offer no fork (in the composer or elsewhere) or queued send.
- **SC-005**: 0 occurrences of a session's address, a `peerToken` from a status file, or message text in c9view's logs, live events, receipts, hub traffic or the browser, and 0 opens of `*.key` files, verified by searching all of them after a test run.
- **SC-006**: Nothing under the Claude data directory or in a project folder is written by c9view's own code during remote send (verified with a temporary Claude data directory), and c9view writes nothing new outside its state folder.
- **SC-007**: 100% of messages sent through c9view carry the "Sent from c9view" label while visible, and 0 terminal-typed messages do.
- **SC-008**: The owner can send, read the outcome and follow the response at 390 px width using only the keyboard or a screen reader.

## Assumptions

- **Delivery path**: Claude Code's cross-session messaging, documented at <https://code.claude.com/docs/en/cross-session-messaging.md> (checked 2026-11-05). Remote Control (claude.ai relay) has no third-party interface; channels need sessions launched with special flags; hooks can't wake an idle session; background sessions accept a new prompt only when started that way. These were considered and rejected for this feature.
- **Spike before planning** (as 002's T002–T003), recorded in `docs/data-sources.md`: the message format after the first authentication line; whether a process that is not a Claude Code session may send; how c9view can learn the address of a session it did not start (hook-exported variables, live status file, `/status`, or not at all); what the sender learns back (delivered, held, refused, new turn or next step); how a delivered message appears in the transcript (needed for FR-013); behaviour when the process exits mid-delivery; whether the token is required on Linux and macOS in practice (any session that requires it is unreachable, FR-004); the oldest Claude Code version that works end to end (FR-017). A "no" on external senders or on address discovery, or a token required everywhere, blocks the feature, and the spec returns to the maintainer.
- **Constitution impact**: Principle I lists what c9view writes in its state folder (node identity, stores and hook events). c9view records nothing new (the address is read from the live status file). Sending into a terminal process c9view did not start goes beyond "the Claude Code processes it starts write their own data", so Principle I needs a MINOR amendment through `/speckit-constitution` before or with the first PR, plus matching edits to `AGENTS.md` and `docs/data-sources.md` (which today says c9view never reads Claude's per-session key files; that stays true). Principle II (no secrets in logs) and Principle V (hook rules) apply unchanged.
- **Amendments to 002** (to be made, dated, in 003's plan; 002's files are not edited by this spec): 002's user story 2 summary and scenarios 3 and 4 (the "live elsewhere" refusal offering "Fork and reply", and the fork scenario), FR-009 (fork instead) and its mentions in FR-021 and elsewhere, the open-question-6 line about offering "Fork and reply" for live terminal sessions, `contracts/control-api.md` (the messages route: fork receipt gaining the fork's `sessionId`, and the 409 `live-elsewhere` row), and task T042 (`control.test.tsx`: a 409 `live-elsewhere`/`liveness-unknown` offers "Fork and reply") together with the fork parts of T021, T024 and the liveness tests T020. In code, `ReplyBody.fork` (`packages/api/src/control.ts`) exists.
- **Open question for the plan**: is `fork` in 002's `ReplyBody` still used by anything else once terminal-live sessions lose it, for example sessions with unknown liveness (`liveness-unknown`), which are not known to be live in a terminal? This spec does not decide it. _Resolved by plan R8: removed entirely._
- **Builds on 002**: control flag, login rule, hub guard, liveness check, command receipts, refresh hints, machine-scoped routes. Depends on 002's PR that ships replies and receipts (6a) and on 001's machine-scoped API.
- **Owner and sessions**: single owner; the terminal sessions are the owner's own, under the same OS user as the node.
- **Inbound setting**: the receiving session's `crossSessionInbound` value (accept, hold, refuse; the default depends on its permission mode) is the owner's to set in Claude Code; c9view reads the settings files it can see and explains the result, but never changes it. _Amended 2026-11-05 by the 003 re-spike: managed-policy and `--settings` sources cannot be read, so the result is advisory; a session in `bypassPermissions` mode holds c9view's messages by default, and c9view warns "may hold" (research R7 step 15). The receiver's mode comes from the session transcript (the last permission-mode record), not from the status file; no record means unknown, which also warns "may hold"._
- **Permission prompts** raised by delivered messages are decided in the terminal; c9view shows only that a decision is pending.
- **Limits**: 002's reply size limit; held-queue cap of 100 and the session's own size limit are Claude Code's.

### Out of scope

- Claude Code's Remote Control relay through claude.ai, and discovering Remote Control links.
- Channels (MCP push into sessions launched with channel flags): a possible later alternative for sessions the owner launches that way.
- Killing, signalling, attaching to or taking over the terminal process, or typing into the terminal.
- Approving permissions or answering questions for terminal-held sessions.
- Changing a session's settings, including `crossSessionInbound`.
- Sending between machines directly, or from one Claude session to another on the owner's behalf.
- Native Windows nodes.
- Attachments and images.
- Any fallback when a live session can't receive: forking (in the composer or as a separate action; 002's "Fork and reply" is removed for terminal-live sessions, FR-020), "send when free" (keeping the message and delivering it through 002's reply after the terminal process exits), or any queueing of undelivered messages.
- Reading, recording or storing a session's access token or key file, and therefore sessions that require the token (including native Windows).
