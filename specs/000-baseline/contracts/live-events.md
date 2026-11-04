# Contract: Live events (SSE)

`GET /api/events` (`apps/server/src/routes/events.ts`, `data/events.ts`, `data/start-index.ts`). One-way server-sent events from the server to every open page. Events are hints to refetch; they carry ids only, never content.

## Transport

- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Subject to the same Host/Origin and login guards as any route (the cookie is sent by the browser's `EventSource`).
- The stream starts with `retry: 3000` (client reconnect delay, ms).
- A comment line `: heartbeat` is sent every 15 seconds.
- Backpressure: the stream buffer is 256 KiB; if a chunk would not fit the client is dropped (stream closed) and reconnects.
- At most 32 concurrent listeners; the next gets `503 {error: "Too many event clients"}`.
- Each message is `event: <name>\ndata: <JSON>\n\n`. There is no `id:` and no replay: after reconnect the web refetches.

## Event shapes (`LiveEvent` in `@c9view/api`)

| `event`   | `data`                                        | Emitted when                                                                                                                        |
| --------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `project` | `{ projectId }`                               | The watcher sees a project folder change                                                                                            |
| `session` | `{ projectId, sessionId }`                    | A session transcript changes (and the session's project is known)                                                                   |
| `status`  | `{ projectId, sessionId, column }`            | A session's decided column changes (checked about 250 ms after hook or file updates; the first sighting of a session emits nothing) |
| `config`  | `{}`                                          | A Claude config file changes                                                                                                        |
| `index`   | `{ state: "building" \| "ready" \| "error" }` | The index starts building, finishes its first scan, or fails                                                                        |

`column` is a `KanbanColumn`: `in_progress`, `need_input`, `in_review` or `inactive`.

## Client behaviour (`apps/web/src/live/`)

- One shared `EventSource` for the whole app.
- Each event invalidates the targeted TanStack Query keys (project, session, overview, config, usage, search as relevant) rather than patching data.
- Connection state is `connecting`, `live` or `offline`. After the stream has been down for 10 seconds the web falls back to polling queries every 5 seconds (including the cheap `.../status` endpoint for the open session) and stops polling when the stream is live again.
- `index` events refresh health so pages that returned 503 retry.
