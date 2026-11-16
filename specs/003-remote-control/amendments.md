# Amendments proposed by the 003 plan

Exact text for every change 003 makes to files outside its own code. Nothing here is applied by the plan. Each section names the PR that applies it ([plan.md](plan.md#pr-split)). Dates are 2026-11-05.

## 003 spec

_Applied 2026-11-05._

Applied by the lead in the spec commit (workflow step 8) if the maintainer approves the matching decision in [plan.md](plan.md#decisions-for-the-maintainer). Each change keeps the old wording visible only through this note at the top of `## Requirements`:

> _Amended 2026-11-05 by the 003 plan: no hook records the address (research R2); outcomes follow what an outside sender can observe (research R5); Linux only until a macOS re-spike (research R7)._

| Where | Replace | With |
| ----- | ------- | ---- |
| Clarifications, Q2 answer | (keep) | append: "_Superseded 2026-11-05 by the plan (research R2): no hook is needed; the node reads the address from Claude Code's live status file at each check and records nothing. The rest of the answer stands: key files are never opened, and no `peerToken` is kept (spec FR-004 as amended)._" |
| US2 summary | "the delivery outcome (delivered, held by the session, refused, or failed)" | "the delivery outcome (sent, delivered, not seen yet, or failed)" |
| US2 scenario 1 | "**When** a message is delivered, **Then** the UI shows "Delivered: Claude is starting a new turn"" | "**When** the session records the message as a new prompt, **Then** the UI shows "Delivered: Claude is starting a new turn"" |
| US2 scenario 2 | "**When** a message is delivered, **Then** the UI shows "Delivered: Claude sees it at its next step"" | "**When** the session records the message as queued for its next step, **Then** the UI shows "Delivered: Claude sees it at its next step"" |
| US2 scenario 3 | "**Given** the session holds incoming messages, **When** the owner sends, **Then** the UI shows "Held by the session: it will be read when the terminal lets it in" and does not claim that Claude has seen it." | "**Given** the session holds or silently refuses incoming messages, **When** the owner sends, **Then** the UI shows "Sent" and, after a time limit, "Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages", never "Delivered"; if the session's settings say it holds messages, the composer says so before sending. If the message is let in later, the outcome becomes "Delivered" while c9view still tracks it." |
| US2 scenario 4 | "**Given** the session refuses incoming messages or the delivery fails" | "**Given** the session's settings refuse incoming messages, or the delivery fails" |
| US4 scenario 2 | "**Then** sending is unavailable with "This session can't be reached yet" and how to make it reachable." | "**Then** sending is unavailable with "This session can't be reached: it has no messaging address" and the fix (update Claude Code, or turn on cross-session messaging in that session)." |
| Edge case "Held messages" | "c9view shows "held", never "delivered", and does not resend held messages." | "c9view can't see that a message is held; it shows "not seen yet", never "delivered" until the session records it, and never resends. A full queue also shows as "not seen yet"." |
| Edge case "Session started before c9view could learn its address" | whole bullet | "**Session without a messaging address**: the session's live status file names no messaging socket (older Claude Code, or messaging off in that session); sending is unavailable with that reason (User Story 4 scenario 2)." |
| FR-002 | "control off, Claude Code too old (with the minimum version), no known address, token required, inbound refused, liveness unknown, or session not live in a terminal" | "control off, platform not supported, Claude Code too old (with the minimum version), unknown messaging protocol, no messaging address, address not confirmed as the session's own, not an interactive session, token required, inbound refused (by its settings), liveness unknown, or session not live in a terminal" |
| FR-004 | "and is stored only in c9view's state folder with the folder and file permissions of constitution Principle I. c9view's installed hook records **only the address, never the access token**." | "and is never stored: the node reads it from Claude Code's live status file (`sessions/<pid>.json`) at each check and holds it in memory only for that check or send. c9view never opens `*.key` files and never keeps, parses into a field, logs, stores or returns a `peerToken` that appears in a status file." |
| FR-005 | whole requirement | "**FR-005** _(Moot 2026-11-05: no hook records the address; c9view's hooks are unchanged.)_" |
| FR-008 | "Outcomes are: **delivered** … never resent." | "Outcomes are: **sent** (the message was written to the session), then **delivered** (with "new turn" or "next step", from how the session records it in the transcript) or **not seen yet** (no record within a time limit; the session may be busy, holding or refusing it; tracking continues while the receipt lives), and **failed** (with a reason: session ended, address unreachable). Held and refused can't be told apart from outside; c9view never claims either after sending, and a refusal by the session's settings is reported before sending (FR-002). Too large is refused before sending. Writing has a time limit; a write that times out is reported "may have been sent", tracked, and never resent." |
| FR-013 | "recognised from the transcript (or, if the transcript doesn't show it, from the delivery's receipt while it lives)" | "recognised from the transcript by c9view's sender marker; the label says when c9view can't confirm the marker (the sender's verified process is not the current node)" |
| FR-018 | "Nodes on Linux and macOS (and WSL) are supported, as for 002." | "Nodes on Linux (and WSL) are supported. macOS is supported once a spike confirms its socket folder and process start time; until then sending is unavailable there with a reason." |
| Key Entities, Session messaging address | "node-only" | "read from Claude Code's live status file at each check, never stored; node-only" |
| Key Entities, Delivery outcome | "delivered (new turn or next step), held, refused or failed with a reason" | "sent, delivered (new turn or next step), not seen yet, may have been sent, or failed with a reason" |
| SC-002 | "The delivery outcome is visible to the owner within 2 seconds of sending for a reachable session on the same machine." | "For a reachable session on the same machine, "Sent" is visible within 2 seconds of sending, and "Delivered" within 2 seconds of the session recording the message." |
| SC-004 | "(too old, no address, token required, inbound refused, liveness unknown, other user's address, session ended)" | "(too old, no address, address not confirmed, inbound refused by settings, liveness unknown, other user's address, session ended, unsupported platform)" |
| Assumptions, Constitution impact | "Recording each session's messaging address there is a new kind of data, and sending into a terminal process c9view did not start goes beyond … Both changes need a constitution amendment (MINOR)" | "c9view records nothing new (the address is read from the live status file). Sending into a terminal process c9view did not start goes beyond "the Claude Code processes it starts write their own data", so Principle I needs a MINOR amendment" |

## 002 files

Applied in PR **003-d**. Each edit is marked inline with `_(Amended 2026-11-05 by 003.)_`.

### `specs/002-session-control/spec.md`

- **US2 summary**, replace "If the session is open in a terminal, c9view refuses and offers to fork it instead." with: "If the session is open in a terminal, the reply goes into that session through [003](../003-remote-control/spec.md), or is refused with the reason and fix. _(Amended 2026-11-05 by 003.)_"
- **US2 scenario 3**, replace with: "**Given** a live terminal process holds the session, or liveness can't be decided, **When** the owner replies, **Then** c9view never resumes it: a terminal-held session gets 003's remote send or its refusal, and an undecidable one is refused with "liveness unknown" and no fork. _(Amended 2026-11-05 by 003.)_"
- **US2 scenario 4**, replace with: "_(Removed 2026-11-05 by 003: no "Fork and reply".)_"
- **FR-008**, replace "the reply is refused with "live elsewhere" or "liveness unknown"." with "the reply is refused with "live elsewhere" or "liveness unknown"; for a terminal-held session the web offers 003's remote send instead (003 FR-020)."
- **FR-009**, replace with: "**FR-009** _(Removed 2026-11-05 by 003: c9view offers no fork. A terminal-live session gets 003's remote send or its refusal; a session with unknown liveness gets the reason only.)_"
- **FR-021**, replace "with reply, fork, new session," with "with reply, new session," and append "_(Amended 2026-11-05 by 003: fork removed; 003's remote send is also a command.)_"
- **FR-025**, replace "(new, resumed, forked)" with "(new and resumed)".
- **Open questions list**, replace "- "Fork and reply" is offered for live terminal sessions with a one-line explanation (open question 6)." with "- Open question 6 (fork for live terminal sessions) is closed: 003 replaces it with remote send and removes fork. _(Amended 2026-11-05 by 003.)_"

### `specs/002-session-control/contracts/control-api.md`

- Messages row, Success: "202 `CommandReceipt`" (drop "(fork: gains `sessionId` of the fork)"). Errors: "409 `live-elsewhere` (the web uses [003's remote send](../../003-remote-control/contracts/remote-api.md) instead), `liveness-unknown`, …". Body stays `ReplyBody`, now without `fork`. Keep the row's trailing PR column ("6a") unchanged. _(Updated 2026-11-16: the table now has that column.)_ Append under the table: "_Amended 2026-11-05 by 003: no fork; a terminal-held session is reached through `…/remote`._"

### `specs/002-session-control/data-model.md`

- `ReplyBody`: "`text` (1–20,000 chars), `clientRequestId` (uuid). _(`fork` removed 2026-11-05 by 003.)_"

### `specs/002-session-control/quickstart.md`

- Manual step 2, replace with: "Reply to a session open in a terminal: the composer offers "Send to the terminal session" (003); no fork is offered. _(Amended 2026-11-05 by 003.)_"

### `specs/002-session-control/tasks.md`

Ticks stay as they are; these lines gain a note:

- **T020**: append "_(Amended 2026-11-05 by 003: the 409 texts no longer say "fork and reply instead".)_"
- **T021**: replace "fork passes `forkSession` and the receipt gains the new ID; " with nothing, append "_(Fork part removed 2026-11-05 by 003.)_"
- **T024**: replace "; fork;" with ";" and append "_(Fork removed 2026-11-05 by 003.)_"
- **T033**: replace "new, resumed and forked runs" with "new and resumed runs".
- **T042**: replace with "T042 [P] [US2] `control.test.tsx`: a 409 `live-elsewhere` switches the composer to 003's remote send; `liveness-unknown` shows the reason, keeps the text and offers no fork. _(Amended 2026-11-05 by 003; rewritten in 003-c.)_"

`design-notes.md` is a historical draft and is left unchanged.

## Constitution

Applied in PR **003-0** through `/speckit-constitution`. Version 1.0.0 → **1.1.0** (MINOR: materially expanded guidance in Principle I). Last Amended: the merge date.

In Principle I, add a bullet after the "With session control on, creating a project folder…" bullet:

> - With session control on, delivering a message the owner sends to a live interactive Claude Code session of the same OS user on the same machine, through the cross-session messaging socket named in that session's live status file (`sessions/<pid>.json`). c9view MUST check before every delivery that the socket belongs to that live process and user, MUST NOT store the socket path, open `*.key` files, or keep, parse into a field, log, store or return a `peerToken` that appears in a status file, and MUST NOT create, change or remove any socket or file, and writes only the message to the socket.

And change the sentence "Nothing else under `~/.claude` or in a project folder is written by c9view; the Claude Code processes it starts with control on write their own data, in `~/.claude` and in the project folder they run in." to:

> Nothing else under `~/.claude` or in a project folder is written by c9view; the Claude Code processes it starts with control on, and live sessions that receive a message c9view delivers, write their own data, in `~/.claude` and in the project folder they run in.

Sync impact report: `AGENTS.md` and `docs/data-sources.md` updated in the same PR (below); templates unchanged.

## `AGENTS.md` (PR 003-0)

- First paragraph, after "checks whether each session's process is still running;": insert "with session control on it can also send a message into a live terminal session through Claude Code's cross-session messaging (003);".
- Conventions, the bullet that lists what c9view writes (as reworded by 002 T112): append "With control on, c9view may also deliver the owner's message to a live terminal session through the socket named in its `sessions/<pid>.json` (003); it never stores that path, opens `*.key` files, or keeps a `peerToken` from a status file." _(Updated 2026-11-16: 002 T112 rewrites that bullet, so do not anchor on its current wording. 003-0 rebases on 002 Phase 9 first.)_

## `docs/data-sources.md` (PR 003-0)

- Live status file example: add `"procStart": "…"`, `"peerProtocol": 1`, `"peerFeatures": […]`, `"messagingSocketPath": "/run/user/<uid>/cc-socks/<pid>.sock"`, and note `status` seen as `busy`, `idle`, `waiting` (with `waitingFor`).
- After the `*.key` paragraph, add: "003 reads `messagingSocketPath`, `version`, `peerProtocol`, `pid`, `procStart` and `kind` to send a message into a live session; the path is never stored or logged."
- Correct the `*.key` paragraph (it says tokens live only in `<pid>.<hash>.key`): `peerToken` can also appear in some `sessions/<pid>.json` files. c9view never opens `*.key` files, and its discovery parser picks fields explicitly so a `peerToken` in a status file is dropped at parse time and never kept, logged, stored or returned.
- New section **Cross-session messaging (003)**, from [spike.md](../specs/003-remote-control/spike.md): checked 2026-11-05 on Linux with Claude Code 2.1.318 only; **minimum supported version 2.1.318**; the frame c9view sends; no reply on the socket; transcript records (`user` with `origin.kind: "peer"`, `attachment.queued_command`, `queue-operation`); `crossSessionInbound` behaviour (default delivered, `hold` and `refuse` silent to an outside sender); size limit about 1 MB; token not needed on Linux; re-spike on every upgrade ([research R13](../specs/003-remote-control/research.md#r13-re-spike-items)).
