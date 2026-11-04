# Research: existing Claude Code viewers and monitors

Research done with an AI agent (web search) on 2026-10-24. Star counts are approximate as of that date.

## Summary: what to borrow

| Repo                                                                                                                                                | What to borrow                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ccusage](https://github.com/ccusage/ccusage)                                                                                                       | How to count tokens and cost from the JSONL files, including cache tokens and model pricing                                                                       |
| [minchenlee/c9watch](https://github.com/minchenlee/c9watch)                                                                                         | Finding sessions however they were launched; status rules in `src-tauri/src/session/status.rs`                                                                    |
| [joshjetson/claude-sessions](https://github.com/joshjetson/claude-sessions)                                                                         | The best-documented status logic: combine hook events, the transcript and the process list, and the newest evidence wins                                          |
| [jhlee0409/claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer)                                                     | Settings and skills screens, a session board, keeping billed tokens separate from conversation tokens                                                             |
| [anaypaul/claude-session-visualizer](https://github.com/anaypaul/claude-session-visualizer)                                                         | Watching files and reading only new bytes, live updates to the browser, a tree of subagents and tool calls                                                        |
| [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) / [d-kimuson/claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer) | How to display a conversation; keeping the viewer separate from anything that runs Claude                                                                         |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)                                                                                       | Keeping a task's status separate from the agent's status                                                                                                          |
| [weiesky/cc-viewer](https://github.com/weiesky/cc-viewer)                                                                                           | Showing the exact context sent to the API (system prompt, tools, diffs between requests); optionally reading its logs. See the [deep dive](#deep-dive-cc-viewer). |

**What none of them do well**, and where c9view can stand out:

- Show _why_ a session is in a given status.
- Show which skills, hooks and settings were in effect for a session.
- Clearly label cost as "API-equivalent" rather than actual billing.

## Full report

**Survey: 15 repositories**, checked through web search and public GitHub docs/source on **24 October 2026**. Stars are approximate indexed counts. “Not established” means I could not verify a reliable running/waiting/idle classifier.

Most transcripts live at `~/.claude/projects/<encoded-project>/<session>.jsonl`, with subagent logs nested beneath the session directory.

**Transcript, usage, and history tools**

| Repository / stars ≈                                                                                 | Stack; deployment                                                                     | Features                                                                                                      | Data ingestion                                                                                                                                                             | Live session status                                                                                                                                                                                                             | Ideas worth borrowing                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [ccusage](https://github.com/ccusage/ccusage) · **19.2k**                                            | **Rust CLI currently**, npm launcher; formerly TypeScript                             | Daily/monthly/session/model reports, token/cache accounting, estimated cost, usage blocks                     | Scans local logs; [Rust Claude adapter](https://github.com/ccusage/ccusage/blob/main/rust/adapters/claude/src/lib.rs) parses JSONL and deduplicates usage entries          | Usage-window activity; does **not establish** whether an interactive session awaits input                                                                                                                                       | Reusable provider adapters, deduplication, machine-readable reports, pricing separated from parsing        |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) · **8.8k** | Python, Rich; local terminal monitor                                                  | Burn rate, forecasts, warnings, daily/session views, exports, optional persistent warehouse                   | Periodic JSONL scans; current version also captures official statusline `rate_limits`; labels data provenance                                                              | “Active” primarily concerns usage windows, not permission/input state                                                                                                                                                           | Explicit `official` versus `local_estimate` confidence; stable JSON/state-file interface for companion UIs |
| [sniffly](https://github.com/chiphuyen/sniffly) · **1.3k**                                           | Python, FastAPI/Uvicorn, JS charts; local web server, optional shared dashboards      | Usage patterns, tool/error breakdowns, searchable messages, model/cost analysis                               | JSONL processing with memory/file caches and smart refresh; [architecture](https://github.com/chiphuyen/sniffly/blob/main/repo-structure.md) describes progressive loading | No verified interactive state classifier                                                                                                                                                                                        | Error taxonomy, tool-success analysis, progressive loading, selective sharing                              |
| [claude-code-viewer — d-kimuson](https://github.com/d-kimuson/claude-code-viewer) · **1.3k**         | TypeScript, React, Vite, Hono, Effect, Zod; local server/PWA                          | Live history, full-text search, tool rendering, subagents, terminal, Git, optional session control            | Direct JSONL reads with schema validation and metadata cache; updates delivered over SSE                                                                                   | Managed sessions expose process changes and permission requests; external log viewing alone does not establish equivalent state fidelity. [Architecture](https://github.com/d-kimuson/claude-code-viewer/blob/main/docs/dev.md) | Typed event bus, raw-data fallback, progressive disclosure, separate history and process state             |
| [claude-code-history-viewer](https://github.com/jhlee0409/claude-code-history-viewer) · **2.3k**     | Rust/Tauri 2, React/TypeScript, Zustand, Tailwind; desktop **or headless web server** | Multi-provider search, token/cost analytics, session board, archives/backups, scope-aware settings/MCP editor | Local provider parsers; watches project files; server pushes changes through SSE                                                                                           | Live updates verified; comprehensive running/waiting/idle classifier **not established**                                                                                                                                        | Billing versus conversation token views, archive before cleanup, settings alongside history                |
| [claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard) · **0**                  | Python stdlib HTTP server, browser charts, external ccusage; local web                | Project/session costs, cache efficiency, live five-hour block, historical snapshots                           | Runs `ccusage --json`; joins session UUIDs to transcripts; metadata cached by **mtime**, separate short cache for live block                                               | Usage-block activity only; no input-state classifier                                                                                                                                                                            | Reuse a mature accounting engine; cache expensive totals separately from live metrics                      |
| [claude-session-visualizer](https://github.com/anaypaul/claude-session-visualizer) · **1**           | TypeScript, Hono, React/Vite, Zustand, React Flow, Recharts; local web                | Execution trees, thinking explorer, token burn, error replay, subagents/tasks                                 | Chokidar watches JSONL and session registry; SSE; optional HTTP lifecycle/tool hooks                                                                                       | Registry and hook-based lifecycle signals; permission-wait fidelity **not established**                                                                                                                                         | Link execution graph, cost timeline, and error investigation in one view                                   |

**Session managers, live monitors, and configuration tools**

These include useful architectural examples, but several primarily track sessions they launch rather than importing every existing terminal session.

| Repository / stars ≈                                                                            | Stack; deployment                                                                           | Features                                                                                          | Data ingestion                                                                                                                                                                                            | Live session status                                                                                                                                                                                                                                         | Ideas worth borrowing                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [siteboon/claudecodeui — now CloudCLI](https://github.com/siteboon/claudecodeui) · **14.3k**    | Node/TypeScript, Express, React/Vite, WebSockets; local/self-hosted web, Electron packaging | Mobile access, chat/resume, terminal, files/Git, multiple providers, skills/MCP/settings          | Transcript watcher and synchronization/indexing pipeline; runtime events for launched chats                                                                                                               | Runtime tracks runs, background work, pending approvals. Arbitrary external sessions’ full state is **not established**. [Runtime source](https://github.com/siteboon/claudecodeui/blob/main/server/modules/providers/services/provider-runtime.service.ts) | Provider abstraction, mobile attention/approval UI, indexed history plus live runtime                                                           |
| [Claudia → opcode](https://github.com/winfunc/opcode) · **22.4k**                               | Rust/Tauri 2, React/TypeScript/Vite, SQLite; desktop                                        | Project/session browser, custom agents, usage analytics, MCP management, checkpoints              | Rust scans/parses project JSONL; launches Claude and handles streamed output. [Source](https://github.com/winfunc/opcode/blob/main/src-tauri/src/commands/claude.rs)                                      | Owned-process tracking supports execution/completion; independent external-session tri-state **not established**                                                                                                                                            | Session checkpoints, agent library, native filesystem access; derive project paths from transcript `cwd`                                        |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) · **28.4k**                               | Rust/Tokio backend, React/TypeScript, SQLite; local web, remote options                     | Task board, parallel agents, worktrees, diffs/review, approvals                                   | Primarily launches agents; Claude executor consumes **bidirectional `stream-json`**, normalizes events and stores execution logs                                                                          | Owned execution lifecycle plus explicit approval/question control requests. [Executor](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/claude.rs)                                                                           | Normalize providers into one event model; separate task, execution, and approval state                                                          |
| [crystal](https://github.com/stravu/crystal) · **3.1k**                                         | Electron, Node/TypeScript, React, Zustand, SQLite, PTY; desktop                             | Parallel worktrees, conversation persistence, diffs, notifications, session comparison workflows  | Captures managed CLI output using `stream-json` and persists application session data. [Claude manager](https://github.com/stravu/crystal/blob/main/main/src/services/panels/claude/claudeCodeManager.ts) | Managed process/output lifecycle; documents running/waiting/stopped/error; exact waiting classifier not fully verified                                                                                                                                      | Unviewed-completion state, worktree comparison, targeted IPC updates. **Deprecated February 2026; replaced by Nimbalyst**                       |
| [ccmanager](https://github.com/kbwo/ccmanager) · **1.3k**                                       | TypeScript/Bun, React Ink, headless xterm; local terminal/TUI                               | Multi-agent/worktree management, context copying, session restoration, status-change commands     | Supervises terminal sessions; classifies rendered terminal contents rather than relying on transcript parsing                                                                                             | [Detector](https://github.com/kbwo/ccmanager/blob/main/src/services/stateDetector/claude.ts) recognizes approval menus, interrupt hints, spinner/activity lines; **1.5-second stable-screen debounce** before idle                                          | Inspect the current prompt region, prioritize waiting, debounce redraws; its status hooks are **outputs**, distinct from Claude lifecycle hooks |
| [cliq/claude-monitor](https://github.com/cliq/claude-monitor) · **2**                           | Swift/native macOS app, shell hook bridge, local HTTP; menu bar/dashboard                   | Colored session tiles, attention alerts, terminal-tab focusing, usage companions                  | Six Claude hooks POST session ID/TTY/PID/cwd; transcript polling every five seconds reconciles background-task completion/cancellation                                                                    | Explicit hook-driven state machine: working between prompt submission and stop; notifications identify attention states; session end closes lifecycle                                                                                                       | TTY-to-terminal navigation, hook failures exit successfully, reconciliation for missed cancellation events                                      |
| [Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) · **1.1k** | Node/Express, SQLite, React/Vite/Tailwind, WebSockets; local web/native app options         | Session Kanban, tools/subagents, live analytics, notifications                                    | Hook events become persisted session/agent/tool records; reconciliation and stale-session handling. [Hook guide](https://github.com/hoangsonww/Claude-Code-Agent-Monitor/blob/master/docs/HOOKS.md)       | `UserPromptSubmit` marks working, tool hooks track activity, `Stop` handles turn completion/waiting; stale sweep marks abandoned sessions                                                                                                                   | Explicit `awaiting_reason`/`awaiting_input_since`; model main agents and subagents separately                                                   |
| [claude-dashboard](https://github.com/PeterHueer/claude-dashboard) · **3**                      | Node/Express, vanilla JS, DaisyUI/Tailwind; local web                                       | Browse/manage skills, plugins, agents, MCP servers, permission rules; discovery and trash/restore | Filesystem scans of skills/plugin directories and JSON settings; no database                                                                                                                              | **Not applicable:** configuration inventory, not session monitoring                                                                                                                                                                                         | Show configuration source badges; reversible deletion; inspect plugin-provided resources alongside personal ones                                |

**1. Common stack choices**

- **Web:** TypeScript + React + Vite dominates; Express or Hono serves local APIs. SSE suits transcript updates; WebSockets appear where terminals or bidirectional control are needed.
- **Desktop:** Tauri/Rust and Electron/Node are the main choices. Swift appears for native macOS attention widgets.
- **Analytics:** Python is common for usage monitors. SQLite stores durable session/event history; simpler viewers read JSONL directly and cache metadata. Current ccusage demonstrates a Rust parsing core behind npm distribution.
- **Shared pattern:** local filesystem → parser/normalizer → cached or persisted model → events → UI. The implementations above provide examples of each variation.

**2. Best techniques for detecting live session state**

My recommendation is to **combine signals and preserve their provenance**:

| Signal                                                  | Best use                                                     | Limitation                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `UserPromptSubmit`                                      | Immediately mark the foreground turn working                 | Does not cover every internally triggered/background turn                                        |
| `PermissionRequest`, SDK approval callback              | Immediately identify a permission wait                       | Requires hooks or control of the runtime                                                         |
| `Notification` with `permission_prompt` / `idle_prompt` | Attention alerts and reconciliation                          | Current docs describe roughly **six-second permission** and **60-second idle** delays            |
| `Stop`                                                  | Foreground turn finished; ready for another prompt           | Does not mean the process exited or all background agents finished; stop hooks can continue work |
| `SessionStart` / `SessionEnd`, process checks           | Establish session identity and liveness                      | A live PID cannot distinguish thinking from waiting                                              |
| Structured `stream-json` / SDK events                   | Strong state signal for sessions your app launches           | Does not automatically observe unrelated terminal sessions                                       |
| JSONL watcher, file size/mtime                          | Incremental history, usage, recent-activity fallback         | Silence can mean thinking, waiting, a long tool, or exit                                         |
| Terminal-screen classifier                              | Observe interactive CLI state without modifying Claude hooks | Sensitive to CLI wording/layout changes; needs debounce and fixtures                             |

Hook semantics and notification delays are documented in the [official hooks reference](https://code.claude.com/docs/en/hooks).

A practical model separates **process liveness**, **foreground turn state**, **attention reason**, and **background-task count**. Expose `unknown/stale` when evidence expires. Use hook events first, reconcile with process/transcript observations, and reserve mtime for a labeled heuristic. Cliq’s reconciliation and ccmanager’s screen debounce are useful complementary examples.

For parsing, use byte offsets with partial-line buffering, detect truncation/replacement, deduplicate usage, and periodically rescan directories to recover missed watcher events. A [CloudCLI issue](https://github.com/siteboon/claudecodeui/issues/1021) illustrates how new-directory watcher gaps combined with scan checkpoints can permanently hide sessions.

**3. Gaps in the reviewed set**

I did **not find a complete implementation** of these combinations; that is narrower than claiming no public project exists:

- **Historical configuration provenance:** reconstruct the exact effective settings, skill/plugin versions, instructions, and MCP configuration used for each turn, then relate changes to cost/errors/outcomes. Configuration editors and transcript viewers exist, but this historical join remains weak.
- **Explainable state across arbitrary sessions:** one cross-platform monitor covering terminal, IDE, desktop, containers, and resumed sessions, with an explanation such as “waiting: permission hook, 3 seconds ago” and robust crash reconciliation.
- **Outcome-linked analytics:** connect token spend, retries, cache efficiency, skills and tools to accepted diffs, passing tests, reverted changes, and time-to-resolution.
- **A shared compatibility layer:** versioned transcript schemas, replayable hook events, parser fixtures, and consistent accounting across forks, compaction, subagents, and renamed projects.

The strongest design opportunity is a unified local observatory combining **ccusage-style accounting, hook/process state, searchable transcripts, and historical configuration provenance**.

## Deep dive: cc-viewer

[weiesky/cc-viewer](https://github.com/weiesky/cc-viewer) (≈1.1k★, MIT). Source reviewed with AI assistance at commit `c235903` (2026-10-24), read-only and nothing executed. Key claims spot-checked by hand. Everything below describes that commit; cc-viewer is actively developed, so details may have changed since. Paths are relative to that repo; **A** = `packages/app`, **W** = `apps/web`.

**In one line:** cc-viewer is an active Claude controller and API-traffic recorder. c9view is a passive dashboard. Its best ideas are context inspection, explicit session identity, incremental storage and event-driven state. Its capture method changes how Claude is launched, and sometimes Claude's installed code or settings, so it does not fit c9view's read-only model.

### Architecture

- pnpm workspace: `packages/{app,core,content}`, `apps/{web,electron}`. Node ≥ 22.13, plain JavaScript (ESM).
- Backend on bare `node:http` with custom routing. Frontend: React 18, Vite 6, Ant Design, CodeMirror, xterm.
- Electron desktop app that runs separate server, proxy and terminal workers per tab.
- Talks over HTTP, SSE, WebSockets (terminal and control) and Electron IPC.

### How it captures traffic

| Mode            | Mechanism                                                                                                                                                                                                                                                                      | Changes to the machine                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ccv` (wrapper) | Starts a loopback HTTP proxy, launches Claude in a pseudo-terminal with `ANTHROPIC_BASE_URL` pointing at it, and replaces `globalThis.fetch` in the proxy to copy requests and rebuild streamed responses (`A/cli.js:469–596`, `A/server/proxy.js`, `A/server/interceptor.js`) | Writes its own hooks (questions, permissions, Stop, SessionStart, prompts) into `~/.claude/settings.json` (`A/server/lib/ensure-hooks.js`) |
| `ccv -logger`   | npm installs: **patches Claude's installed `cli.js`** to import the interceptor (`A/server/lib/cli-inject.js:47–65`). Native installs: adds a shell function that routes `claude` through `ccv run`                                                                            | Modifies Claude's code or your shell profile, and keeps re-applying itself                                                                 |
| `ccv --sdk`     | Runs the session through the Agent SDK (`query()`, `canUseTool`), still recorded by the proxy                                                                                                                                                                                  | No hooks written                                                                                                                           |

Uninstalling removes the patch, the shell integration and its hooks, but keeps logs and writes a marker so it doesn't reinstall itself (`A/cli.js:1087–1157`).

### Storage

Logs live under `~/.claude/cc-viewer/` (`A/findcc.js:129`).

- **v1:** one `.jsonl` file per project and time, holding request envelopes with checkpoint and delta message records (`docs/WIRE_FORMAT.md`).
- **v2 (since 1.7.0):**
  ```
  <project>/sessions/<timestamp>_<uuid>/
    meta.json, journal.jsonl, responses.jsonl, prompts.jsonl
    conversations/<conversation>/e<N>.jsonl
    blobs/sha256-<hash>.json
  ```
  The journal records start and finish, URL, headers, model, parameters, timing, status and usage. Responses keep their bodies and headers. The space saving comes from storing conversations as append and snapshot events, and from storing system prompts and tool lists once by content hash, not from compression (`A/server/lib/v2/`). The "90% smaller" figure is a README claim, not measured here.

**Secrets:** lowercase auth headers keep their first 8 and last 4 characters. Headers with mixed-case names can slip past that masking, and response headers and bodies are not masked. Configured secrets are encrypted (AES-256-GCM) with a `0600` key file next to them (`A/server/interceptor.js:1070–1120`, `A/server/lib/credential-vault.js`).

### Other findings

- **Reads Claude's own transcripts:** yes. It scans `projects/<encoded-cwd>/<sessionId>.jsonl` with bounded reads and LRU caches, mainly to add plan and tool-result details (`A/server/lib/session-transcript-reader.js`). It does not read `~/.claude/sessions/<pid>.json`.
- **Session state:** in terminal mode, turns start on `UserPromptSubmit` and end on `Stop` or interrupt, with heartbeats. Streaming traffic alone is deliberately not trusted. In SDK mode it uses the SDK's `idle`, `running` and `requires_action` states. Pending permission prompts and questions appear as browser panels (`A/server/server.js:3170–3193`, `A/server/routes/ask-perm.js`).
- **Tokens and cost:** sums input, output, cache-read and cache-write tokens per model (`A/server/lib/stats-worker.js:56–96`). No dollar-cost or pricing table was found in the source.
- **Context screen:** shows the system prompt, tool definitions, messages grouped by turn, raw request and response bodies and headers, a **diff against the previous request**, and tools added or removed (`W/src/components/dashboard/DetailPanel.jsx`, `ContextTab.jsx`).
- **LAN sharing (at commit `c235903`):** it listened on `0.0.0.0` by default (`A/server/server.js:398`). Remote clients needed a random 128-bit URL or cookie token, or a password; local requests skipped auth, and an empty password allowed remote reads. HTTPS needed certificates from a plugin. It sent `Access-Control-Allow-Origin: *` (`A/server/server.js:944`), which together with the local-request exemption could allow cross-origin reads. Sensitive routes and WebSockets do check Origin, and file access goes through a realpath allowlist (`A/server/lib/file-access-policy.js`).
- **Quality:** large Node test suites, dependency-injection seams, replay verification, ordered journals with fsync barriers. Coverage tooling exists but isn't enforced. Some very large files remain (`W/src/AppBase.jsx` is over 4,700 lines).

### For c9view

**Borrow:**

- Identifying a session by full cwd + session id + instance.
- Tolerant incremental readers.
- Keeping cache tokens separate.
- A **context diff between consecutive requests** on the session page.
- Panels for pending permissions and questions in Step 6.

**Avoid:**

- Patching Claude's code or the user's shell.
- Writing global hooks without showing exactly what changes. Our `c9view hooks install` must show the diff, back up and be reversible.
- Wildcard CORS, listening on `0.0.0.0` by default, and skipping auth for local requests. c9view already checks Host and Origin and listens on 127.0.0.1.

**Optional data source (later step):** when `~/.claude/cc-viewer/` exists, read its logs to show wire-level context that native transcripts lack. Parse v2 journals, replay conversation epochs, resolve blobs, and join responses by sequence; support v1 separately. Never require installing cc-viewer, and never decide a session is "running" just because a journal request hasn't finished. Project discovery must also ignore that folder.

## UI study: cc-viewer

AI-assisted comparison of cc-viewer's web UI (`apps/web/src`, commit `c235903`) with ours, reading the source only. Paths are relative to cc-viewer's `apps/web/src/`.

**Worth borrowing** (all now in c9view):

- **Tool cards** (`components/chat/ChatMessage.jsx:432–727`):
  - Bash shows its description and command, and long commands collapse.
  - Read and Grep show the path, range and pattern.
  - Edit and Write show inline diffs. Task links to its subagent.
  - AskUserQuestion and plan mode show their state (pending, answered, approved).
- **Grouping:** consecutive tool-only turns merge into one group (`utils/toolRunMerge.js:63–102`).
- **Navigation:** a prompt outline jumps between prompts, questions and plans (`components/chat/ChatView.jsx:3770–3847`).
- **Files:** a lazy file tree through `/api/files` (`components/files/FileExplorer.jsx`). Files open in a CodeMirror viewer with a minimap (`components/files/FileContentView.jsx`).
- **Git diffs:** a git diff view with a clickable minimap (`components/git/GitDiffView.jsx`, `DiffMiniMap.jsx`).
- **Context:** a context-window capacity bar with a compaction threshold, kept separate from cumulative usage (`components/dashboard/SdkContextUsageTab.jsx:98–167`).
- **Mobile:** a separate tree with file and git overlays (`Mobile.jsx`).

**Where c9view should do better:**

- **Diff accuracy.**
  - Its Edit diffs compare only `old_string` with `new_string`.
  - A Write is shown as _all additions_, even when it overwrites a file (`ChatMessage.jsx:504–512`).
  - It doesn't use `toolUseResult.structuredPatch` or the `~/.claude/file-history` backups. c9view uses both (see [baseline spec](../specs/000-baseline/spec.md)).
- **No hard truncation:** tool results are cut at 5,000 characters (`components/viewers/ToolResultView.jsx:344`). c9view collapses long output but can always expand it in full.
- **Performance:** building the full-file diff re-filters rows it has already built, which is quadratic (`components/git/FullFileDiffView.jsx:132`). The request body diff also leaves out removed keys.
- **Accessibility:** panel resizers work with the mouse only, some toggles are clickable text, and quota details only appear on hover. Use keyboard- and touch-friendly controls instead.
- **Scope:** leave out its approval and chat controls while c9view is read-only.

**Stack, for reference:**

- React 18, Ant Design and its icons, CodeMirror 6, highlight.js and jsdiff (`diff`), with custom unified diff rows.
- React Virtuoso, used for conversations only on mobile.
- CSS variables for light and dark themes.

### Visual comparison

An AI agent ran cc-viewer at commit `c235903`, from source with an empty sandboxed home and a synthetic session written with its own `V2Writer`, and screenshotted it next to c9view in Playwright.

- **Its conversation reads like a chat; ours reads like a log.** Claude on the left with an avatar, model and time; user prompts as right-aligned bubbles; tools as small chips; inline diffs with `+N −M`; folded thinking; a "Last response" divider and "Stick to bottom". Every c9view message is the same full-width card.
- **We show raw Claude Code markup.** `<command-name>`, `<local-command-stdout>` and `<pasted_content>` appear verbatim in the conversation and the prompt outline; core strips them only for session titles (`packages/core/src/transcript/summary.ts`).
- **Plain controls and no shell.** Native selects, text glyphs for icons, boxed-button tabs, and projects reachable only from Overview. cc-viewer has an icon rail and a menu.
- **Not copied:** approval and chat controls (c9view had no session control), the 5,000-character tool output cutoff, mouse-only resizers, and its Ant Design look; c9view uses its own palette.
- **Security note:** at commit `c235903`, cc-viewer's server listened on `0.0.0.0:7008` even with `HOST=127.0.0.1`.
