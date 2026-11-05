# Contract: Hub HTTP API (browser ↔ hub)

Types in `@c9view/api` (`machines.ts`). All paths go through login (when enabled) and the Host and Origin checks, except `/api/nodes/connect` (Host only, key challenge; FR-030).

## Hub-owned routes (match before the alias)

| Route                                  | PR       | Response                                                                                                                                                           |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                      | 6.0b     | Hub only: `{ ok, version, auth, machines: number }`. Through 7c also a deprecated copy of the `local` node's health fields.                                        |
| `GET /api/machines`                    | 6.0b, 7c | `MachineSummary[]` (one `local` entry until 7c).                                                                                                                   |
| `GET /api/events`                      | 6.0b     | SSE; each data event is a `MachineEvent` or a `MachineStateEvent`. Hub owns framing, heartbeats, slow-client disconnect.                                           |
| `GET /api/nodes/connect`               | 7b       | WebSocket upgrade for nodes only ([ws-frames.md](ws-frames.md)).                                                                                                   |
| `POST /api/machines/pair`              | 7b       | `{ code, expiresAt }`; login required, same mutation guard as revoke. Used by the Machines page; `c9view hub pair` writes the code hash to the hub store directly. |
| `POST /api/machines/:machineId/revoke` | 7c       | 204; closes the socket at once. Same guard as control (002 `guard.ts`: JSON POST, Origin, `X-C9view-Control: 1`).                                                  |
| login, logout                          | existing | unchanged                                                                                                                                                          |

## Machine-scoped relay

| Route                          | Behaviour                                                   |
| ------------------------------ | ----------------------------------------------------------- |
| `GET                           | POST /api/m/:machineId/*`                                   | Relayed to that machine's transport as a `NodeRequest` (node-relative path). Unknown machine → 404; offline → 503 `{ reason: 'offline' }`. |
| `GET /api/m/:machineId/health` | Node health (index progress, hooks installation and files). |
| `GET                           | POST /api/*` (anything not hub-owned)                       | Alias for `local` only; 404 with `--no-local`. Guards and login apply exactly as through `/api/m/local/*`.                                 |

## Merged endpoints (7a)

`GET /api/overview`, `GET /api/projects`, `GET /api/usage` with no machine: every machine's answer merged; each item has `machineId`; machines that miss `C9VIEW_MERGE_TIMEOUT_MS` are listed in `partial: MachineId[]`. Offline machines contribute their last snapshot (projects and sessions), marked offline. Before 7a these paths are the `local` alias. Search stays per machine.

## Paged responses (6.0c)

Fields are additive. Each route keeps its list field: session pages use `messages`, search `results`, directory listings `entries`, git status and diffs `files`, and session changes `files`.

Session pages keep number cursors (`cursor`, `prevCursor`, `nextCursor`) and `totalMessages`. A forward page keeps the start of its window; `from=end` and `fill=end` keep its end. `truncated: true` means the page stopped before its window ended or contains a cut message (`message.truncated`). With `fill=end`, optional `before=<n>` limits the window to `[cursor, min(cursor + limit, before))`; pass the later page’s cursor as `before` to avoid overlap when `prevCursor` is clamped.

Search, file listings, git status, git diff, and session changes return `nextCursor` as an opaque string; pass it as `?cursor=` to continue. A malformed cursor returns 400. A git diff file or session file diff cut to fit has `truncated: true`. A file over the file budget returns metadata with `tooLarge: true` and `notice: 'too-large'`, without `content`.

## Web routes (6.0b)

`/m/$machineId/…` for every page; old paths redirect to `/m/local/…` with the rest of the path and query kept.
