# Data Model: Baseline: c9view as shipped

Two layers: the SQLite index (a rebuildable cache, `packages/core/src/index-db/schema.ts`) and the in-memory entities that core and the server build from Claude files. File data is always the source of truth.

## SQLite index

Location: `C9VIEW_DB` (default `<cache dir>/c9view/index.sqlite`; `XDG_CACHE_HOME`, `~/Library/Caches` or `%LOCALAPPDATA%` by platform). WAL mode, `foreign_keys = ON`. Created from one generated migration (`migrations/0000_wooden_edwin_jarvis.sql`, tag `schemaVersion` in `meta`). If the stored tag differs, all tables, triggers and the FTS table are dropped and rebuilt. The index path MUST NOT be inside the Claude data directory.

Every table that holds usage repeats the same token columns: `input`, `output`, `cacheRead`, `cacheCreation`, `thinking` (integers, default 0) and `costUsd` (real, default 0).

### projects

| Column           | Type       | Notes                                                |
| ---------------- | ---------- | ---------------------------------------------------- |
| `id`             | text PK    | the project folder name under `projects/`            |
| `dir`            | text       | absolute folder under the Claude data directory      |
| `path`           | text       | resolved working path                                |
| `pathExists`     | boolean    |                                                      |
| `pathSource`     | text       | how the path was decided (hint, filesystem, decoded) |
| `sessionCount`   | integer    |                                                      |
| `lastActivityAt` | text, null | ISO time                                             |
| token columns    |            | totals over the project's sessions                   |

### sessions

Primary key `id`; index `sessions_project(projectId)`; `projectId` references `projects.id` (cascade delete). Subagent transcripts are rows with `isSubagent = true`, `parentSessionId` and `parentToolUseId`, and an id of the form `<parentSessionId>/agent-<id>`.

| Column                                                                                    | Type       | Notes                                      |
| ----------------------------------------------------------------------------------------- | ---------- | ------------------------------------------ |
| `file`, `fileSize`, `fileMtimeMs`, `fileIdentity`, `prefixHash`, `tailHash`, `byteOffset` |            | change detection and resume point          |
| `title`, `firstAt`, `lastAt`, `cwd`, `gitBranch`, `version`                               | text       | from the summary                           |
| `cwdCounts`                                                                               | JSON map   | cwd hint to count, used by path resolution |
| `models`, `permissionModes`                                                               | JSON array |                                            |
| `messageCount`, `errorCount`, `malformed`                                                 | integer    |                                            |
| `toolUseCounts`, `unknownTypes`                                                           | JSON map   | name to count                              |
| `isSubagent`, `parentSessionId`, `parentToolUseId`                                        |            |                                            |
| token columns                                                                             |            |                                            |

### messages

Primary key `(sessionId, uuid)`; index `messages_session_offset(sessionId, byteOffset)`; `sessionId` references `sessions.id` (cascade).

| Column                               | Type              | Notes                                                        |
| ------------------------------------ | ----------------- | ------------------------------------------------------------ |
| `uuid`, `parentUuid`, `messageId`    | text              | `messageId` is the API message id used to de-duplicate usage |
| `type`, `role`, `timestamp`, `model` | text              |                                                              |
| `isSidechain`, `isMeta`              | boolean           |                                                              |
| `text`                               | text              | searchable plain text of the message                         |
| `toolNames`                          | JSON array        |                                                              |
| `toolUses`                           | JSON map          | tool-use id to tool name                                     |
| `usage`                              | JSON `TokenUsage` |                                                              |
| `byteOffset`, `byteLength`           | integer           | where the raw record lives in the transcript, for page reads |
| `errorCount`                         | integer           |                                                              |
| `costUsd`                            | real              |                                                              |

### messages_fts (virtual)

`CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid')`, kept in step by the `messages_ai`, `messages_ad` and `messages_au` triggers. Queries are built as quoted terms joined with `AND` (prefix match on the last term) so FTS syntax is literal.

### usage_daily

Primary key `(date, projectId, model, sessionId)`; `projectId` and `sessionId` cascade. One row per day, project, model and session, plus the token columns. `date` is a UTC calendar date; the usage route re-buckets by the requested IANA time zone.

### meta

`key` text PK, `value` text. Holds `schemaVersion` (plain string) and JSON values such as the last full scan time.

## Core in-memory entities

These are TypeScript types in `packages/core`; the HTTP shapes derived from them are in [contracts/http-api.md](contracts/http-api.md) and `@c9view/api`.

- **Project** (discovery): `id` (folder name), `dir`, `path`, `pathExists`, `pathSource`. Path rule: most common cwd hint whose Claude encoding equals the folder name, then the most common hint, then filesystem and decoded paths.
- **Transcript record** (`transcript/schemas.ts`): Zod-parsed JSONL line. Known types: `user`, `assistant`, `attachment`, `ai-title`, `last-prompt`, `mode`, `permission-mode`, `file-history-snapshot` and others listed in [docs/data-sources.md](../../docs/data-sources.md). Unknown types are kept as counts only. Unknown fields are tolerated.
- **Session summary** (`transcript/summary.ts`): title, `firstAt`, `lastAt`, cwd and `cwdCounts`, git branch, version, models, message count, tool-use counts, permission modes, error count, malformed and unknown-type counts, token totals.
- **Message**: role (user, assistant, system), timestamp, model, `isMeta`, `isSidechain`, blocks (`text`, `thinking`, `tool_use` with optional inline change, `tool_result`, `image`) and optional token usage.
- **Token usage** (`transcript/usage.ts`): input, output, cache-read, cache-creation (split 5-minute and 1-hour for pricing) and thinking tokens. Duplicate assistant records with the same message id count once.
- **Price** (`pricing/`): per-million-token rates per model from the bundled LiteLLM table (`bundled-prices.json`) plus an optional local override file; `resolvePrice` maps a model id to a price (family fallbacks), `costOf` multiplies. Unknown models cost 0.
- **Live session file** (`sessions/<pid>.json`): `status`, `statusUpdatedAt`, `updatedAt`, pid and `pidDomain`; liveness is a process check.
- **Hook event** (`hooks/events.ts`): `v: 1`, `ts`, `event` (one of the whitelisted names), `sessionId`, `cwd`, optional `toolName`, `notificationType`, `permissionMode`, `agentId`, `subagent`, `pid`. Fields are length-limited. Lines are appended to `events.jsonl` and rotated to `events.1.jsonl`; the tailer tracks inode and offset and keeps at most 2,000 sessions.
- **Status evidence**: `{source: hook | live-status | transcript | none, at, detail}`.
- **Status decision**: `column` (`inactive`, `in_progress`, `need_input`, `in_review`), `reason`, `source`, `observedAt`, `stale`, `confidence` (`high`, `medium`, `low`), `evidence` (last 200). Input: `now`, live file and liveness, PID-namespace mismatch flag, hook events, transcript facts (`lastAssistantPendingToolUse`, `lastAt`, `endedTurnAt`, `asksQuestion`).
- **Config item** (`claude-config/`): `name`, `description`, `scope` (`user`, `project`, `local`, `plugin`), `path`. Also hooks (`event`, `matcher`, `command`, `scope`), MCP servers (`name`, `transport`, `scope`), instructions (`path`, `content`, with `@includes`), memory entries (`name`, `description`, `type`, `body`), plugins (`id`, `enabled`, `version`, counts), and merged settings with a provenance map (key to source file).
- **Inline change / tool file change** (`changes/`): file path, kind (`create`, `update`), hunks (`oldStart`, `oldLines`, `newStart`, `newLines`, `lines`), additions, deletions, source (`structuredPatch` or `computed`), `userModified`, `tooLarge`.
- **File-history version** (`changes/history.ts`): file, version, backup file name, backup time, linked message; used for net diffs.
- **Changed file** (session): `fileId`, `filePath`, `relPath`, kind, additions, deletions, tool-use ids, first and last time. The diff endpoint returns net hunks, `source` (`file-history` or `tool-hunks`), `steps`, `tooLarge`, `partial`, `truncated`.
- **Project file entry** (`files/`): name, path, type (`file`, `dir`, `symlink`, `other`), size, mtime, and flags `denied` (with `reason`), `ignored`, `outside`.
- **Git status/diff** (`git/`): branch, ahead, behind, files with index/worktree codes and a status (`modified`, `added`, `deleted`, `renamed`, `untracked`); diff parsed to per-file hunks.
- **Index health**: `state` (`building`, `ready`, `error`), `progress` and `lastFullScanAt`.
- **Server config** (`config/index.ts`): `claudeDir`, `workspaceRoots`, `dbPath`.

## Server-side caches (not persisted)

- `DataStore.snapshot()`: all projects with their session summaries and status decisions, invalidated per project by watcher events.
- Per-session mapped-record LRU (`data/cache.ts`) holding per-message accounting while the transcript is hot.
- Hook tailer map: session id to its recent hook events.
- Session change sets (`cachedSessionChanges`) per session.
- `EventHub`: the set of SSE listeners (maximum 32).

## State and ownership

- Written by c9view: the SQLite index (cache dir), `events.jsonl` and its rotation (state dir) by `c9view hook`, and `settings.json` plus a backup by `c9view hooks install/uninstall`.
- Everything else is read-only input.
