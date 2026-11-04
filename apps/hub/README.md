# API server

The server builds and serves the SQLite index configured by `C9VIEW_DB`, watches for new Claude Code data, and never writes Claude data. `src/app.ts` exports `createApp(loadConfig())` for in-process use. `src/main.ts` starts the listener and warms transcript summaries in the background.

From the workspace root:

- `corepack pnpm --filter @c9view/server dev` uses core source files without a core build.
- `corepack pnpm build` builds core, server, and web for production.
- `corepack pnpm --filter @c9view/server start` runs the built server.
- `corepack pnpm --filter @c9view/server test` runs synthetic fixture tests without a core build.

`PORT` defaults to 7777 and accepts integers from 1 through 65535. `HOST` defaults to `127.0.0.1`. `C9VIEW_CLAUDE_DIR` selects the read-only data directory. `C9VIEW_WEB_DIST` overrides the default `apps/web/dist` static directory. Non-API GET routes fall back to its `index.html`.

Transcript summaries are invalidated by size/mtime changes and file replacement. Appended newline-terminated records are read from the last committed byte offset. Full records are retained for the 20 most recently requested session details. Other sessions retain summary/accounting metadata (including message/tool IDs needed to deduplicate incremental updates), without message bodies or tool inputs. Returning to an evicted session reloads its full transcript. Subagent transcripts are listed separately; their messages and usage are not merged into the parent.

To measure local data without emitting content:

```sh
C9VIEW_CLAUDE_DIR=~/.claude corepack pnpm --filter @c9view/server exec tsx --conditions=development test/benchmark.ts
```

The benchmark traverses all projects and up to five sessions per project twice in one process. Pass 0 starts with an empty cache; pass 1 reuses it. Later routes within pass 0 benefit from earlier reads, and the 20-session LRU still applies during pass 1. Numeric groups are 0 health, 1 overview, 2 projects, 3 global config, 4 project detail, and 5 session detail. Output includes only timings, counts, HTTP codes, and byte sizes. Kanban counts come from the final overview.
