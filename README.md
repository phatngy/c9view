# c9view

A web dashboard for your Claude Code projects, sessions, config and token usage.

c9view reads Claude data, project folders, process status and token prices, then shows them in your browser. It never modifies your transcripts, project files or git repositories. The only things it writes are its own SQLite index, hook events in its state folder, and Claude `settings.json` when you run `c9view hooks install` or `uninstall`.

## What it reads

- Claude data in `~/.claude` (or `C9VIEW_CLAUDE_DIR`): transcripts, live session files, settings, file-history backups, stats, history, skills, agents, commands, plugins and memory. It also reads `.claude.json` next to the Claude data directory (normally `~/.claude.json`), read-only for MCP configuration.
- Project folders discovered from transcript `cwd` values and `C9VIEW_WORKSPACE_ROOTS`: project `.claude/` settings, `CLAUDE.md` and its `@includes`, `.mcp.json`, files shown in the file browser, and git status and diffs.
- Checks whether each session's process is still running.
- A bundled LiteLLM price table, for API-equivalent cost estimates.

c9view writes its SQLite index (`C9VIEW_DB`) and hook events in its state folder (`C9VIEW_STATE_DIR`). It changes Claude's `settings.json` only through `c9view hooks install` or `uninstall`.

## Features

- **Sessions on a board.** Each project's sessions sit in four columns (_Need input_, _In progress_, _In review_, _Inactive_), worked out from hooks, live status files and the transcript. Every card says why it's in its column, and is marked stale when the signals disagree.
- **Readable conversations.** Chat-style transcripts with collapsible tool calls, thinking blocks, subagent trees, a prompt outline, in-session search, and export to Markdown or JSON. Sessions with 10,000+ messages stay fast.
- **Files and diffs.** Inline diffs on every Edit and Write, a "files changed" panel with the net diff per session, a read-only project file browser, and working-tree changes against `HEAD`.
- **Tokens and cost.** Usage per day, model and project, cache-hit ratio, per-turn tokens and context-window fill, with an API-equivalent cost estimate.
- **Config in one place.** Global and project settings (with where each value comes from), hooks, permissions, MCP servers, plugins, `CLAUDE.md`, skills, agents, commands and memory, with secrets hidden.
- **Search** across all conversations, filtered by project, date or model.
- **Live updates** on every open page, light and dark themes, and layouts for phones.

## Quick start

Requires Node 22 or newer. Until the npm package is published, run it from a checkout:

```sh
git clone https://github.com/phatngy/c9view.git
cd c9view
corepack enable
corepack pnpm install
corepack pnpm build
node packages/cli/dist/main.js --open
```

The dashboard opens at `http://127.0.0.1:7777`. Other commands include `scan --json` and `hooks status|uninstall`; start flags include `--port`, `--host`, `--claude-dir`, `--db` and `--auth`. See [docs/deploy.md](docs/deploy.md) for details.

For more reliable session status, install the Claude Code hooks. c9view shows the change to your `settings.json` and backs it up before writing:

```sh
node packages/cli/dist/main.js hooks install
```

## Security and privacy

Your conversations can contain secrets, so c9view is careful about what it exposes:

- It listens on `127.0.0.1` only. Listening on any other address, or allowing extra hostnames, requires login (`--auth token` or `--auth password`).
- Login is never skipped for loopback requests, so it stays safe behind a tunnel.
- API keys and tokens are hidden in config and conversation views. Project file access is limited to the project folder and skips `.env*`, keys and credentials.
- Git is only run in read-only mode, and in Docker all data is mounted read-only.

To reach it from another device, see [docs/deploy.md](docs/deploy.md) for Docker, Tailscale and Cloudflare Tunnel setups.

## Status and roadmap

c9view is in active development and not yet released on npm.

| Area                                                                                                | Status       |
| --------------------------------------------------------------------------------------------------- | ------------ |
| Data reading and SQLite index, with live file watching and `c9view scan`                            | ✅ Shipped   |
| Session status board (hooks, live status files, transcript rules) and `c9view hooks install`        | ✅ Shipped   |
| Web screens: Overview, project board and tabs, session page, global config                          | ✅ Shipped   |
| Files and diffs: inline diffs, files-changed panel, file browser, git changes                       | ✅ Shipped   |
| Analytics: token and cost charts, global search, export                                             | ✅ Shipped   |
| Visual design: component kit, app shell, chat-style sessions, phone layouts, IBM Plex typography    | ✅ Shipped   |
| Packaging: CLI, optional login, Docker and Compose, Tailscale and Cloudflare Tunnel guide           | ✅ Shipped   |
| Release: npm package and container image                                                            | 🔜 Next      |
| Components: split into web UI, hub and node; machine-scoped API; response budgets; one state folder | 📐 Specified |
| Session control (opt-in): reply, approve, answer questions and start sessions through the Agent SDK | 📐 Specified |
| Multiple machines: one hub dashboard for nodes on several machines, with pairing                    | 📐 Specified |
| Edit configs from the web                                                                           | 💭 Planned   |
| Codex support through the data-source layer                                                         | 💭 Planned   |

"Specified" features have a full spec, plan and tasks in [specs/](specs/). Task-level progress, including small open follow-ups, is in each feature's `tasks.md` under [specs/](specs/); the roadmap is in [specs/README.md](specs/README.md).

## How it's built

TypeScript throughout: a browser-facing hub relays requests to a node package that indexes Claude data and project files into SQLite, with a React 19 + Vite + TanStack web app. The project is developed with [Spec Kit](https://github.com/github/spec-kit) (feature specs in [specs/](specs/), principles in the [constitution](.specify/memory/constitution.md)) and largely written by AI agents. [docs/ai-workflow.md](docs/ai-workflow.md) describes how.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

c9view is an independent project and is not affiliated with Anthropic.
