# Running c9view

c9view reads Claude data and project files. With control off, dashboard access is read-only. With control on, Claude Code processes started by c9view write their own data. Hooks install/uninstall are explicit host commands that change Claude settings.

## Local CLI

Requires Node 22 or newer. From a source checkout:

```sh
corepack pnpm install
corepack pnpm build
node packages/cli/dist/main.js start --open
```

Once the npm release is published, use `npx c9view` (no command means `start`). The npm package is not published yet.

The default is `http://127.0.0.1:7777`. Options: `--port`, `--host`, `--claude-dir`, `--db`, `--open`, repeatable `--allowed-host`, and `--auth none|token|password`. Environment equivalents are `PORT`, `HOST`, `C9VIEW_CLAUDE_DIR`, `C9VIEW_DB`, `C9VIEW_ALLOWED_HOSTS` (comma separated), `C9VIEW_AUTH`, and `C9VIEW_WORKSPACE_ROOTS` (extra workspace roots, separated by the platform path delimiter such as `:` on Linux/macOS, used to resolve projects; read by `packages/core/src/config/index.ts`). Flags override environment values; allowed hosts are combined. `C9VIEW_WEB_DIST` overrides the built web directory. Missing builds fail with instructions.

```sh
node packages/cli/dist/main.js --auth token
C9VIEW_PASSWORD='choose-a-long-password' node packages/cli/dist/main.js --auth password
```

Token mode generates a random token per start, or uses `C9VIEW_TOKEN` (at least 32 characters; shorter values fail startup). Open `/login` and paste the token into the form to receive an HttpOnly, SameSite=Strict cookie. Interactive terminals print the token separately. Redirected output and container logs print only the bare login URL: set `C9VIEW_TOKEN` before starting and use that value to log in. `--open` opens a bare URL and never passes the token in browser process arguments. Credentials are not stored on disk.

Password failures use a per-client exponential backoff: 1, 2, 4 seconds, doubling to a 60-second cap. Password checks are blocked while a client is in backoff because passwords are guessable. Token checks verify the token first, so a correct token always logs in and clears that client's backoff; wrong tokens during backoff receive HTTP 429. A rolling global cap permits 60 failures/minute across all clients. HTTP 429 includes `Retry-After` in seconds. Backoff history expires after five idle minutes. Sessions expire after 24 hours and all sessions are invalidated on restart.

## Session control

Control is off by default. Enable it on the machine that runs sessions with `--control` or `C9VIEW_CONTROL=1`:

```sh
node packages/cli/dist/main.js --control --auth token
```

Login is always required with control, including on loopback. Set `C9VIEW_AUTH=token` (and `C9VIEW_TOKEN` when running without a terminal) or use `--auth password` with `C9VIEW_PASSWORD`. `C9VIEW_INSECURE_NO_AUTH=1` cannot override this requirement. The hub also refuses a node reporting control ready or unavailable when hub authentication is disabled.

Sessions use the Claude login available to the OS user running the node, or that node process's `ANTHROPIC_API_KEY` environment value. Dashboard login authenticates access to c9view; it does not supply Claude credentials. Claude Code runs on the node and writes its own session and project data. The Claude data directory and projects must be writable; the default read-only Docker mounts are intended for reading data and cannot run control sessions.

The node chooses `C9VIEW_CLAUDE_BIN` when set, otherwise `claude` on PATH, otherwise the Agent SDK's bundled binary. An invalid explicit binary or no available executable refuses startup; set `C9VIEW_CLAUDE_BIN` to an executable Claude Code binary. The node reports the binary/version it uses.

`--bypass` or `C9VIEW_CONTROL_BYPASS=1` requires control. It applies to every c9view run on that node, including resumed and forked sessions, and runs cannot leave bypass mode. Every startup warns: **every c9view run skips tool permission approvals**. The browser cannot turn bypass on. Enable it only when you intend to allow those tools to run without approval.

## c9view state folder

c9view keeps its persistent state in `~/.claude/c9view/`, overridden by `C9VIEW_STATE_DIR`. The SQLite index remains a rebuildable cache at `C9VIEW_DB`. The default state folder follows `HOME`, independently of `C9VIEW_CLAUDE_DIR` and `XDG_STATE_HOME`. Claude data readers ignore the state folder, including aliases inside the Claude directory.

With a custom Claude directory, set an absolute `C9VIEW_STATE_DIR` for c9view and reinstall hooks using that same environment. `hooks install` embeds a non-default resolved path in the command as `--c9view-state-dir '<dir>'`; reinstalling replaces an earlier path. This argument wins over the hook process's environment, since Claude Code may run in a different environment. The default path needs no argument.

Hooks create directories 0700 and files 0600, tighten their own directory, and silently skip symlinked or foreign-owned state folders and symlinked files. Symlinked ancestors, such as `~/.claude`, are supported. Node/hub startup checks are read-only and allow a missing folder: existing wider permissions stop startup and print the exact `chmod 700 '<dir>'` or `chmod 600 '<file>'` command; they never tighten automatically. Symlinks and foreign owners are refused. Back up persistent state before upgrades; losing a paired node identity requires pairing again.

Legacy hook events are read without writing, moving or deleting them. Set `C9VIEW_LEGACY_STATE_DIR` to name the old folder explicitly; without it the old `${XDG_STATE_HOME:-~/.local/state}/c9view` is read only when `C9VIEW_STATE_DIR` is unset. `hooks status` and node health report both event paths (`legacyEventsFile` is null when disabled); status also reports both sizes and merged event counts.

## Docker and Compose

```sh
export C9VIEW_UID="$(id -u)" C9VIEW_GID="$(id -g)"
export C9VIEW_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
export C9VIEW_WORKSPACE="$HOME/workspace" # choose an existing workspace root
mkdir -p "$HOME/.claude/c9view" "$HOME/.local/state/c9view" "${C9VIEW_DATA:-$HOME/.local/share/c9view}"
chmod 700 "$HOME/.claude/c9view"
docker build -t c9view:local .
docker compose up -d
docker compose logs c9view
```

Open `http://127.0.0.1:7777/login` and paste your `C9VIEW_TOKEN` value. Keep that environment value available when recreating the service. Compose requires it and will fail if absent.

`C9VIEW_UID` and `C9VIEW_GID` select the host owner (`id -u` and `id -g`), defaulting to 1000:1000. This preserves access to private 0700 Claude and hook directories without changing their permissions. The writable SQLite cache is a bind mount from `${C9VIEW_DATA:-${HOME}/.local/share/c9view}`; create it first as that user. The image also supports arbitrary non-root UIDs with `--user`: it writes no app data under `/app`, and `HOME=/tmp` uses the writable tmpfs. The root filesystem stays read-only, capabilities are dropped, and privilege escalation is disabled.

Before starting Compose, create the host state folder with `mkdir -m 700 -p ~/.claude/c9view` (or run the hook once). The dashboard does not create it. All bind mounts use `create_host_path: false`: the Claude directory, hook state directory, workspace and DB directory must already exist. A typo fails instead of silently creating root-owned directories. The image binds `0.0.0.0` with token authentication; Compose publishes only to host loopback.

Projects resolve from transcript `cwd` values. Compose mounts `${C9VIEW_WORKSPACE:-${HOME}/workspace}` at that same absolute path. For several workspace roots, add one long-syntax read-only bind for each, keeping source and target identical:

```yaml
volumes:
  - type: bind
    source: /srv/code
    target: /srv/code
    read_only: true
    bind: { create_host_path: false }
  - type: bind
    source: /srv/other
    target: /srv/other
    read_only: true
    bind: { create_host_path: false }
```

Install hooks on the host explicitly, before using Docker:

```sh
node packages/cli/dist/main.js hooks install
node packages/cli/dist/main.js hooks status
```

Compose mounts `~/.claude/c9view` writable at `/data/claude/c9view`, over the read-only `/data/claude` mount; the image sets `C9VIEW_STATE_DIR=/data/claude/c9view`. Match the host state path if customized. The legacy `~/.local/state/c9view` mount remains read-only at `/data/c9view-state`, with `C9VIEW_LEGACY_STATE_DIR=/data/c9view-state` set in Compose because the image uses `HOME=/tmp` and an explicit state directory. Remove that environment entry and its mount together once legacy events no longer matter. A hub-only deployment should set `C9VIEW_STATE_DIR` to its own writable volume and omit Claude and workspace mounts. Containers cannot normally inspect host PIDs. Hooks and live status files still provide evidence with lower confidence. Optionally uncomment `pid: host` on Linux to enable host process checks; this grants visibility into host processes.

## Tunnels and remote access

Two rules always apply:

1. Login is never skipped for loopback requests. Tunnel agents send remote traffic from `127.0.0.1`, so trusting local peers would expose all data to anyone with the tunnel URL.
2. Extra allowed hosts (`C9VIEW_ALLOWED_HOSTS` or `--allowed-host`) or any non-loopback `HOST` require authentication. The server refuses to start otherwise. Allowed hosts are hostnames without schemes or ports; list tunnel hostnames explicitly.

Prefer direct Tailscale access: bind to your machine's Tailscale IP, enable login and allow the hostname used by browsers. Restrict access with your tailnet policy.

```sh
HOST=100.64.0.10 C9VIEW_AUTH=token C9VIEW_ALLOWED_HOSTS=dashboard.example.ts.net node packages/cli/dist/main.js
```

Open `/login` on the Tailscale hostname/IP that you visit and paste the token. For HTTPS termination with Tailscale Serve, keep c9view bound to loopback, allow the HTTPS hostname, and forward to `http://127.0.0.1:7777`. Set `C9VIEW_TRUST_PROXY=1` for Tailscale Serve so `X-Forwarded-Proto: https` produces a Secure cookie and client addresses have separate backoff keys.

If you use password auth behind a tunnel, set `C9VIEW_TRUST_PROXY=1` so each client is keyed separately; otherwise anyone using the tunnel can delay your logins. Prefer token auth behind tunnels.

For Cloudflare Tunnel, configure a public hostname such as `dashboard.example.com` with upstream `http://127.0.0.1:7777`. Create a Cloudflare Access application and an allow policy for your identity before exposing it. Start c9view with:

```sh
C9VIEW_TRUST_PROXY=1 C9VIEW_AUTH=token C9VIEW_ALLOWED_HOSTS=dashboard.example.com node packages/cli/dist/main.js
```

Visit `https://dashboard.example.com/login` and paste the token. Set `C9VIEW_TRUST_PROXY=1` for Cloudflare Tunnel so forwarded HTTPS produces a Secure cookie and forwarded client addresses separate backoff keys. Access is an extra gate; c9view login remains required. In Compose, add `C9VIEW_ALLOWED_HOSTS` under environment and recreate the service. A host tunnel agent can use the loopback published port.

If you use password auth behind Cloudflare Tunnel, set `C9VIEW_TRUST_PROXY=1` so each client is keyed separately; otherwise anyone using the tunnel can delay your logins. Prefer token auth behind tunnels.

Set `C9VIEW_TRUST_PROXY=1` only when a trusted proxy controls forwarded headers and clients cannot bypass it. This honors `X-Forwarded-Proto: https` for Secure cookies and uses the first `X-Forwarded-For` address for rate limits. Configure the proxy to replace untrusted forwarded headers. Without proxy trust, rate limiting uses the socket peer (all tunnel users may share one bucket).

Multiple machines and session control are specified in [001-multi-machine](../specs/001-multi-machine/spec.md) and [002-session-control](../specs/002-session-control/spec.md). The planned layout is the hub in Docker and a native node per machine, and with session control or a paired node login is always required.

`C9VIEW_INSECURE_NO_AUTH=1` overrides the read-only exposure startup refusal when auth is `none` and prints a loud warning every start. It does not enable auth or protect data. It is unsafe behind tunnels, even when the listener is loopback. Avoid it for any remotely reachable deployment.

## Image verification

To check an image, build it and run it as your own UID against empty synthetic data (no real Claude files):

```sh
docker build --no-cache -t c9view:local .
C9VIEW_VERIFY_DIR="$(mktemp -d)"
mkdir -p "$C9VIEW_VERIFY_DIR/claude/projects" "$C9VIEW_VERIFY_DIR/state" "$C9VIEW_VERIFY_DIR/db" "$C9VIEW_VERIFY_DIR/workspace"
chmod 700 "$C9VIEW_VERIFY_DIR" "$C9VIEW_VERIFY_DIR/claude" "$C9VIEW_VERIFY_DIR/state" "$C9VIEW_VERIFY_DIR/db"
export C9VIEW_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
docker run -d --name c9view-verify --user "$(id -u):$(id -g)" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:7777:7777 -e C9VIEW_TOKEN \
  --mount "type=bind,src=$C9VIEW_VERIFY_DIR/claude,dst=/data/claude,readonly" \
  --mount "type=bind,src=$C9VIEW_VERIFY_DIR/state,dst=/data/claude/c9view" \
  --mount "type=bind,src=$C9VIEW_VERIFY_DIR/db,dst=/var/lib/c9view" \
  --mount "type=bind,src=$C9VIEW_VERIFY_DIR/workspace,dst=$C9VIEW_VERIFY_DIR/workspace,readonly" \
  c9view:local
docker logs c9view-verify
curl --fail http://127.0.0.1:7777/api/health
curl -i http://127.0.0.1:7777/api/projects
curl --fail -c "$C9VIEW_VERIFY_DIR/cookies" --get --data-urlencode "token=$C9VIEW_TOKEN" http://127.0.0.1:7777/login
curl --fail -b "$C9VIEW_VERIFY_DIR/cookies" http://127.0.0.1:7777/api/projects
docker exec c9view-verify node --input-type=module -e "import { createRequire } from 'node:module'; const cli = createRequire('/app/package.json'); const core = createRequire(cli.resolve('@c9view/core')); const Database = core('better-sqlite3'); const db = new Database(':memory:'); console.log(db.prepare('select 1 as ok').get()); db.close(); console.log('uid', process.getuid())"
docker restart c9view-verify
# After health returns, the old cookie must receive HTTP 401:
curl -i -b "$C9VIEW_VERIFY_DIR/cookies" http://127.0.0.1:7777/api/projects
docker rm -f c9view-verify
rm -rf "$C9VIEW_VERIFY_DIR"
```

Wait for health before HTTP checks. Expect minimal unauthenticated health (`ok`, `version`, `auth: "required"`), 401 before login, and 200 with an empty projects list after login. Logs must contain no token. Check that the DB was created under the host-owned DB directory. For Compose, export the UID/GID, token and existing workspace as above, then run `docker compose config` and `docker compose up -d --build`; deliberately missing bind sources should fail.

Deployment packages use `files: ["dist", "README.md"]`; the core migration SQL is embedded in `dist/index-db/migration.js`. The hub (`apps/hub`) depends on the node package (`packages/node`) for data reads and routes. The API package contains TypeScript contracts only, with no runtime imports; the web dist is copied separately into the image.
