# Contract: CLI

Binary `c9view` (`packages/cli`, `bin: ./dist/main.js`; packages are `private` and not yet published). Argument parsing is `node:util.parseArgs` in `packages/cli/src/main.ts`.

## Commands

| Command                    | Behaviour                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c9view` or `c9view start` | Starts the server and serves the built web app. Prints `c9view listening at http://<host>:<port>` and, with login on, `Login: <url>/login` (and `Token: ...` on a TTY only)                                                                          |
| `c9view scan [--json]`     | Reads and indexes the Claude data, prints the summary (counts, tokens, unknown record types); `--json` prints one JSON object                                                                                                                        |
| `c9view hooks install`     | Shows the diff to `settings.json`, backs it up, then writes after confirmation (skip with `--yes`)                                                                                                                                                   |
| `c9view hooks uninstall`   | Same flow, removing c9view's hook entries                                                                                                                                                                                                            |
| `c9view hooks status`      | Reports whether hooks are installed                                                                                                                                                                                                                  |
| `c9view hook`              | Silent hook receiver that Claude Code runs; reads the payload from stdin, appends a whitelisted event line to `events.jsonl`, always exits 0 with no output. Handled before argument parsing, importing only the built hook module of `@c9view/core` |
| `--help`, `-h`             | Prints usage                                                                                                                                                                                                                                         |

Anything else prints a usage error and exits with code 1.

## Flags

| Flag                           | Applies to         | Meaning                                                                           |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| `--port <n>`                   | start              | Port, default 7777 (integer 1..65535)                                             |
| `--host <addr>`                | start              | Bind host, default `127.0.0.1`                                                    |
| `--auth none\|token\|password` | start              | Login mode, default `none`                                                        |
| `--allowed-host <name>`        | start              | Extra allowed Host/Origin name; repeatable; combined with `C9VIEW_ALLOWED_HOSTS`  |
| `--open`                       | start              | Open the printed URL in the default browser (never with a token in the arguments) |
| `--db <path>`                  | start, scan        | SQLite index path                                                                 |
| `--claude-dir <path>`          | start, scan, hooks | Claude data directory                                                             |
| `--json`                       | scan               | JSON output                                                                       |
| `--yes`                        | hooks              | Skip the confirmation prompt                                                      |

Flags override environment values, except allowed hosts, which are combined.

## Environment variables

| Variable                  | Default                                            | Meaning                                                                   |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `PORT`                    | 7777                                               | Listen port (used when `--port` is absent)                                |
| `HOST`                    | `127.0.0.1`                                        | Bind host; also added to the allowed hosts                                |
| `C9VIEW_CLAUDE_DIR`       | `~/.claude`                                        | Claude data directory                                                     |
| `C9VIEW_WORKSPACE_ROOTS`  | none                                               | Extra workspace roots, separated by the OS path delimiter                 |
| `C9VIEW_DB`               | `<cache dir>/c9view/index.sqlite`                  | Index database path (refused inside the Claude data directory)            |
| `C9VIEW_STATE_DIR`        | `$XDG_STATE_HOME/c9view` (`~/.local/state/c9view`) | Hook events folder                                                        |
| `C9VIEW_AUTH`             | `none`                                             | `none`, `token` or `password`                                             |
| `C9VIEW_TOKEN`            | generated per start                                | Login token, at least 32 characters; required without a TTY in token mode |
| `C9VIEW_PASSWORD`         | none                                               | Login password; required in password mode                                 |
| `C9VIEW_ALLOWED_HOSTS`    | none                                               | Comma-separated hostnames (tunnels)                                       |
| `C9VIEW_TRUST_PROXY`      | off                                                | `1` trusts `X-Forwarded-For` and `X-Forwarded-Proto`                      |
| `C9VIEW_INSECURE_NO_AUTH` | off                                                | `1` allows a non-loopback start without login, with a warning             |
| `C9VIEW_WEB_DIST`         | repository `apps/web/dist`                         | Built web directory; start fails if `index.html` is missing               |

Compose-only variables (`docker-compose.yml`): `C9VIEW_UID`, `C9VIEW_GID`, `C9VIEW_DATA`, `C9VIEW_WORKSPACE`.

Docker defaults (`Dockerfile`): `HOST=0.0.0.0`, `C9VIEW_AUTH=token`, `C9VIEW_CLAUDE_DIR=/data/claude`, `C9VIEW_DB=/var/lib/c9view/index.sqlite`, `C9VIEW_STATE_DIR=/data/c9view-state`, `C9VIEW_WEB_DIST=/app/web-dist`, port 7777, health check on `/api/health`.

## Startup rules

- `validateExposure`: with `--auth none`, a non-loopback host or any allowed host fails with "Non-loopback HOST or extra allowed hosts require login" unless `C9VIEW_INSECURE_NO_AUTH=1` (warning printed).
- Token auth without a TTY and without `C9VIEW_TOKEN` fails to start.
- `C9VIEW_TOKEN` shorter than 32 characters fails to start; `C9VIEW_PASSWORD` missing in password mode fails.
- `SIGINT` and `SIGTERM` close the server and the index.
