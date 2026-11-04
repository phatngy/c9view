# Research: Baseline: c9view as shipped

Decisions and rationale behind what c9view ships today, collected from the former product plan, the four archived specs and the code. The review of existing Claude Code viewers and monitors stays in [docs/research.md](../../docs/research.md). Claude Code file formats are in [docs/data-sources.md](../../docs/data-sources.md); running and tunnels are in [docs/deploy.md](../../docs/deploy.md).

## Product decisions

- **Local first, packaged for Docker.** The default is `npx c9view`-style local use on `127.0.0.1:7777`; the Docker image makes it run anywhere.
- **Kanban columns are automatic.** The user does not drag cards; status comes from evidence, so the board needs no drag-and-drop library.
- **Read-only in v1.** Reading is safe on real history; control came later as its own spec (002) with its own guard.
- **Claude Code only, room for others.** Data access sits behind a data-source layer so Codex can be added later.
- **Cost is labelled API-equivalent.** On a subscription it is not what was paid; every figure says so.

## Technology choices

| Layer               | Choice                                                                                | Why                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Language            | TypeScript everywhere, pnpm monorepo                                                  | One language; ccusage's approach and price tables can be reused                      |
| Backend             | Node 22 and Hono                                                                      | Light, fast, with streaming for live updates                                         |
| File watching       | chokidar, reading only bytes added since the last read                                | Transcripts can be hundreds of MB                                                    |
| Index and cache     | SQLite (better-sqlite3 and Drizzle), FTS5 on messages                                 | Fast lists, filters and search; rebuildable at any time                              |
| Validation          | Zod, tolerant of unknown fields                                                       | The transcript format changes between Claude Code versions                           |
| Pricing             | LiteLLM price table (as ccusage), manual override file                                | Labelled API-equivalent                                                              |
| Frontend            | React 19, Vite, TanStack Router and Query, Tailwind, Base UI primitives, lucide icons | Common stack; Base UI gives accessible unstyled primitives under c9view's own `kit/` |
| Syntax highlighting | Shiki                                                                                 | Themes match the app's light and dark tokens                                         |
| Diff                | jsdiff (`diff`) in core, single pass                                                  | Re-filtering built rows makes full-file diffs quadratic                              |
| Long lists          | Own windowing (`useWindowedRows`, `WindowedMessages`)                                 | Keeps scroll position control for tail-first paging                                  |
| Live updates        | Server-sent events                                                                    | One direction, simpler than WebSockets for a read-only product                       |
| Packaging           | CLI plus Docker image                                                                 | Local first, runs anywhere                                                           |
| Tests               | Vitest for package tests; Playwright end-to-end suite in CI                           | Tests use synthetic fixtures with no secrets                                         |

The former product plan also named shadcn/ui, dnd-kit, Recharts or ECharts, react-virtuoso and CodeMirror. None shipped; see [Doc discrepancies found](#doc-discrepancies-found).

## Status-rule design

- **Signals in priority order:** hook events, the live status file `sessions/<pid>.json` with a process-alive check and `pidDomain` match, then the transcript. The newest evidence wins; a hook within 5 seconds of the chosen candidate takes precedence because hooks are the most precise signal.
- **Hook mapping** (`packages/core/src/status/index.ts`):
  - `SessionEnd` gives Inactive.
  - `Stop`, `StopFailure`, `PermissionDenied`, and `Notification` of an idle or waiting type give In review.
  - `PermissionRequest`, a `Notification` of a permission, elicitation or agent-needs-input type, and `PreToolUse` of `AskUserQuestion` or `ExitPlanMode` give Need input.
  - `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` give In progress; `SubagentStart` and `SubagentStop` give In progress only while the process is alive. Subagent-scoped events are otherwise ignored for the parent's column.
- **Live status mapping:** `busy|running|working` is In progress, `wait|input|permission` is Need input, anything else (idle) is In review with reason "turn finished, waiting for you".
- **Transcript mapping:** an unfinished tool call or a question to the user is Need input; an ended turn is In review.
- **No-result heuristic:** an idle live process whose last hook was `PreToolUse` more than 3 seconds ago is Need input ("no result yet"), since Claude shows a permission prompt there.
- **Liveness:** with no live process, a recent hook (under 30 s) keeps the session active but stale; otherwise Inactive "no running process".
- **Confidence:** high for a non-stale hook decision with no disagreement; medium otherwise; low when stale or when no signal exists.
- **Stale:** active evidence older than 10 minutes, or recent hooks without a live process. A foreign PID namespace (Docker without `pid: host`) means liveness is unknown, so it is not treated as stale; a crashed process leaves old evidence that the 10-minute rule catches.
- **File-based hook delivery:** `c9view hook` appends a whitelisted line to a private `events.jsonl` instead of calling the server. It works when the server is down, needs no network or token, never blocks Claude, and the server tails it incrementally. Hook entry imports stay dependency-free so a hook starts fast.
- **Hook install is explicit:** `c9view hooks install` shows the diff, backs up `settings.json`, then writes.

## Diff data sources

All read-only and checked on a real machine:

| Source                                                                             | Holds                                                                          | Used for                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `toolUseResult` on the record after an Edit or Write                               | `filePath`, `type`, `structuredPatch` hunks, `originalFile`, `userModified`    | Exact diff of each tool call; fallback is a diff of `old_string` against `new_string` |
| `~/.claude/file-history/<sessionId>/<hash>@vN` and `file-history-snapshot` records | A versioned backup of every touched file linked to the message that changed it | Net diff per file for the whole session and before/after at any step                  |
| `git` in the project folder                                                        | Working tree against `HEAD`                                                    | Project Changes tab and git badges                                                    |

Own diff component (unified and split) built on jsdiff with Shiki, windowed and folded around unchanged lines; hunks are built in one pass and never re-filtered.

## Security decisions

- **Never trust loopback when login is on.** Tunnels (Tailscale Funnel, Cloudflare Tunnel) deliver every remote request from 127.0.0.1, so "local means trusted" breaks. Login applies to every request regardless of source address. Without login, the server only starts on loopback with no extra allowed hosts.
- **Explicit hostnames.** Tunnel hostnames must be listed in `C9VIEW_ALLOWED_HOSTS` (or `--allowed-host`); Host and Origin are checked on every request to block DNS rebinding and cross-site requests.
- **Escape hatch.** `C9VIEW_INSECURE_NO_AUTH=1` allows a non-loopback start without login but prints a warning.
- **Login design.** Token (at least 32 characters, random per start by default, shown only on a TTY so container logs never carry it) or password (scrypt). Cookie is HttpOnly and SameSite=Strict, valid 24 hours, lost on restart. Password attempts use per-client exponential backoff and a global cap; token checks verify first because a 256-bit token cannot be guessed online and backoff would only add a lockout risk. Proxy headers are used only when `C9VIEW_TRUST_PROXY=1`.
- **Redact on the way out.** Secret hiding runs on every API response, search snippet, file content, diff and log line. It deliberately avoids entropy-only matching because hashes and UUIDs are public data; it matches known key formats, bearer and basic credentials, URL credentials, flags and key/value assignments.
- **Project file safety.** Realpath inside the project on every request; refuse symlinks out of it; deny-list (`.env*`, keys, `.ssh`, `.aws`, `.npmrc`, `.netrc`, credentials and `.git`); `.gitignore` respected; files over 1 MB and binary files show only size and type.
- **Git safety.** `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `execFile` without a shell, timeout, hooks, fsmonitor, filter drivers, external diff and credential helpers disabled, whitelisted environment with no inherited `GIT_*` variables, so a plain `git status` never refreshes the index.
- **Index outside Claude data.** `assertIndexPath` refuses an index path inside the Claude data directory.
- **Docker.** Non-root user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, data mounted read-only, port bound to loopback by default in compose.
- **No remote content.** The web never loads remote images or fonts from transcript data; fonts are self-hosted.

## Decisions from the archived specs

### overview-and-project (Step 4b)

- Overview leads with a cost card because cost is the question the user asks after status; five identical tiles had no hierarchy.
- Status counts became filter buttons; the filter is in the URL so views are shareable.
- Charts use model-family colours aggregated by family so two Opus versions are one series; a stable `data-series` slot keeps forced-colours dash patterns working.
- Usage became its own project tab; the project page has no range outside it.
- Board order is by urgency (Need input first), defined in the web app, not by reordering `KANBAN_COLUMNS` in `@c9view/api` (which keeps `inactive` first for API stability).
- No sparklines or change-vs-previous figures: the API returns no prior period, and the product shows no invented numbers.
- No count on the Changes tab: there is no project-level changes count in the API.
- User decisions: board by urgency, Usage tab, family colours, status counts as table filters.
- List view columns (proposal, now shipped): title, status with reason, model, branch, last activity, messages, tokens, cost.

### ui-polish (round 2)

- Review of `main` found harsh yellow `<mark>`, mid-word snippets, raw Claude Code tags in snippets, "Unknown model" for user messages, nested bordered hit cards, a flat 51-item config list, 113 text elements under 12 px, a 36-row projects table pushing charts 4,000 px down, mid-word list headers, and unloaded fonts.
- User resolved: Overview shows 10 recent projects plus "Show all"; Config has a sticky left section nav inside the page; fonts are self-hosted (about 300 KB).
- Design-system query recommended Minimalism/Swiss for dashboards; the tokens and palette were kept, the tool's green accent and IBM Plex Sans were not adopted at that time (Plex was chosen later in the typography spec).
- `cutStart` and `cutEnd` were added to search rows because the client cannot tell reliably whether the server cut a snippet.
- Duplicate project names get a parent-folder hint computed client-side from names and paths.

### follow-ups-4b

- 13 open Step 4b follow-ups plus the user's request for a visible back button, because on a phone through a tunnel the breadcrumbs were the only way up.
- Back is a real `<Link>` to the parent crumb, not `history.back()`, so it behaves the same after a deep link or reload; below 640 px it replaces the crumb trail together with the page title.
- Project path resolution prefers the cwd hint whose Claude encoding equals the folder name, giving a folder like `-...-github-personal` the right parent path instead of a child project's path; the index re-resolves paths after the change.
- Session paging stores absolute cursors after the first tail load so refetches cannot shift the window.

### typography

- The user compared Inter, IBM Plex, Geist and an editorial Hanken Grotesk and Fraunces mix on the real pages and chose IBM Plex. Inter and JetBrains Mono were removed.
- One type scale as tokens (caption 12, small 13, body 14, lead 16, title 20, display 28); the 10 and 11 px sizes fell below the 12 px minimum.
- Stat values use Plex Sans 600 with `tabular-nums` (proposal accepted).
- No serif display face was added.

## Data-reading decisions

- The reader remembers a byte offset per file and each message stores its offset and length so a page can be read without scanning.
- Sessions with many messages are indexed once; the live tail is merged in an LRU of mapped records in the server (`cache.ts`).
- The index version is a migration tag (`schemaVersion`); a mismatch drops and rebuilds all tables.
- Subagent transcripts are indexed as child sessions with `parentSessionId` and `parentToolUseId`.
- Per-day usage rows are keyed by date, project, model and session so any range, model or project slice is a SQL aggregate.

## Risks

- **The transcript format isn't documented and changes.** Use tolerant parsers, test against several Claude Code versions, and log unknown record types instead of crashing.
- **Status inside Docker is less reliable** without `--pid=host`. Hooks are the reliable path, so the app should recommend installing them.
- **Cost is an estimate.** On a subscription plan it is API-equivalent, not what was paid. Label it that way.
- **File browsing widens what c9view can show.** Project files can hold secrets that transcripts don't. Mitigations include the folder check, deny-list, secret hiding, size limits and read-only mounts.
- **Privacy.** Conversations contain secrets. Hide them by default, listen only on 127.0.0.1 unless login is set, and mount data read-only.

## Doc discrepancies found

Where the old docs disagree with the code, this baseline follows the code.

1. **The former product plan technology table lists libraries that did not ship**: shadcn/ui, dnd-kit, Recharts or ECharts, react-virtuoso and CodeMirror. The web uses Base UI with its own `kit/`, its own SVG charts (`charts/UsageCharts.tsx`), own windowing hooks, and Shiki only for the viewer. `diff` (jsdiff) lives in `packages/core`, not the web.
2. **The former product plan says a hook script "sends Claude Code events to the server".** The code appends them to a local `events.jsonl` that the server tails (file-based delivery).
3. **The former product plan says login is "token or basic auth".** The code supports token and password (form login and cookie), not HTTP basic auth.
4. **The former product plan and the Step 5 row say `npx c9view`.** All packages are `private` at version `0.0.0`; `docs/deploy.md` says the npm package is not published. The release workflow is an open gap (GAP-011).
5. **The former product plan lists a hook script and `c9view hooks install/uninstall`.** The CLI also has `c9view hooks status` and the `c9view hook` receiver.
6. **The former product plan and the Step 4b polish text say Inter and JetBrains Mono** (ui-polish R9). Typography R1 replaced them with IBM Plex; `apps/web/package.json` has the Plex packages.
7. **`KANBAN_COLUMNS` in `@c9view/api` is ordered inactive, need_input, in_progress, in_review**, while every page shows urgency order (need input, in progress, in review, inactive). This is intended (R10) but not obvious from the old plan.
8. **`packages/api/src/index.ts` header says "All routes are GET".** `POST /api/login` exists, handled by the auth middleware in `apps/server`, with its body type not in `@c9view/api`.
9. **The former product plan says the diff API is `GET /api/projects/:id/git/status` plus `git/diff?path=`** and `.../changes/:fileId`; correct, and the code also exposes `.../status/history` and `.../status` for sessions, not named in the old plan.
10. **Hook events folder (recorded in the constitution).** Code uses `$XDG_STATE_HOME/c9view` (default `~/.local/state/c9view`) for `events.jsonl`. The constitution records this current folder and says `~/.claude/c9view/` replaces it in 001 PR 6.0d, so the baseline keeps today's behaviour. Docker already sets `C9VIEW_STATE_DIR=/data/c9view-state`.
11. **`docker-compose.yml` mounts the state folder read-only**, which suits today's read-only tailing; the writable state folder arrives with 001 PR 6.0d, as the constitution records.
12. **The former checklist's Step 4b listed the sidebar's "attention counts" and the former product plan lists "live count per column" on project cards**; the project cards were replaced by a projects table in Step 4b (overview-and-project R4), so the card wording in the former product plan is outdated.
13. **The former product plan and `AGENTS.md` mentioned `docs/specs/` and the archived specs folder**, which this baseline replaces; the archived specs' open questions (list view columns, projects table columns) were resolved by shipping the proposals.
14. **tests/fixtures/README.md** says sanitized real data "will live here when the data-reading task adds fixtures"; fixtures exist (`tests/fixtures/claude`).
15. **`packages/cli` in the Technology Constraints.** The constitution lists it.

## Reference documents

- [docs/data-sources.md](../../docs/data-sources.md): where Claude Code keeps its data, record types, hook events and token counting.
- [docs/deploy.md](../../docs/deploy.md): running, Docker and Compose, tunnels, image verification.
- [docs/research.md](../../docs/research.md): review of existing Claude Code viewers and monitors.
