# Feature Specification: Baseline: c9view as shipped

**Feature Branch**: `chore/public-release` (as-built record; no feature branch)

**Created**: 2026-11-04

**Status**: Shipped

**Input**: User description: "Baseline: c9view as shipped. Record everything c9view already ships (plan Steps 0, 1, 2, 3, 3b, the UI improvements, 4, 4b and 5) as one as-built Spec Kit feature, replacing the former archived specs (overview-and-project, ui-polish, follow-ups-4b, typography), the shipped parts of the former product plan and the ticked items of the former checklist."

Requirement IDs of the archived specs stay traceable: **FR-0NN (was ui-polish R3)** means the requirement was R3 of the former archived ui-polish spec. “Step N” tags refer to the steps table in [specs/README.md](../README.md#steps). Requirements from the former product plan say **(was PLAN §N)**; former checklist tags now say **(Step N)**. The code is the ground truth; where the old docs disagreed with the code, this spec follows the code and [research.md](research.md#doc-discrepancies-found) lists the differences. Reference material: [docs/data-sources.md](../../docs/data-sources.md) (Claude Code file formats), [docs/deploy.md](../../docs/deploy.md) (running and tunnels), [docs/research.md](../../docs/research.md) (review of existing viewers and monitors).

## Context

c9view is a local web dashboard for Claude Code data in `~/.claude` (or `C9VIEW_CLAUDE_DIR`), project folders and files, process status, and token prices. It reads transcripts, live session files, settings, file-history backups, stats, history, skills, agents, commands, plugins and memory; `~/.claude.json` is read-only and supplies MCP configuration. Projects come from transcript `cwd` values and `C9VIEW_WORKSPACE_ROOTS`; c9view reads project `.claude/` settings, `CLAUDE.md` and `@includes`, `.mcp.json`, browser-visible files, and git status and diffs. It shows every project and session on one machine on an automatic four-column board (In progress, Need input, In review, Inactive), a chat-style conversation view with inline diffs, a project file browser and git changes view, token and cost analytics, the effective Claude Code configuration, search across all conversations, and session export. It runs as one process (`c9view start`, port 7777) or as a Docker image, listens on `127.0.0.1` by default, and has an optional login for tunnels.

This baseline covers what exists on `main` today: a pnpm workspace with `packages/core`, `packages/api`, `packages/cli`, `apps/server` and `apps/web`. The next features ([001-multi-machine](../001-multi-machine/spec.md) and [002-session-control](../002-session-control/spec.md)) build on it; 001 renames `apps/server` to `apps/hub` and adds `packages/node`. This spec describes the single-machine, read-only product, so everything below it is a stable reference for those features and for `/speckit-converge`.

The user is the sole user of the machine, reading their own Claude Code work, often on a phone through a tunnel.

## Clarifications

None. This is an as-built record: every decision was resolved from the code and the archived docs. No decision is left for the user; see [Open questions](#open-questions).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - c9view reads and indexes Claude data reliably (Priority: P1)

The user starts c9view on a machine with years of Claude Code history. c9view discovers every project and session, reads transcripts without loading them whole, keeps a rebuildable SQLite index, and updates it as Claude Code writes new data, without ever writing to the Claude data directory.

**Why this priority**: Every other screen reads from this layer. If parsing is not tolerant or reading is slow, nothing else is usable.

**Independent Test**: Run `c9view scan --json` against `tests/fixtures/claude` and check the counts; append a line to a fixture transcript and check the index updates without a full rescan; delete the index file and check it rebuilds identically.

**Acceptance Scenarios**:

1. **Given** a Claude data directory with projects, sessions, subagent transcripts and `stats-cache.json`, **When** `c9view scan --json` runs, **Then** it prints counts of projects, sessions, messages, token totals and unknown record types.
2. **Given** a transcript containing an unknown record type or a malformed line, **When** it is read, **Then** the line is counted and skipped, and the rest of the file is read.
3. **Given** an indexed transcript, **When** Claude Code appends records, **Then** only the new bytes are read and the session's summary, messages and usage update within a few seconds.
4. **Given** a deleted or corrupt index file, **When** c9view starts, **Then** the index is rebuilt from the files and no file data is lost.
5. **Given** the same cwd appears with several values in one project folder, **When** the project path is resolved, **Then** the most common cwd whose Claude encoding equals the folder name wins, then the most common cwd, then the filesystem and decoded paths.

---

### User Story 2 - A status board shows which sessions need me (Priority: P1)

The user opens a project and sees its sessions in four columns, ordered by urgency, each card saying why it is in that column and how sure c9view is. The board stays current without a page reload.

**Why this priority**: This is the product's core promise: see at a glance which Claude session is waiting on you.

**Independent Test**: Feed fixture sessions with hook events, live status files and transcripts for each rule, and check the column, reason, confidence and stale flag; open the board and change a fixture to see the card move through live updates.

**Acceptance Scenarios**:

1. **Given** a running process with live status `busy`, **When** the board loads, **Then** the session is In progress with a reason such as "live status: busy".
2. **Given** a `Notification` or `PermissionRequest` hook event newer than other evidence, **When** the status is decided, **Then** the session is Need input with reason "hook: ..." and the age in seconds.
3. **Given** a session whose last assistant message has an unanswered tool call, **When** no newer hook event exists, **Then** it is Need input with reason "waiting on tool call: <name>".
4. **Given** a `Stop` hook event and an idle live process, **When** the status is decided, **Then** the session is In review.
5. **Given** no running process and no recent hook event, or a `SessionEnd` event, **When** the status is decided, **Then** the session is Inactive.
6. **Given** hook and live status disagree, or active evidence is older than 10 minutes, **When** the status is decided, **Then** confidence is lowered and the card is marked stale.
7. **Given** the user runs `c9view hooks install`, **When** the command runs, **Then** it prints the exact diff to Claude's `settings.json`, backs the file up, and writes only after confirmation (or `--yes`).

---

### User Story 3 - I can read any conversation, however long (Priority: P1)

The user opens a session and reads it chat-style: prompts, answers, thinking, tool calls with their results, subagent work, token use and context fill. The page opens at the newest message and loads older pages as the user scrolls up, even for sessions with 10,000+ messages.

**Why this priority**: Reading what Claude did is the main reason to open a session after the board.

**Independent Test**: Open a fixture session with 1,000+ generated messages: the page opens at the end, scrolling up loads earlier pages, the outline and in-session search jump to messages in unloaded pages, and no text is hidden without a way to expand it.

**Acceptance Scenarios**:

1. **Given** a long session, **When** the page opens, **Then** `GET .../sessions/:sid?from=end` returns the newest page and the view is at the newest message.
2. **Given** the user scrolls to the top of the loaded messages, **When** an earlier page exists, **Then** it loads and the scroll position is kept.
3. **Given** a tool result longer than the collapse threshold, **When** it is shown, **Then** it is collapsed with a control that expands the full text.
4. **Given** a Task tool call with a subagent transcript, **When** the user expands it, **Then** the subagent's conversation is shown.
5. **Given** an `AskUserQuestion` answer whose option labels contain ", ", **When** it is rendered, **Then** each chosen option is highlighted by exact match.
6. **Given** a phone-width screen, **When** the session opens, **Then** a Chat / Outline / Files / Usage tab bar replaces the right rail.

---

### User Story 4 - I can see what Claude changed in my files (Priority: P2)

The user sees an inline diff under every Edit, MultiEdit and Write call, a "Files changed" panel with net diffs for the whole session, and a read-only project file browser and git Changes tab, without any risk of leaking secrets or writing to the project.

**Why this priority**: Reviewing changes is the second most common reason to open a session, but it builds on the conversation view.

**Independent Test**: Use fixture transcripts with `toolUseResult` patches and `file-history` backups to check diffs and counts; run the traversal, symlink, denied-file, secret, huge-file and binary tests against the file API; check that git never writes to `.git`.

**Acceptance Scenarios**:

1. **Given** an Edit result with a `structuredPatch`, **When** the message is shown, **Then** the diff has real line numbers; without a patch it is computed from `old_string` and `new_string`.
2. **Given** a Write over an existing file, **When** it is shown, **Then** it is a real diff against `originalFile`, not "everything added".
3. **Given** `file-history` backups, **When** the Files changed panel loads, **Then** each file shows +/- counts and the net diff from the first backup to the last version.
4. **Given** a request for `../` or a symlink that leaves the project, a `.env` file, or a key file, **When** the file API is called, **Then** it refuses.
5. **Given** a file over 1 MB or a binary file, **When** it is requested, **Then** only its size and type are returned.
6. **Given** a project working folder that is a git repository, **When** the Changes tab loads, **Then** the working tree is shown against `HEAD` and git ran with no shell, a timeout and no optional locks.

---

### User Story 5 - I can see what my usage costs (Priority: P2)

The user sees tokens and API-equivalent cost per day, per model and per project, with a cache-hit ratio, on the Overview, a project's Usage tab and the session page, and always understands that the cost is an estimate.

**Why this priority**: Cost is the second question after status, but nothing blocks on it.

**Independent Test**: Index fixtures with known token counts and prices and compare `GET /api/usage` totals; check every cost figure carries the "≈" and "API-equivalent" label.

**Acceptance Scenarios**:

1. **Given** a date range up to 366 days, **When** `/api/usage` is called, **Then** it returns daily, per-model and per-project totals and a daily cache-hit ratio in the requested time zone.
2. **Given** a model missing from the price table, **When** cost is computed, **Then** the override file is consulted and an unknown model costs 0 without failing.
3. **Given** any cost figure on screen, **When** it is shown, **Then** it is prefixed "≈" and labelled API-equivalent with a link to the billing explanation.
4. **Given** a session, **When** its page loads, **Then** it shows tokens per turn, a running total and the context window fill apart from cumulative totals.

---

### User Story 6 - I can see my Claude Code configuration and where each value comes from (Priority: P2)

The user opens the global Config page or a project's Config tab and sees settings, hooks, permissions, plugins, MCP servers, instructions, skills, agents, commands and memory, each tagged with its source, with secrets hidden.

**Why this priority**: It answers "why does Claude behave this way here" but is secondary to sessions.

**Independent Test**: Load fixture `settings.json` files at user, project and local level, with a fake API key, and check the merge, the source tags and the hidden secret.

**Acceptance Scenarios**:

1. **Given** user, project and local settings, **When** the merge is shown, **Then** each effective value names the file it came from.
2. **Given** a settings value that looks like an API key, **When** the config is returned, **Then** it is masked.
3. **Given** a `CLAUDE.md` with `@include` lines, **When** it is read, **Then** included files appear, subject to the deny-list.
4. **Given** the Config page, **When** the user types in the filter, **Then** rows in every section narrow by name, description or path.

---

### User Story 7 - I can search and export conversations (Priority: P2)

The user searches every conversation, filters by project, date and model, jumps to the matching message, searches within one session, and exports a session as Markdown or JSON.

**Why this priority**: Finding an old conversation and taking it elsewhere are common, but they sit on top of the index and the conversation view.

**Independent Test**: Index fixtures, search for a word with each filter, follow a hit to its message, and export a session; check secrets in the export are hidden.

**Acceptance Scenarios**:

1. **Given** the index is ready, **When** the user searches "refactor", **Then** hits appear with redacted snippets, highlighted matches, role, model (when known) and relative time, grouped per session.
2. **Given** more than one page of hits, **When** the user scrolls, **Then** the next page loads through the cursor.
3. **Given** the index is still building, **When** the user searches, **Then** the API answers 503 with a clear message.
4. **Given** a session, **When** the user picks Export, **Then** a Markdown or JSON file is downloaded with secrets hidden.

---

### User Story 8 - The interface is consistent, accessible and works on a phone (Priority: P3)

The user uses one visual language everywhere: slate-and-violet tokens, IBM Plex type, an app shell with a project sidebar and breadcrumbs, a back button, a cost-led Overview and a project page ordered by urgency, in light and dark themes, from a 1440 px desktop down to a 390 px phone.

**Why this priority**: The product works without it, but this is what makes it usable all day, and it has the most shipped requirements.

**Independent Test**: Run the Playwright end-to-end suite at desktop and phone sizes; check no horizontal overflow, no text under 12 px, working keyboard focus and `prefers-reduced-motion`.

**Acceptance Scenarios**:

1. **Given** any page below 1024 px, **When** it loads, **Then** the sidebar is a drawer and all touch targets are at least 44 px.
2. **Given** a page that is not the Overview, **When** it loads, **Then** the top bar shows a "Back to <parent>" link before the breadcrumbs.
3. **Given** two projects with the same folder name, **When** they are listed, **Then** each shows a muted parent-folder hint.
4. **Given** the OS asks for reduced motion, **When** a page animates, **Then** the animation is removed.
5. **Given** any chart, **When** colours are forced, **Then** series remain distinguishable through dash patterns.

---

### User Story 9 - I can run it safely, locally or through a tunnel (Priority: P1)

The user starts c9view with one command, or runs the Docker image, and it is private by default: loopback only, no login needed there. Exposing it through Tailscale or Cloudflare Tunnel requires login and listed hostnames, and loopback is never trusted.

**Why this priority**: A dashboard over private history is unsafe if exposure is easy.

**Independent Test**: Start with `--host 0.0.0.0` and no auth (refused); start with token auth and call an API route with and without a session cookie from 127.0.0.1; send a request with a foreign Host or Origin header.

**Acceptance Scenarios**:

1. **Given** default options, **When** `c9view` starts, **Then** it listens on `127.0.0.1:7777` and needs no login.
2. **Given** a non-loopback `HOST` or any allowed host and no login, **When** it starts, **Then** it refuses, unless `C9VIEW_INSECURE_NO_AUTH=1`, which prints a warning.
3. **Given** login is enabled, **When** a request arrives from 127.0.0.1 without a valid cookie, **Then** it receives 401 (or a redirect to `/login` for page loads).
4. **Given** a request whose Host or Origin is not allowed, **When** it reaches the server, **Then** it receives 403.
5. **Given** the Docker image, **When** it runs with the compose file, **Then** it runs as a non-root user with a read-only root filesystem and the Claude data mounted read-only.
6. **Given** token auth without a terminal and without `C9VIEW_TOKEN`, **When** it starts, **Then** it refuses with a message to set the token.

---

### Edge Cases

- A transcript line is truncated while Claude Code is writing it: the incomplete line waits for the next read.
- A transcript file is replaced or truncated: the index detects it (file identity and hashes) and rebuilds that session.
- The index schema version changes: the index is dropped and rebuilt from the files.
- A project path no longer exists on disk: it is listed with `pathExists: false`; file and git routes answer 404.
- A session is a symlink target or a skill is a symlink: config readers follow it only inside allowed locations.
- The PID namespace differs (Docker without `pid: host`): liveness cannot be checked, so fresh hook evidence is not marked stale because of it.
- A hook payload is large or contains tool input: only whitelisted fields are kept; the rest is discarded.
- More than 32 event-stream clients connect: the 33rd receives 503.
- A search query contains FTS syntax or control characters: it is treated as a literal.
- A redaction placeholder falls on a snippet boundary: the snippet window moves to keep it whole.
- Usage range over 366 days or a malformed date: 400.
- Git is missing or times out: git status answers 400 or 504 with a generic error and no stack.

## Requirements _(mandatory)_

### Functional Requirements

#### Data reading and index (US1)

- **FR-001**: The system MUST read the Claude data directory from `C9VIEW_CLAUDE_DIR` (default `~/.claude`) and accept extra workspace roots from `C9VIEW_WORKSPACE_ROOTS` (Step 1).
- **FR-002**: The system MUST list `projects/*`, turn folder names back into paths and record whether the path exists and which source decided it (hint, filesystem or decoded) (Step 1).
- **FR-003 (was follow-ups-4b R9)**: When several `cwd` hints exist, project path resolution MUST prefer the most common hint whose Claude encoding (non-alphanumerics to `-`) equals the project folder name, then the most common hint, then the filesystem and decoded paths. Changing the rule MUST re-resolve stored paths on the next scan.
- **FR-004**: Every external input MUST be parsed with Zod schemas that tolerate unknown fields; unknown record types and malformed lines MUST be counted and skipped (Step 1; constitution IV).
- **FR-005**: The transcript reader MUST stream line by line, remember the byte offset per file, and resume from it; an incomplete trailing line MUST wait for the next read (was PLAN §2).
- **FR-006**: The system MUST read subagent transcripts under `<sessionId>/subagents/` and link each to its parent Task tool call (Step 1).
- **FR-007**: The system MUST summarise each session: title (`ai-title`), first and last time, cwd, git branch, version, models, message count, tool-use counts, permission modes, error count and token totals (Step 1).
- **FR-008**: The system MUST count tokens per message: input, output, cache-read, cache-creation (5-minute and 1-hour) and thinking, and de-duplicate repeated assistant usage records (Step 1).
- **FR-009**: The system MUST read `stats-cache.json` and `history.jsonl` when present and tolerate their absence (Step 1).
- **FR-010**: The system MUST keep a SQLite index (Drizzle) of projects, sessions, messages and daily usage with an FTS5 full-text index on message text, generated migrations and a drift check; the index MUST be rebuildable from the files at any time and MUST NOT live inside the Claude data directory (Step 1).
- **FR-011**: A file watcher MUST update the index incrementally from new data without a full rescan, and detect replaced or truncated files by identity and hashes (Step 1).
- **FR-012**: `c9view scan [--json]` MUST print what was found (Step 1).

#### Status board (US2)

- **FR-020**: The system MUST decide each session's column from, in priority order: hook events, the live status file `sessions/<pid>.json` with a process-alive check and `pidDomain` match, and the transcript (unfinished tool call, question to the user, last activity time) (was PLAN §1; Step 2).
- **FR-021**: The four columns MUST follow these rules: In progress (process running and busy, or a prompt or tool event newer than any Stop); Need input (permission prompt, question or unfinished tool call; also `AskUserQuestion` and `ExitPlanMode` tool starts); In review (process idle after a Stop); Inactive (no running process, or `SessionEnd`) (was PLAN §1).
- **FR-022**: Every decision MUST carry a human-readable reason, the deciding source, a confidence (high, medium, low), the ordered evidence list (kept to the last 200 entries) and an observed time (was PLAN §1; Step 2).
- **FR-023**: The newest evidence MUST win; a hook within 5 seconds of the chosen candidate takes precedence (Step 2).
- **FR-024**: A decision MUST be marked stale when active evidence (In progress or Need input) is older than 10 minutes, or when recent hooks exist without a live process; disagreement between hook and live status MUST lower confidence (Step 2).
- **FR-025**: A status history per session MUST be kept for the timeline and served by `GET .../status/history` (Step 2).
- **FR-026**: `c9view hook` MUST append a whitelisted, size-limited event line to a private `events.jsonl` (rotated to `events.1.jsonl`) with no output and exit code 0 on any error; the server MUST tail it incrementally per session (Step 2).
- **FR-027**: `c9view hooks install` and `uninstall` MUST show the diff to `settings.json`, back it up, and write only after confirmation or `--yes`; `c9view hooks status` MUST report whether hooks are installed (Step 2).
- **FR-028**: A foreign PID namespace (Docker without `pid: host`) MUST only disable the liveness check, not mark fresh evidence stale (was PLAN §2, Docker notes).
- **FR-029**: A cheap per-session status endpoint (`.../status`) MUST exist for polling, and the server MUST emit a `status` live event when a session's column changes (Step 3).
- **FR-030**: The project page MUST show a 4-column board of session cards, each with title, branch, model, last message preview, tokens, time since last activity, and the status reason (was PLAN §3).

#### Conversation view (US3)

- **FR-040**: The session page MUST render the conversation chat-style with collapsible tool calls and results, thinking blocks, attachments, and file snapshots (was PLAN §3; Step 3).
- **FR-041**: The session page MUST open at the newest message; scrolling up MUST load older pages; jumps and in-session search MUST work backward across pages (was PLAN §3; Step 4b).
- **FR-042**: The session API MUST page with `cursor` and `limit` (default 200, maximum 1000) and `from=end`, returning `cursor`, `prevCursor`, `nextCursor` and `totalMessages` (was PLAN §3).
- **FR-043 (was follow-ups-4b R12)**: After the first tail load, the client MUST store the resolved absolute cursor instead of `end`, so a refetch cannot shift the window.
- **FR-044 (was follow-ups-4b R13)**: When a background refetch ends while the view is at the top edge, the earlier page MUST load without needing a scroll event.
- **FR-045**: Long conversations MUST be virtualized while keeping the scroll position (was checklist UI improvements).
- **FR-046**: The page MUST show a subagent tree: expanding a Task call MUST show that subagent's transcript (was PLAN §3).
- **FR-047**: Tool cards MUST exist for Bash (description and command; long commands collapse), Read and Grep (path, range, pattern), Task (subagent link), `AskUserQuestion` and plan mode (state) (was checklist UI improvements).
- **FR-048**: Long tool output MUST collapse but always be expandable in full; it MUST NOT be hard-truncated (was PLAN §3; constitution VII).
- **FR-049**: Consecutive tool-only assistant turns MUST merge into one group (was checklist UI improvements).
- **FR-050**: A prompt outline MUST list user prompts, questions and plans and jump to them, with a jump to latest; the current entry MUST follow the topmost visible turn and still update on click (was checklist UI improvements; follow-ups-4b R11).
- **FR-051**: Search within a session MUST navigate matches (was checklist UI improvements).
- **FR-052**: A context-window bar MUST show current fill against the limit, apart from cumulative token totals; a per-turn token chart MUST be shown (was checklist UI improvements; Step 4).
- **FR-053**: The session sidebar MUST show models, permission-mode changes, tools used, files touched, errors, token totals and the status timeline (Step 3).
- **FR-054**: Slash commands MUST render as chips, pasted text MUST fold, and turn dividers MUST show tokens (Step 4b).
- **FR-055 (was follow-ups-4b R10)**: A multi-select `AskUserQuestion` answer MUST match options exactly, not by splitting on ", ".
- **FR-056 (was follow-ups-4b R14)**: The conversation edge error MUST be its own `role="alert"` element; an assistant message with a notice-only text block and tool calls MUST render the notice and the tool rows.

#### Files and diffs (US4)

- **FR-060**: The system MUST parse `toolUseResult` (`structuredPatch`, `originalFile`, `type`, `userModified`) on Edit, MultiEdit and Write results, and compute the diff from `old_string` and `new_string` when it is absent (was PLAN §4; Step 3b).
- **FR-061**: The system MUST read `~/.claude/file-history/<sessionId>/` backups and `file-history-snapshot` and delta records, mapping file to versions to message (was PLAN §4).
- **FR-062**: The system MUST list each session's changed files with +/- counts and the net diff from the first backup to the last version, and serve them at `.../changes` and `.../changes/:fileId` (was PLAN §4).
- **FR-063**: Project file access MUST stay inside the project's real path, check the realpath on every request, refuse symlinks that leave it, honour the deny-list (`.env*`, keys, `.ssh`, credentials, `.git` and similar) and `.gitignore`, and hide `node_modules` by default (was PLAN §4; constitution II).
- **FR-064**: Files over 1 MB MUST return only size and type; binary files MUST return type only; all content, including `originalFile` and file-history backups, MUST pass secret hiding (was PLAN §4).
- **FR-065**: Git access MUST be read-only through `createGit`: `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `execFile` without a shell, a timeout, repository-configured commands and inherited `GIT_*` variables disabled, `.git` denied (Step 3b; constitution I).
- **FR-066**: The API MUST serve `files?path=` (lazy folder listing), `file?path=`, `git/status` and `git/diff?path=` per project (was PLAN §4).
- **FR-067**: The web MUST provide a diff component with a unified and split toggle, jsdiff-computed hunks, Shiki highlighting, folded unchanged context, windowed rendering and single-pass hunk building (was PLAN §4; Step 3b).
- **FR-068**: Inline diffs MUST appear under Edit, MultiEdit and Write calls; a Write over an existing file MUST show a real diff (was PLAN §3).
- **FR-069**: A "Files changed" panel MUST list the session's touched files and clicking a tool call MUST jump to that file's diff at that step (was PLAN §3).
- **FR-070**: The project Files tab MUST provide a lazy tree with git badges and a read-only viewer with line anchors; the Changes tab MUST show the working tree against `HEAD`; file paths in tool calls MUST link to the viewer at the right line (Step 3b).

#### Usage and cost (US5)

- **FR-080**: The system MUST price usage from the bundled LiteLLM price table; the core pricing loader MAY merge a caller-supplied override file and label all cost "API-equivalent" (was PLAN §2; Step 1).
- **FR-081**: `GET /api/usage` MUST return per-day, per-model and per-project totals and a daily cache-hit series for an inclusive date range of at most 366 days in a given IANA time zone, optionally for one project (Step 4).
- **FR-082**: The cache-hit ratio MUST be cacheRead / (input + cacheRead + cacheCreation) (was overview-and-project Data).
- **FR-083 (was overview-and-project R6; Step 4)**: Every cost figure MUST carry "≈" and an API-equivalent label and link to the billing explanation.
- **FR-084 (was overview-and-project R5)**: Charts MUST use model-family colours (Opus, Sonnet, Haiku, Fable, other) aggregated by family, with a stable `data-series` slot so forced-colours dash patterns still tell series apart; a chart MUST offer a table alternative.
- **FR-085**: Overview MUST show headline totals from `/api/overview`; the per-turn chart and context fill live on the session page (Step 4).
- **FR-086 (was overview-and-project Data)**: The system MUST NOT invent numbers: show only figures the API provides or that derive from it.

#### Config view (US6)

- **FR-090**: The system MUST read global and project `settings*.json`, `CLAUDE.md` (with `@includes`), `.mcp.json`, skills, agents, commands, plugins and project memory (Step 1).
- **FR-091**: Settings MUST merge user, then project, then local, and each effective value MUST name its source (was PLAN §3; Step 1).
- **FR-092**: Secret values in config MUST be hidden before they leave the server (Step 1; constitution II).
- **FR-093**: `GET /api/config` MUST return the global config and `GET /api/projects/:id` the project config tabs: Skills, Agents, Commands, Hooks, MCP, Settings, CLAUDE.md and Memory (Step 3).
- **FR-094 (was ui-polish R5)**: The Config page MUST have a section nav (Skills, Hooks, MCP, Instructions, Memory, Plugins, Settings, each with a count): a sticky left column on desktop, a horizontal chip row on phones, plus a keyboard-usable filter over name, description and path.
- **FR-095 (was ui-polish R6)**: Config rows MUST be compact: name, scope badge, one-line description clamped and expandable, path on expand, secondary text at least 12 px, a single `h1`, and Markdown headings never rendering as `h1`.
- **FR-096 (was follow-ups-4b R1)**: The Config nav's current section MUST ignore observer updates for about 600 ms after a nav click, and the last section MUST become current at the page bottom.
- **FR-097 (was follow-ups-4b R2)**: `.markdown h4`-`h6` MUST step down from `h3`.

#### Search and export (US7)

- **FR-100**: `GET /api/search` MUST search messages with a full-text query, optional `projectId`, `model`, `from` and `to` filters, a `limit` (default 50, maximum 200) and a cursor (Step 4).
- **FR-101**: Search snippets MUST be redacted before leaving the server, return highlight ranges, and report `cutStart` and `cutEnd` (was ui-polish Data).
- **FR-102 (was ui-polish R1)**: Matches MUST use a `--highlight` token reaching 4.5:1 in both themes, and `Mark` and `MarkText` in forced colours.
- **FR-103 (was ui-polish R2)**: Snippets MUST be cleaned client-side: trimmed to word boundaries with "…" only where `cutStart` or `cutEnd` is true, and Claude Code markup tags removed keeping inner text, with highlight ranges remapped.
- **FR-104 (was ui-polish R3)**: Results MUST be grouped per session under one heading row (project, session title, hit count), with flat hit rows each linking to its message.
- **FR-105 (was ui-polish R4)**: Hit meta MUST show role, then model only when known, then relative time.
- **FR-106**: Export to Markdown and JSON MUST be available for a session and hide secrets (Step 4).
- **FR-107**: Search MUST answer 503 until the index is ready and 400 for invalid parameters; FTS syntax in a query MUST be treated as literal (Step 4).
- **FR-108**: A top-bar search MUST open the Search page; the Search page MUST use kit selects for filters (Step 4b).

#### Visual design and layout (US8)

- **FR-120**: Design tokens MUST cover type scale, spacing, radius, elevation, surface levels and per-model-family colours, shared by charts, badges and avatars (Step 4b).
- **FR-121**: Icons MUST come from `lucide-react`; Base UI primitives MUST back Tabs, Select, Popover, Tooltip, Menu and Dialog; accessible components MUST live in `apps/web/src/kit/` (Step 4b).
- **FR-122**: The app shell MUST have a collapsible project sidebar (a drawer on small screens) with search, status dots, attention counts and the current project's sessions, and a slim top bar with back link, breadcrumbs and theme menu (was PLAN §3; Step 4b).
- **FR-123**: The session page MUST have a sticky two-row header (status, title, chips, thin context bar, Search / More / Export), a right rail (outline, files changed, tokens per turn, subagents, collapsed session details), fill the viewport with the conversation and rail scrolling independently, and below 1024 px use a Chat / Outline / Files / Usage tab bar with a compact header (was PLAN §3).
- **FR-124 (was overview-and-project R1)**: Overview MUST lead with a range-aware cost card (≈ cost and total tokens for the selected range with a trend from the daily costs), followed by a cache-hit card and a live-sessions card.
- **FR-125 (was overview-and-project R2)**: Status counts MUST be four large buttons with `aria-pressed`, filtering the projects table to projects with at least one session in that column, toggling off on second selection, with the filter in the URL.
- **FR-126 (was overview-and-project R3)**: A segmented range picker (7d, 30d, 90d, All = 366 days) and a project `Select` MUST replace native selects; `UsageSection` receives range and project as props.
- **FR-127 (was overview-and-project R4; ui-polish R7)**: The Overview projects table MUST show name and path, only nonzero status pills in urgency order (Need input, In progress, In review, Inactive), last activity, tokens and ≈ cost, sorted by last activity; it MUST show the 10 most recently active projects with a "Show all N projects" toggle (status filter applies before the cut; toggle not in the URL); on small screens it scrolls horizontally; status filter buttons MUST follow urgency order.
- **FR-128 (was overview-and-project R7)**: The project header MUST show name, mono path and all-time totals (sessions, tokens, ≈ cost); the project page has no range outside the Usage tab.
- **FR-129 (was overview-and-project R8)**: Project underline tabs MUST be, in order: Sessions, Usage, Files, Changes, Config, using the kit `Tabs`; `usage` MUST be accepted by the route's `validateSearch`; there is no count on Changes.
- **FR-130 (was overview-and-project R9)**: The Sessions tab MUST have a Board / List toggle, a filter (title, branch, model) and a sort control; toggle and filter persist in the URL.
- **FR-131 (was overview-and-project R10)**: Board columns MUST be ordered by urgency (Need input, In progress, In review, Inactive) as a web-app display order, not by reordering `KANBAN_COLUMNS` in `@c9view/api`; active cards show title and time, a highlighted reason line, last message, model, branch, messages and tokens; inactive cards are compact; an empty column shrinks to its heading.
- **FR-132 (was overview-and-project R11)**: The list view MUST be one sortable table sharing the board's filter and sort (columns: title, status with reason, model, branch, last activity, messages, tokens, ≈ cost).
- **FR-133 (was overview-and-project R12)**: URL state MUST be validated in `router.tsx`: Overview `status`, `range` and `project`; project `tab`, `path`, `line`, `view`, `filter` and `sort`; unknown values fall back to defaults, with a round-trip test per param.
- **FR-134 (was ui-polish R8)**: List headers MUST not wrap (`white-space: nowrap`, sort icon after the label); numeric columns MUST be right-aligned with tabular figures; model badges MUST not wrap.
- **FR-135 (was ui-polish R10; follow-ups-4b R4, R5)**: Projects whose names collide MUST show a muted parent-folder hint (and unique names none) in the sidebar, the Overview table and the breadcrumbs through a shared `ProjectName` component that keeps the ordinal visible, puts the full id in `title`, and uses the full formatted hint in the sidebar's accessible name.
- **FR-136 (was follow-ups-4b R3)**: On every page except Overview, the top bar MUST show an `ArrowLeft` icon link labelled "Back to <parent>" before the breadcrumbs (session to project, project to Overview, Search and Config to Overview), a real link rather than `history.back()`, 44 px below 1024 px, and below 640 px the back control plus the page title replace the trail.
- **FR-137 (was follow-ups-4b R6)**: When a project is selected on Overview, the cost card MUST name it and keep the other totals workspace-wide, saying so.
- **FR-138 (was follow-ups-4b R7)**: The Overview project filter MUST live in the URL (`project`, validated against known ids), and `familyCostSeries` MUST merge two versions of one family into one series.
- **FR-139 (was follow-ups-4b R8)**: The project filter input MUST keep local state and sync to the URL debounced (about 250 ms) and on blur; a project with no sessions MUST show "No sessions in this project yet" rather than "No matches"; status sort MUST use a numeric urgency key; the sorted header MUST carry `aria-sort`.
- **FR-140 (was typography R1, ui-polish R9)**: IBM Plex Sans and Mono (400, 500, 600) MUST be self-hosted with `@fontsource`, `font-display: swap` and no CDN request; `--font-sans` and `--font-mono` name them first and keep system fallbacks. (This supersedes ui-polish R9, which named Inter and JetBrains Mono.)
- **FR-141 (was typography R2)**: The type scale MUST be defined once as tokens: caption 12/16, small 13/18, body 14/20, lead 16/24, title 20/28, display 28/34; weights 400 body, 500 labels, 600 headings and stat values; heading tracking about -0.01em.
- **FR-142 (was typography R3)**: No text MUST render below 12 px; Markdown `h1`-`h6` map onto the scale.
- **FR-143 (was typography R4)**: Numbers that line up MUST use tabular figures; stat values use Plex Sans 600 with `tabular-nums`.
- **FR-144 (was typography R5)**: Code, paths, branches and diffs MUST use IBM Plex Mono at `small` (13 px); diff rows keep a 24 px height.
- **FR-145**: Pages MUST have skeleton loading and empty states, phone and tablet layouts, and MUST respect `prefers-reduced-motion` (Step 4b).
- **FR-146**: The theme MUST switch between light, dark and system through the top-bar theme menu (Step 3).
- **FR-147**: A Playwright end-to-end suite (`tests/e2e/`, `corepack pnpm test:e2e`) MUST cover the Overview, project, session, config and search pages at desktop and phone sizes, and run in CI.
- **FR-148**: UI MUST be keyboard and screen-reader accessible, use 4.5:1 text contrast, never convey meaning by colour alone, and 44 px targets below 1024 px (was overview-and-project Design reference; constitution VII).
- **FR-149**: Every derived status MUST show its reason and confidence and be marked stale when evidence is old or disagrees (constitution VII).

#### Running and securing (US9)

- **FR-160**: `c9view` and `c9view start` MUST start the server and the web on port 7777, listening on `127.0.0.1` by default; options `--port`, `--host`, `--claude-dir`, `--db`, `--open`, repeatable `--allowed-host` and `--auth none|token|password` MUST override the environment (Step 5; docs/deploy.md).
- **FR-161**: The server MUST refuse to start on a non-loopback host or with extra allowed hosts unless login is enabled; the explicit escape `C9VIEW_INSECURE_NO_AUTH=1` MUST print a warning (Step 5; constitution III).
- **FR-162**: Login MUST be token or password; when enabled, requests from 127.0.0.1 MUST NOT be exempt, because tunnels deliver remote traffic from loopback (Step 5).
- **FR-163**: Tunnel hostnames MUST be listed in `C9VIEW_ALLOWED_HOSTS` (or `--allowed-host`); Host and Origin MUST be checked on every request and answer 403 otherwise (Step 5).
- **FR-164**: Token mode MUST use `C9VIEW_TOKEN` of at least 32 characters or a random per-start token printed only on a TTY; password mode MUST use `C9VIEW_PASSWORD` with scrypt, per-client exponential backoff (1 s doubling to 60 s), a global cap of 60 failures per minute, 429 with `Retry-After`, and a 24-hour HttpOnly SameSite=Strict cookie; sessions are lost on restart (docs/deploy.md).
- **FR-165**: Only the login page and its compiled assets MUST be public when login is on; API calls without a session MUST receive 401 `{error, auth}`; page loads MUST redirect to `/login`; `GET /api/health` without a session MUST return only `ok`, `version` and `auth: "required"`.
- **FR-166**: The Docker image MUST be multi-stage, run as a non-root user, mount `~/.claude` and workspaces read-only, drop all capabilities, use a read-only root filesystem, default to `HOST=0.0.0.0` with token auth, and offer optional `pid: host`; `docker-compose.yml` MUST require `C9VIEW_TOKEN` (was PLAN §2; Step 5).
- **FR-167**: A guide for Tailscale (preferred) and Cloudflare Tunnel with Cloudflare Access MUST exist in `docs/deploy.md` (Step 5).
- **FR-168**: Secret hiding MUST apply to config values, message text, search snippets, file contents, git diffs and error logs before they leave the server; every API response is passed through the redactor; the web MUST NOT load remote images or other remote content from transcript data (Step 3; constitution II).
- **FR-169**: The server MUST push live changes to every open page over SSE at `GET /api/events` with a shared connection, targeted query invalidation and a polling fallback in the web (was PLAN §2; Step 3).
- **FR-170**: c9view MUST NOT write to the Claude data directory or project folders except `c9view hooks install/uninstall`; the hook events file lives in its own state directory (`C9VIEW_STATE_DIR`, default `$XDG_STATE_HOME/c9view`), which Claude data readers never touch (constitution I).
- **FR-171**: Unhandled server errors MUST return `{error: "Internal server error"}` with a redacted log entry, and unknown `/api/*` routes MUST return 404 JSON (Step 3).
- **FR-172**: Tests MUST be colocated, run in CI (lint, typecheck, test, build) on every push and pull request, and use only synthetic fixtures in `tests/fixtures` (Step 0).
- **FR-173**: The repository MUST have a pnpm workspace, shared strict TypeScript config, ESLint, Prettier, Vitest per package, `AGENTS.md` as the single source of agent instructions with a one-line `CLAUDE.md`, and Spec Kit with a constitution (Step 0).

### Key Entities

- **Project**: a folder under `projects/` with a decoded, existence-checked working path, session count, last activity, token and cost totals, and per-column session counts.
- **Session**: one transcript (`<sessionId>.jsonl`) with title, time range, branch, models, message count, token and cost totals (own and with subagents), a status and an optional live process name; subagent sessions are linked to a parent session and tool call.
- **Message**: a transcript record turned into role, timestamp, model, blocks (text, thinking, tool use, tool result, image) and token usage; the tool-use block may carry an inline change.
- **Token usage**: input, output, cache-read, cache-creation and thinking counts plus an API-equivalent cost.
- **Status decision**: column, reason, source (hook, live-status, transcript, none), confidence, evidence list, observed time and stale flag.
- **Hook event**: a whitelisted, size-limited line (`v`, `ts`, `event`, `sessionId`, `cwd`, tool name, notification type, permission mode, agent id, subagent flag, pid).
- **Config item**: a skill, agent, command, hook, MCP server, instruction file, plugin or memory entry with a source scope (user, project, local, plugin) and path.
- **Changed file**: a path touched in a session with tool steps, counts and a net diff; an inline change is the same data for one tool call.
- **Usage day**: totals per date, project, model and session.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A full scan of a real history of about 35 projects completes in about 12 s, a no-op rescan in about 0.3 s, and an incremental append in a few milliseconds (measured at Step 1).
- **SC-002**: A session of 10,000+ messages opens at the newest message and stays scrollable without loading the whole transcript.
- **SC-003**: Every status shows a reason and confidence; the fixture tests cover each rule in FR-020 to FR-029.
- **SC-004**: No test, log or fixture contains a real secret; the secret tests for config, messages, search, files, diffs and exports pass.
- **SC-005**: The server refuses an exposed start without login in 100% of the startup-validation tests, and no request from loopback bypasses login when it is enabled.
- **SC-006**: Every page (Overview, project, session, configuration and search) renders at 1440x900 and 390x844 with no horizontal overflow and no visible text under 12 px. A separate theme test verifies switching between dark and light themes.
- **SC-007**: Root `lint`, `typecheck`, `test` and `build` pass in CI on every push.
- **SC-008**: Every cost figure on every page is labelled API-equivalent.

## Assumptions

- Claude Code 2.1.x data formats as documented in [docs/data-sources.md](../../docs/data-sources.md); the format is undocumented and tolerated, not guaranteed.
- One machine, one user. Node 22 or newer. Claude Code is the only agent.
- c9view runs as the same user as Claude Code, or has the data directory mounted read-only.
- The browser supports SSE and ES2022.
- Prices come from the bundled LiteLLM table; no network call is made at runtime.

## Non-goals

Planned but not specified yet: editing configs from the web and Codex support.

- No session control in v1: no replying to sessions, approving tool calls, editing config, starting sessions or creating projects (planned in [002-session-control](../002-session-control/spec.md)).
- No control of Claude Code processes.
- Single machine only; several machines come with [001-multi-machine](../001-multi-machine/spec.md).
- No agents other than Claude Code (Codex support is a later item).
- No drag-and-drop on the board: columns are automatic.
- No sparklines or change vs the previous period (the API returns no prior period).
- No project-level changes count on the Changes tab.
- No billing data: cost is an estimate, not what was paid.

## Known gaps

Open follow-ups from the former checklist (every unticked item in Steps 0, 4b and 5). They become tasks when someone picks them up.

**Step 0: Setup**

- **GAP-001**: Optional: set `feature_numbering: timestamp` in Spec Kit so parallel features do not need an explicit directory.

**Step 4b: Visual design**

- **GAP-002**: An endpoint that finds a message's position, so jumps reach any message regardless of the page cap.
- **GAP-003**: Optional: stat sparklines and change vs the previous period (needs the API to return the prior range).
- **GAP-004**: A message with a notice-only text block and tool calls: confirm rendering on real data (the fixture test exists, FR-056).
- **GAP-005**: Back drops the parent's URL state (Overview `range`/`status`/`project`, project `tab`/`view`/`filter`); consider carrying it over.
- **GAP-006**: Project filter: back/forward to a value equal to the last commit leaves the input empty; reset `lastCommitted` when the URL changes externally.
- **GAP-007**: Project path: deterministic tie-break for equal-count `cwd` hints; pass the counts map instead of expanding it on every scan.
- **GAP-008**: Outline click suppression relies on `scrollend` or 600 ms; the late-mount `MutationObserver` watches `document.body` until the conversation mounts.
- **GAP-009**: Config tests: restore the `window.setTimeout`/`clearTimeout` spies.
- **GAP-010**: Typography: bold italic and mono italic are synthesized; add faces if they look poor. Tailwind `text-base`/`text-lg` now map to 14/16 px, so the sidebar wordmark shrank from 18 to 16 px; revisit if wanted.

**Step 5: Packaging**

- **GAP-011**: Release workflow: npm package and container image (the packages are `private` at version 0.0.0 and `npx c9view` does not work yet).

## Open questions

None open. Both questions raised while writing the baseline are resolved:

1. **Hook events folder (resolved).** Code writes hook events to `$XDG_STATE_HOME/c9view` (default `~/.local/state/c9view`). The constitution records this current folder and says the `~/.claude/c9view/` state folder replaces it in 001-multi-machine PR 6.0d. The baseline keeps today's behaviour.
2. **Docker compose state mount (resolved).** `docker-compose.yml` mounts the hook state folder read-only because it only reads it. The constitution records the 6.0d move to the writable state folder, so the baseline keeps today's behaviour and the change belongs to 001 PR 6.0d.
