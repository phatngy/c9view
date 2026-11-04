# Contract: HTTP API

Every route the server serves today (`apps/server/src/app.ts` and `routes/*`). Types are in `@c9view/api` (`packages/api/src/index.ts`). All `/api` routes except login are `GET` and return JSON; times are ISO-8601, token counts are integers, costs are API-equivalent USD estimates. Every response body passes through the secret redactor. 001-multi-machine later scopes these paths as `/api/m/:machineId/...`; this contract is the single-machine form.

## Request guards (before any route)

1. **Host and Origin**: the `Host` header's hostname must be `localhost`, `127.0.0.1`, `[::1]`, the bind host, `--allowed-host`/`C9VIEW_ALLOWED_HOSTS` entries, or `HOST`. A present `Origin` (http or https, no credentials) must also be allowed. Otherwise `403 {error: "Forbidden"}`.
2. **Auth** (only with `--auth token|password`): see Login below.
3. Errors: `ApiError` is `{ error: string }`. Unhandled errors give `500 {error: "Internal server error"}`. Unknown `/api` and `/api/*` give `404 {error: "Not found"}`.
4. Static: when a web build exists, the server serves files from `C9VIEW_WEB_DIST` and falls back to `index.html` for non-API paths (SPA routes).

## Login (auth middleware, not in `@c9view/api`)

| Route             | Behaviour                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /login`      | The SPA login page is public. `GET /login?token=<t>` logs in with the token (sets the `c9view_session` cookie, redirects to `/`); a wrong token gives 401 `{error: "Invalid credentials", auth}` or 429 with `Retry-After` |
| `POST /api/login` | Password mode only. Body `application/json` `{password}` (max 4096 chars). 200 `{ok: true}` and cookie; 401 invalid; 415 wrong content type; 429 throttled                                                                 |
| other             | Without a valid cookie: `GET /api/health` returns `{ok: true, version, auth: "required"}`; `GET /assets/*.js                                                                                                               | css` pass; page loads (`Accept: text/html`) redirect to `/login`; everything else is `401 {error: "Login required", auth}` |

Cookie: `c9view_session`, HttpOnly, SameSite=Strict, path `/`, 24 hours, `Secure` over https or behind a trusted proxy. Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Routes

### GET /api/health

Response `HealthResponse`: `{ ok: true, version, claudeDir, hooks?, index? }`. `index` is `IndexHealth` (`state`, `progress?`, `lastFullScanAt`); `hooks` is the hook status (`installed`, `eventsFile`, `lastEventAt`). `claudeDir` is redacted.

### GET /api/overview

Response `OverviewResponse`: counts (`projectCount`, `sessionCount`, `liveSessionCount`), `columns` per `KanbanColumn`, all-time `tokens`, `costUsd`, `daily` from `stats-cache.json` (or null), and `byModel`.

### GET /api/projects

Response `ProjectsResponse`: `{ projects: ProjectSummary[] }` (id, name, path, `pathExists`, `sessionCount`, `lastActivityAt`, `columns`, `tokens`, `costUsd`).

### GET /api/projects/:projectId

Response `ProjectDetailResponse`: `project`, `sessions: SessionSummary[]` (with `status: SessionStatus`), and `config` (skills, agents, commands, hooks, MCP servers, instructions, memory, effective settings). 404 `Project not found`.

### GET /api/projects/:projectId/sessions/:sessionId

Query:

| Param      | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `cursor`   | Absolute message offset (integer, default 0)                        |
| `from=end` | Return the newest `limit` messages (takes precedence over `cursor`) |
| `limit`    | Page size, default 200, clamped to 1..1000                          |

Response `SessionDetailResponse`: `session`, `cwd`, `version`, `permissionModes`, `toolUseCounts`, `errorCount`, `byModel`, `subagents`, `messages: Message[]`, `cursor`, `prevCursor`, `nextCursor`, `totalMessages`. 404 `Session not found`. Reads from the index when ready, otherwise from the cached transcript.

### GET /api/projects/:projectId/sessions/:sessionId/status

Cheap polling. Response `SessionPollResponse`: `{ status: SessionStatus, totalMessages, lastAt }`.

### GET /api/projects/:projectId/sessions/:sessionId/status/history

Response `StatusHistoryResponse`: `{ changes: { at, column, reason, source }[] }`.

### GET /api/projects/:projectId/sessions/:sessionId/changes

Response `SessionChangesResponse`: `{ files: SessionChangedFile[], truncated? }`. 404 `Project not found` / `Session not found`.

### GET /api/projects/:projectId/sessions/:sessionId/changes/:fileId

Response `SessionFileDiffResponse` (net hunks, counts, `source`, per-step `ToolFileChange[]`, `tooLarge`, `partial`, `truncated?`). 404 `File change not found`.

### GET /api/projects/:projectId/files

Query `path` (project-relative folder, default root). Response `FileListResponse`: `{ path, entries: ProjectFileEntry[] }`. 404 `Project not found`; 400 `Path unavailable or forbidden`.

### GET /api/projects/:projectId/file

Query `path`. Response `FileContentResponse`: `{ path, size, language, binary, tooLarge, content? }` (content only for text files up to the size limit, redacted). Same errors.

### GET /api/projects/:projectId/git/status

Response `GitStatusResponse`: `{ isRepo: false }` or `{ isRepo: true, branch, ahead, behind, files[] }`. 400 or 504 `Git read failed`.

### GET /api/projects/:projectId/git/diff

Query `path` (optional). Response `GitDiffResponse`: `{ isRepo, files: { oldPath, path, hunks }[] }`.

### GET /api/config

Response `GlobalConfigResponse`: redacted merged `settings`, `provenance` (key to source), `hooks`, `skills`, `agents`, `commands`, `plugins`, `mcpServers`, `instructions`.

### GET /api/usage

Query:

| Param        | Meaning                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `from`, `to` | Inclusive `YYYY-MM-DD`, validated as real dates; default last 30 days ending today in `tz` |
| `tz`         | IANA time zone, default `UTC`                                                              |
| `projectId`  | Optional single project                                                                    |

Response `UsageResponse`: `tz`, `from`, `to`, `days` (each with `byModel`), `byProject`, `byModel`, `totals`, `cacheHit` (`ratio` per day, null when no input). Errors: 400 `Invalid usage parameters`; 400 `Usage range must be between 1 and 366 days`; 503 `Charts are available once indexing finishes`.

### GET /api/search

Query:

| Param                | Meaning                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `q`                  | Required, trimmed, 1..500 characters, not only control characters |
| `projectId`, `model` | Optional filters                                                  |
| `from`, `to`         | Optional `YYYY-MM-DD` (optionally followed by a time)             |
| `limit`              | Default 50, maximum 200                                           |
| `cursor`             | Non-negative integer offset from the previous `nextCursor`        |

Response `SearchResponse`: `{ results: { projectId, sessionId, messageUuid, timestamp, role, model, snippet, cutStart?, cutEnd?, highlights: [start, end][] }[], nextCursor }`. Snippets are redacted, about 240 characters starting up to 80 before the first match. Errors: 400 `Invalid search parameters`; 503 `Search is available once indexing finishes`.

### GET /api/events

Server-sent events; see [live-events.md](live-events.md). 503 `Too many event clients` at 32 listeners.

## Status codes summary

200 success; 400 invalid parameters or forbidden path; 401 login required; 403 Host/Origin refused; 404 not found; 415 wrong login content type; 429 login throttled; 500 internal; 503 index not ready or too many event clients; 504 git timeout.
