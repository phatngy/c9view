# Design notes: Components and Multiple Machines

Input for `/speckit-plan` on [spec.md](spec.md). This file keeps the implementation detail that `spec.md` leaves out: the component table, the `NodeTransport` envelopes, the WebSocket frames, byte budgets and deadlines, the PR split with the files each PR owns, data shapes, and the full test lists. The text under "Design draft source text" is copied verbatim from the earlier design draft `multi-machine.md`, with headings demoted one level, links repointed, and the node state paths changed from `~/.local/state/c9view/node/` to `~/.claude/c9view/node/` per the 2026-11-04 clarifications. Where it and `spec.md` differ, `spec.md` and its clarifications win.

## Requirement mapping

`spec.md` keeps the design draft's numbers: FR-001 is R1, … FR-029 is R29. FR-030 is new (Host/Origin rule for the node connection path, from the constitution check). The design draft's acceptance criteria per PR (6.0a, 6.0b, 6.0c, Step 7 server, 7e, Docker, web, manual check) became User Stories 1–6 in `spec.md`; the complete test lists are below and should become `tasks.md` test tasks.

| Design draft                           | spec.md                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Problem and users                      | Context; User Stories 1–6                                                     |
| Components, Approach for many machines | FR-001–FR-005; Assumptions (transport, rejected options); detail below        |
| Deployment                             | FR-025–FR-027; Assumptions; detail below                                      |
| Scope and PRs (6.0a–6.0c, 7a–7e)       | User Story priorities; per-PR files below                                     |
| R1–R29                                 | FR-001–FR-029                                                                 |
| Acceptance criteria                    | User Story acceptance scenarios; SC-001–SC-008; full list below               |
| Data                                   | Key Entities; shapes below                                                    |
| Design reference                       | User Stories 4–5; detail below                                                |
| Non-goals and later                    | Assumptions (non-goals)                                                       |
| Open questions 1–10                    | Assumptions (proposals taken as defaults); top ones in the clarification list |

## Values the plan must carry (from R2, R8, R14, R16, open question 8)

- Request body ≤ 48 KiB encoded (413 above); response chunks ≤ 256 KiB; WebSocket max message 512 KiB.
- Deadlines: 30 s total, 10 s idle between chunks; 504 on deadline, with the node's work aborted through its `AbortSignal`.
- Pages ≤ 1 MiB (session pages, search, directory listings, git status and changes, diffs); file view ≤ 8 MiB.
- 16 open requests per node (503 above); ping/pong every 15 s, three missed pongs close the socket.
- Merged-endpoint timeout 5 s per node (R17); pairing code 10 min (R11).
- Status codes used in the spec as words: "not found" 404, "unavailable" 503 (with `reason: 'offline'`), "timed out" 504, "too large" 413.
- All of the above are configurable by environment (names in [plan.md](plan.md)) and re-measured in 6.0c before Step 7 (clarified 2026-11-04).

## Changes from the design draft after clarification (2026-11-04)

- Open questions 1, 5 and 8 confirmed as proposed; open question 9 replaced: all c9view state lives in `~/.claude/c9view/` (`C9VIEW_STATE_DIR`), including the hook events file (today `${XDG_STATE_HOME:-~/.local/state}/c9view/events.jsonl`, see `docs/data-sources.md`). Only the service file goes to the OS service folder. New requirement FR-031 and User Story 7 in `spec.md`.
- `/api/nodes/connect` is checked for Host only; the key challenge authenticates it (FR-030).
- The source text below still says some things the design draft said before these answers (for example "never under `~/.claude`" for node state); `spec.md` wins.

## Constitution check

The phase-1 check against the first draft of the constitution found conflicts in Principles I, III, IV and V and the technology list. The owner's answers of 2026-11-04 resolved them in the constitution; the current check is in [plan.md](plan.md#constitution-check).

## Design draft source text

### Components

Each component is defined by what it touches.

| Component  | Package                                     | Touches                                 | Owns                                                                                                                                                                 | Never                                                                             |
| ---------- | ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Web UI** | `apps/web`                                  | the browser                             | the React app                                                                                                                                                        | talks to anything but the hub                                                     |
| **Hub**    | `apps/hub` (today's `apps/server`, renamed) | the browser                             | login, Host/Origin check, control guard, serving the web build, `/api/m/:machineId/*` relay, `machineId` stamping, merged Overview, board, usage and events, pairing | reads `~/.claude` or project folders, starts processes                            |
| **Node**   | `packages/node` (new)                       | `~/.claude`, project folders, processes | one node runtime: watcher, SQLite index, hooks state, liveness, read routes, node health, `ControlService`, the Agent SDK and the `claude` children                  | listens for browsers, checks cookies or Origin, knows its `machineId` in payloads |

**One CLI, three ways to run it:**

```
c9view start  =  hub  +  node in the same process (machine "local")
c9view hub    =  hub  (+ its own machine as "local", unless --no-local)
c9view node   =  node only: no listener, dials out to the hub
```

**`NodeTransport` is the only way the hub reaches a node.** It has two implementations: in-process (`c9view start`, and the hub's own machine) and WebSocket (remote nodes, Step 7). Hub code never knows which one it holds. It carries explicit envelopes, not browser `Request` objects, so both implementations have the same limits by construction.

```ts
interface NodeRequest {
  // same fields as the WebSocket `req` frame
  method: 'GET' | 'POST';
  path: string; // node-relative, e.g. /projects/x/sessions/y
  query: Record<string, string>;
  body?: Uint8Array; // ≤ 48 KiB encoded
}
interface NodeResponse {
  status: number;
  contentType: string;
  body: AsyncIterable<Uint8Array>; // ≤ 256 KiB per chunk
}
interface NodeTransport {
  readonly machineId: string; // set by the hub, "local" for the in-process node
  hello(): NodeHello; // name, version, bootId, capabilities
  request(req: NodeRequest, signal: AbortSignal): Promise<NodeResponse>;
  subscribe(listener: (event: NodeEvent) => void): () => void; // hints only, no machineId
  snapshot(): Promise<NodeSnapshot>; // projects, sessions with status, control runs
  close(): void;
}
```

The in-process transport calls the node's Hono app with a `Request` it builds from the envelope and subscribes to the node runtime's `EventHub`. The WebSocket transport sends the same envelope as frames, and the node answers it with the same app. One machine and many machines run the same code.

**The web UI is not a separate server.** Served from another origin it would need CORS and a cross-site cookie, which breaks the `SameSite=Strict` cookie and the "missing `Origin` is refused" rule the control guard relies on. It stays a separate package, served by the hub from the same origin.

### Approach for many machines

**Nodes dial out to the hub.** Each remote machine runs `c9view node --hub wss://…` and keeps one WebSocket open to the hub. The hub is the only process a browser reaches.

```
Browser ──REST + SSE──▶ HUB (login, guards, UI; paired machines in its DB)
                         │  NodeTransport: in-process for "local", WebSocket for the rest
            ┌────────────┼──────────────┐
         NODE laptop   NODE desktop   NODE server   (packages/node, plus the Claude processes it runs)
```

- **Data stays on the node.** The hub reads online nodes live through their transports. It keeps only each node's last snapshot in memory, to show offline machines. Transcripts, files, diffs and search results are never stored on the hub.
- **Control stays on the node.** The SDK, the run registry, pending requests and receipts live on the node. The hub relays the browser's commands. Every invariant in the session-control spec is enforced by the node, not trusted to the hub.
- **Events are refresh hints.** No component treats an event as data, so missed or reordered events can delay an update but never corrupt one. No event replay is needed (R7).

**Rejected:**

- **Syncing `~/.claude` to one box** (rsync, Syncthing). Read-only by nature, so control can't work. It copies secret-laden transcripts, and PIDs and status mean nothing on another machine.
- **Hub calls each node over HTTP** (for example through Tailscale). Every node then needs a listening port, and laptops that sleep or sit behind NAT drop out. It also needs the same reconnect and snapshot logic as the outbound design, with more exposed surface.
- **A separate web UI server.** See Components.
- **Event IDs and replay** (`Last-Event-ID`, per-node sequence numbers, snapshot watermarks). Not needed while events are only hints and GET is the source of truth (R7).

### Deployment

A node with control runs `claude`, and Claude runs its tools (Bash, Edit, `git`, `pnpm test`) **wherever the node runs**. So the node belongs on the machine itself, next to the owner's toolchains, credentials and terminal sessions. The hub touches no Claude data and fits a container.

| Component                         | Recommended                                                                                                                          | Docker                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Hub** (`c9view hub --no-local`) | Docker on a home server or VPS, behind Tailscale Serve or Cloudflare Tunnel                                                          | Yes: no `~/.claude` mount, its only state is the machines DB, and it needs a TLS endpoint anyway |
| **Node with control**             | Native install (`npm i -g c9view`, Node 22) as a user service: `systemd --user` on Linux, a `launchd` agent on macOS, WSL on Windows | No: refused (R27)                                                                                |
| **Node, read-only** (control off) | Native user service                                                                                                                  | Linux only, with same-path read-only mounts and `--pid=host`                                     |
| **`c9view start`** (one machine)  | Native, as today                                                                                                                     | Today's image, read-only, until 7b changes its default                                           |

**Why not Docker for a node with control:**

- **Tools run in the container.** The project's toolchains, `gh`, SSH keys and git credentials are the host's, not the image's, so Claude would work in a different environment from the terminal and most commands would fail or differ.
- **One session, two environments.** A session started from the web runs in the container; resuming it in the terminal runs on the host.
- **Paths.** Project IDs and `cwd` come from absolute paths, so projects need same-path mounts and `~/.claude` must be writable, which gives up the read-only mounts that make the image safe.
- **Liveness.** Linux needs `--pid=host`; on macOS Docker runs in a VM, so every terminal session reads as `liveness-unknown` and replies are always refused.
- **Watching.** File events on macOS bind mounts are slow or missed, so the watcher falls back to polling.
- **Credentials.** On macOS the Claude login lives in the Keychain, which a container can't reach.

**Reaching the hub.** Nodes connect to `wss://<hub>/api/nodes/connect`. Tailscale (direct or Serve) needs nothing extra. Cloudflare Access can't do a browser login for a node, so nodes send an Access service token (R25), or the owner gives `/api/nodes/connect` its own Access policy. c9view's pairing check applies either way.

### Scope and PRs

PRs 6.0a and 6.0b land before Step 6, so session control is written once, in its final place and machine-aware. 6.0c may run in parallel with 6a and merges before 6b. Step 7 starts after Step 6a merges.

- **6.0a, component split**.
  - Starts when no open PR edits `apps/server`.
  - Creates `packages/node` (`@c9view/node`):
    - moves `apps/server/src/data/` to `packages/node/src/data/`;
    - moves the read routes in `apps/server/src/routes/` (overview, projects, sessions, files, changes, config, usage, search) to `packages/node/src/routes/`;
    - `app.ts`: `createNodeApp(runtime)`, the routes, the error handler and redaction, with no Host/Origin check and no auth;
    - `runtime.ts`: `createNode(config)` creates **one** runtime — the store, `EventHub`, hook events, index and watcher — and the app, transport and `startIndex` all share it (R4);
    - `routes/health.ts`: node health, moving today's index and hooks enrichment out of `apps/server/src/app.ts` (R4);
    - `transport.ts`: the `NodeTransport`, `NodeRequest` and `NodeResponse` types and `InProcessTransport`, enforcing the R2 limits;
    - `hello.ts`: the node's `NodeHello` with a random `bootId`.
  - Renames `apps/server` to `apps/hub` (`@c9view/hub`):
    - keeps `main.ts`, `auth/` and the Host/Origin middleware;
    - `app.ts`: serves the web build and relays `/api/*` (except the hub's own routes) to the local node through its transport;
    - `routes/health.ts`: `/api/health` returns the same body as today by combining hub fields with the local node's health;
    - `routes/events.ts`: the SSE stream, fed from `transport.subscribe`.
  - Updates `packages/cli/src/start.ts` to resolve `@c9view/hub`, and the Dockerfile, CI, `AGENTS.md` (repository layout) and `docs/deploy.md` paths.
  - Adds lint rules: `packages/node` doesn't import `hono/cookie`, the auth module or `@hono/node-server`'s `serve`; `apps/hub` imports `@c9view/node` only through its package entry.
  - The maintainer does the package moves and the lockfile.
- **6.0b, machine-scoped API and web, and refresh rules**.
  - Owns `packages/api/src/machines.ts` (new): `MachineId`, `MachineSummary`, `MachineCapabilities`, `NodeHello`, `NodeSnapshot`, `MachineEvent`. Additive export in the barrel.
  - Hub:
    - `apps/hub/src/machines.ts` (new): the machine list (one `local` entry for now) and `GET /api/machines`;
    - `/api/m/:machineId/*` relays to that machine's transport; `/api/*` stays an alias for `local` with the rules in R6;
    - wraps every node event as `{ machineId, event }` on `/api/events`, and emits `machine` events (R5, R7).
  - Web:
    - `apps/web/src/api.ts` builds every path from the machine (`/api/m/${machineId}…`);
    - `apps/web/src/queryKeys.ts` (new): query-key factories; every machine-scoped key starts with `machineId`, global keys (machines, hub health) don't;
    - routes move under `/m/$machineId/…`, with redirects from the old paths to `/m/local/…`;
    - `apps/web/src/live/index.tsx`: the R7 refresh rules — refresh every query of a machine after a gap, one refresh at a time per query with a dirty flag;
    - the search page reads index progress from `/api/m/:machineId/health`.
  - Node: `packages/node/src/data/store.ts` rebuilds a snapshot when something changed while it was being built (R7).
- **6.0c, response budgets**.
  - Owns `packages/node/src/budget.ts` (new): measures encoded JSON after redaction and stops a page at the budget.
  - Edits the node's session, search, files, git and changes routes to return byte-budgeted pages with continuation cursors (R8).
  - Session number cursors stay because the web computes earlier pages from them; trimming backward pages from the start keeps pages contiguous. An oversized item is cut with a marker, but paging through the rest of that item has no cursor yet, so R8's per-item cursor is still open.
  - Web: `apps/web/src/session/paging.ts` follows returned cursors instead of counting messages; partial-content notices in the file viewer and diffs.
- **7a, merged endpoints**.
  - Owns `apps/hub/src/aggregate.ts` (new): merges Overview, projects and usage over every transport, with `partial` (R17).
  - Hub reads online machines live; the snapshot is used only for offline machines (R19).
- **7b, WebSocket transport and node mode**.
  - Owns `packages/node/src/tunnel/` (new): `frames.ts` (Zod schemas, exported for the hub), `chunks.ts` (splitting and joining bodies, bounded queues), tests.
  - Owns `packages/node/src/connect/` (new): `dial.ts` (connect, backoff, heartbeat), `serve.ts` (answers `req` frames through the node app), `identity.ts` (key pair and pairing), tests.
  - Owns `apps/hub/src/nodes/` (new): `socket.ts` (WebSocket server and challenge), `ws-transport.ts` (`NodeTransport` over a socket), `pairing.ts`, tests.
  - Adds `c9view hub` (with `--no-local`), `c9view node`, `c9view node pair` and `c9view hub pair` to `packages/cli/src/`, and the node's Cloudflare Access service-token settings (R25).
  - Docker: the image's default command becomes `c9view hub --no-local`; the compose file gets a hub profile with no `~/.claude` mount; the image refuses `--control` (R27).
  - Docs: `docs/deploy.md` gains hub and node deployment, the Cloudflare Access service token, and node state backup (R29).
  - The maintainer adds the WebSocket server dependency and owns the lockfile.
- **7c, hub with many nodes**.
  - Owns `apps/hub/src/nodes/registry.ts` (paired machines, connection state, last snapshot), `apps/hub/src/nodes/limits.ts`, tests.
  - Replaces the single-entry machine list from 6.0b with the registry.
  - Adds `c9view hub machines list|revoke` to `packages/cli/src/`.
  - `/api/machines` reports each node's c9view, protocol and Claude Code versions, and whether it is too old (R28).
- **7d, web for many machines**.
  - Owns `apps/web/src/machines/` (new): `MachinesPage.tsx`, `MachineSwitcher.tsx`, `MachineBadge.tsx`, `useMachines.ts`.
  - Additive edits: the shell (switcher), Overview and board (machine chip on cards, filter by machine), session and project headers (machine name, offline state).
  - The Machines page shows each node's versions and what to upgrade (R28).
- **7e, node as a service**.
  - Owns `packages/cli/src/service/` (new): `systemd.ts`, `launchd.ts`, `index.ts` and tests, for `c9view node install-service`, `uninstall-service` and `service status` (R26).
  - Docs: the service section in `docs/deploy.md`.
  - Starts after 7b merges.

### Requirements

**Components**

1. **R1** Boundaries.
   - Only the node reads `~/.claude` or project folders, runs git, or starts processes.
   - Only the hub listens for browsers, checks cookies, Host and Origin, and serves the web build.
   - The web UI calls only the hub, from the same origin.
   - A hub run with `--no-local` creates no index, hooks reader or watcher, and never reads `~/.claude`.
2. **R2** `NodeTransport`.
   - The hub reaches nodes only through it, with `NodeRequest` and `NodeResponse` envelopes. No browser header reaches a node: no cookie, `Origin`, `Host` or `Authorization`.
   - Request bodies are at most 48 KiB encoded; responses arrive in chunks of at most 256 KiB.
   - Each request has a 30-second total deadline and a 10-second idle deadline between chunks. A deadline returns 504 and aborts the node's work through the signal. A 504 means "the hub stopped waiting", not "the operation was cancelled"; control commands recover through receipts (session-control R21).
   - The in-process and WebSocket transports enforce the same limits and pass the same contract tests.
3. **R3** Ways to run.
   - `c9view start` runs the hub and one in-process node called `local`. Its flags, defaults and behaviour stay as today, apart from 6.0b's new URLs.
   - `c9view hub` runs the hub. By default it also runs its own machine's node as `local`; `--no-local` turns that off.
   - `c9view node --hub <url>` runs a node with no listening port. `--listen` adds a local hub-less listener for when the hub is down, and then all of today's listener rules apply to it.
4. **R4** One node runtime.
   - `createNode(config)` creates the store, `EventHub`, hook events, SQLite index and watcher once. Routes, the transport, `startIndex` and shutdown all use that runtime.
   - Node health (index progress, hooks installation and files) is computed on the node and served at the node's `/health`. The hub never computes it.
5. **R5** Machine identity.
   - Only the hub sets `machineId`, from the transport a response or event came through. Node payloads omit it, and the hub overwrites any `machineId` a node sends.
   - The hub adds it in defined envelopes (`MachineEvent { machineId; event }`, `machineId` on aggregate items), never by rewriting nested data.
   - The browser keys everything machine-scoped by `machineId`: URLs, query keys, runs, requests and receipts.
6. **R6** Machine-scoped API.
   - `/api/m/:machineId/*` is relayed to that machine. An unknown machine returns 404; an offline one 503 with `reason: 'offline'`.
   - `/api/*` without a machine is an alias for `local` only, never "the first connected machine". With `--no-local` it returns 404. Hub routes (`/api/health`, `/api/machines`, `/api/events`, `/api/nodes/connect`, login and logout, pairing) match before the alias. Guards and login apply through the alias exactly as through `/api/m/local/*`.
   - `GET /api/machines` lists machines: name, connection state (`online`, `offline`), last seen, version, `bootId`, and capabilities. A capability has a state (`off`, `ready`, `unavailable`) and a reason, and is refreshed on every `hello` and after reconnects. The node rechecks its own flags on every call, so a stale capability in the browser authorizes nothing.
   - `/api/health` describes the hub only (version, auth, machines count). Node health is at `/api/m/:machineId/health`.
7. **R7** Refresh rules.
   - Events are hints. No handler applies event content to the cache; each one invalidates or refetches the matching queries, and GET is the source of truth.
   - After any gap — the browser's SSE reopens, or the hub announces a `machine` event for a reconnect — the web refetches **every** active query of that machine, including files, git status and changes.
   - The web runs at most one refresh at a time per query. An event that arrives during a refresh sets a dirty flag, and one more refresh runs when the current one ends. A newer response is never discarded in favour of an older one.
   - A node snapshot or summary that is invalidated while it is being built is rebuilt before it is returned as current.
   - The hub reads online nodes live. It keeps the last snapshot only to show offline machines. When installing a snapshot after a connect, it subscribes to events first, then reads the snapshot, then applies a refresh if an event arrived in between. Snapshots are sent in chunks.
8. **R8** Response budgets, measured after redaction and JSON encoding.
   - Session pages, search results, directory listings, git status and changes, and diffs: at most 1 MiB per page. The node stops before the budget and returns a continuation cursor; it never cuts JSON.
   - A file view: at most 8 MiB. A larger file returns metadata and an explicit notice instead of content.
   - A single item larger than its page budget (a huge message or hunk) is returned truncated with a marker and a cursor to page its full content.
   - The web follows returned cursors, keeps order, and shows a partial-content notice with a way to continue.
9. **R9** PR 6.0a changes no behaviour: every existing test passes after moving with its code, and every `/api/*` response is unchanged.

**Pairing and identity**

10. **R10** The hub requires login whenever it has a paired remote node or a node with control. Auth mode `none` refuses to start then, and `C9VIEW_INSECURE_NO_AUTH` does not override it.
11. **R11** Pairing.
    - `c9view hub pair` (or a button on the hub's Machines page) creates a one-time code valid for 10 minutes.
    - `c9view node pair --hub <url> --code <code> [--name <name>]` generates an Ed25519 key pair on the node, sends the public key with the code, and receives a `machineId` (random UUID) from the hub.
    - The node keeps its private key, `machineId` and hub URL under `~/.claude/c9view/node/` (mode 0600; c9view's own state folder, never in Claude data). The hub stores the machine's public key, name and pairing time in its SQLite DB.
12. **R12** Connecting.
    - The node connects with `wss://`. Plain `ws://` is allowed only to a loopback hub.
    - The hub sends a random challenge; the node signs it. An unknown key, a revoked machine or a bad signature closes the socket with no detail.
    - A second connection for the same `machineId` replaces the first.
13. **R13** Revoking. `c9view hub machines revoke <id>` (or the Machines page) deletes the public key and closes the socket at once. The node's next connect fails, and the node logs "This machine was removed from the hub; pair it again."

**Protocol**

14. **R14** Frames are JSON text messages, validated with Zod on both ends; unknown frame types are ignored. The WebSocket's maximum message size is 512 KiB.
    - `hello` (node → hub, after the challenge): `{ name, version, protocol, bootId, capabilities }`. The hub refuses a node whose `protocol` it doesn't support, and the node logs the version to install. The `machineId` comes from the verified key, not from the frame.
    - `snapshot` (node → hub): projects, session summaries with status, and the control runs, in `snapshot.chunk` frames ending with `snapshot.end`. Sent after every connect.
    - `event` (node → hub): a node event hint.
    - `req` (hub → node): a `NodeRequest` with an `id` unique per connection.
    - `res` (node → hub): `{ id, status, contentType }`, then `chunk` frames of at most 256 KiB of payload, then `end`. The hub streams them to the browser.
    - `cancel` (hub → node): the browser went away or a deadline passed; the node aborts the request.
    - `ping` and `pong` every 15 seconds. Three missed pongs close the socket.
15. **R15** The node answers `req` frames only for an allowlist: every `GET` route of the node app, and the control routes when the node's control flag is on. Anything else gets 404. The hub forwards a request only to the node named in its path.
16. **R16** Limits. At most 16 open requests per node; more get 503 on the hub. Each socket has bounded send and receive queues; a slow browser is disconnected rather than allowed to stall a node.

**Hub behaviour**

17. **R17** Merged endpoints. `/api/overview`, `/api/projects` and `/api/usage` with no machine merge every machine's answer. Each item carries `machineId`. A machine that doesn't answer in 5 seconds is left out and named in a `partial: [machineId]` field. Search stays per machine in v1.
18. **R18** Live events. `/api/events` on the hub merges every transport's hints as `MachineEvent`s and adds `machine` events when a node connects (with its `bootId`) or drops. The hub owns SSE framing, heartbeats and slow-client handling; a node's event emission never waits on a browser.
19. **R19** Offline machines. After the socket closes, the hub keeps the last snapshot in memory and marks the machine offline. The board shows its cards greyed out with "offline · last seen 3 min ago". Detail pages and controls for it are disabled with the same text. Nothing about it is written to the hub's DB except `lastSeenAt`.
20. **R20** Nothing from a node's data is written to disk on the hub: no transcripts, no file contents, no summaries. The hub DB holds only machines (id, name, public key, paired and last-seen times) and pairing codes. The local node's own SQLite index belongs to the node, not the hub.

**Control through the hub**

21. **R21** The browser-facing control guard (Origin, `X-C9view-Control`, JSON, login) runs only on the hub. The node treats its transport as its caller and still applies every other control rule: IDs looked up in its own store, paths never from the request, the node-held tool input, the answer checks, the run caps, the receipts.
22. **R22** The node's flags decide what the hub can do. `control` and `bypass` come only from the node's own flags (session-control R1 and R11a), are reported in `hello`, and can't be changed by any frame. The hub shows "Control off" or a "Bypass" badge per machine.
23. **R23** Pending requests on a node that goes offline stay on the node and time out there as usual. The hub shows them as unreachable and refuses decisions with 503. The node never retries; the browser recovers through receipts once the node is back, or gets `unknown-outcome` if the node restarted.

**Security**

24. **R24** A compromised hub can read every node's data and, on nodes with control on, run Claude there. The spec accepts this for a single owner and limits it:
    - control and bypass are per node and off by default (R22);
    - each node has its own key, revocable on its own (R13);
    - nodes open no listening port (R3), and a node's `machineId` comes from its verified key;
    - prompts, tool input and answers are never logged on the hub or the node; errors pass through `redactText`.

**Deployment**

25. **R25** Reaching the hub.
    - Nodes connect to `wss://<hub>/api/nodes/connect`. The hub serves that path on its normal listener; it needs no extra port.
    - The node accepts an optional Cloudflare Access service token (`C9VIEW_HUB_ACCESS_CLIENT_ID` and `C9VIEW_HUB_ACCESS_CLIENT_SECRET`) and sends it as the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers on the WebSocket upgrade. The values are never logged and are stored only in the service environment, never in the identity file.
    - A failed upgrade names the likely cause: no route to the hub, TLS, an Access login page, or a refused pairing.
26. **R26** Node as a user service.
    - `c9view node install-service` writes a `systemd --user` unit (Linux) or a `launchd` agent plist (macOS) that runs `c9view node` at login and restarts it on failure. It prints the exact file and its contents first, and writes only after confirmation or `--yes`, like `hooks install`.
    - The service passes the hub URL and the node flags (`--control`, `--bypass`) as written at install; changing a flag means reinstalling, so a flag can't change silently.
    - `uninstall-service` removes only the file it wrote. `service status` reports installed, running, and connected to the hub.
    - Logs go to the platform's user log (journald, `~/Library/Logs/c9view/`), redacted as everywhere else.
27. **R27** Containers.
    - The image's default command is `c9view hub --no-local` (from 7b). `c9view start` in the image stays read-only, as today.
    - The image sets `C9VIEW_IN_CONTAINER=1`. With it set, the node refuses `--control` and `--bypass` with a message that points to the native node install.
    - The compose file has a hub profile with only the hub DB volume and no `~/.claude` or workspace mounts.
28. **R28** Versions.
    - `hello` and `/api/machines` carry each node's c9view version, protocol version and Claude Code version (from the binary the node runs, session-control open question 2).
    - The hub refuses an unsupported protocol (R14) and marks an old but supported node as `outdated`; the Machines page says what to upgrade on which machine.
29. **R29** Node state.
    - The node's state folder (`~/.claude/c9view/node/`, holding the identity key) keeps mode 0700 for the folder and 0600 for the key. The node refuses to start if they are wider, and names the `chmod` to run.
    - Upgrading c9view never moves or rewrites it. `docs/deploy.md` says to back it up; losing it means pairing the machine again.

### Acceptance criteria

- **Checks:** the root `lint`, `typecheck`, `test` and `build` pass after every PR.
- **6.0a:**
  - every existing server test passes, moved next to its code;
  - an end-to-end test starts `c9view start` and gets the same `/api/*` responses as before the split for the fixture data, including `/api/health`;
  - the lint rules fail on a test import that breaks a boundary;
  - `InProcessTransport` passes the transport contract tests: request and response envelopes, no browser headers reach the node, a 48 KiB-plus body gets 413, chunks are at most 256 KiB, deadlines return 504 and abort the node's signal, subscribe and snapshot work;
  - one runtime: an event from `startIndex` reaches the SSE stream, and the node health reports the same index state the routes use.
- **6.0b:**
  - `/api/m/local/…` returns the same as `/api/…`; an unknown `machineId` returns 404; with `--no-local` the alias returns 404; guards apply through the alias;
  - SSE events arrive as `{ machineId: 'local', event }`, and a fake node's own `machineId` is overwritten;
  - two query keys with the same `projectId` and different machines don't share cache entries;
  - old URLs redirect to `/m/local/…`;
  - refresh rules: after an SSE reopen, file, git status and changes queries refetch; two overlapping refreshes of one session end with the newer data; an event during a refresh causes exactly one more refresh;
  - a snapshot invalidated during its build is rebuilt before it is returned.
- **6.0c:**
  - a session page with large tool output stops under 1 MiB and returns a cursor; following the cursors yields every message in order;
  - a file over 8 MiB returns metadata and a notice; a single oversized message is truncated with a marker and its full content is pageable;
  - the session page and file viewer show partial-content notices.
- **Server tests for Step 7** run a hub and two nodes in one process, over a real WebSocket on loopback, with fixture data and the fake `sdk.ts` adapter. They cover:
  - the WebSocket transport passes the same contract tests as the in-process one;
  - hub refuses to start with auth `none` once a remote node is paired, including with `C9VIEW_INSECURE_NO_AUTH=1`;
  - pairing: a code works once and expires; an unknown key, a bad signature and a revoked machine are refused; revoking closes an open socket;
  - a node with a mismatched `protocol` is refused; a `hello` that names another machine's ID is ignored in favour of the verified key;
  - two machines with the same `projectId` stay separate on the merged Overview and board;
  - a `req` outside the allowlist gets 404 from the node; a control route gets 404 when the node's control is off;
  - no frame can change `control` or `bypass`;
  - a response larger than one chunk arrives whole; `cancel` aborts the node's request; the open-request cap returns 503 and the deadlines 504; the largest 6.0c pages pass over the socket;
  - a dropped node is marked offline, its cards stay with `offline`, its detail routes return 503, and a reconnect installs a fresh snapshot without losing an event sent during the install;
  - a node restart changes its `bootId`; a control command retried across it gets `unknown-outcome`; a command whose response was lost is recovered by its receipt;
  - after a run of the whole suite, the hub DB holds only the `machines` and pairing tables;
  - with `C9VIEW_HUB_ACCESS_CLIENT_ID` and `C9VIEW_HUB_ACCESS_CLIENT_SECRET` set, the upgrade request carries both headers, and neither value appears in logs;
  - with `C9VIEW_IN_CONTAINER=1`, `c9view node --control` and `--bypass` refuse to start;
  - a node with an old protocol is refused, and an old supported one is reported `outdated` with its versions;
  - a state folder or key with wider permissions stops the node with the `chmod` to run.
- **7e tests:** `install-service` prints the unit or plist before writing and writes nothing without confirmation; the written file runs `c9view node` with the flags given; `uninstall-service` removes only that file; tests write to a temporary home, never the real one.
- **Docker (7b):** `docker compose --profile hub config` has no `~/.claude` or workspace mount; the image's default command is `c9view hub --no-local`.
- **Web tests for Step 7:**
  - the machine switcher and machine chips appear only with more than one machine;
  - offline cards, pages and controls show the offline text and are disabled;
  - a `partial` Overview names the missing machine.
- **Manual check** by the maintainer: a hub on port 7790 with `C9VIEW_AUTH=token` and two nodes on the same host pointed at two fixture Claude dirs; pair both, revoke one, stop and restart the other; check at 1440×900 and 390×844. Never use port 7777.

### Data

- **New types in `packages/api/src/machines.ts`:**
  - `MachineId` (string; `local` for the in-process node)
  - `MachineCapabilities { control: { state: 'off' | 'ready' | 'unavailable'; reason? }; bypass: boolean }`
  - `MachineSummary { machineId; name; state; lastSeenAt; version; bootId; capabilities }`
  - `NodeHello { name; version; protocol; bootId; capabilities }`
  - `NodeSnapshot { projects; sessions; control }`
  - `MachineEvent { machineId; event }` and `machine` events `{ machineId; state; bootId? }`
- **Transport types in `packages/node/src/transport.ts`:** `NodeRequest`, `NodeResponse`, `NodeEvent`, `NodeTransport`.
- **Changed types:** `machineId` on aggregate items (`ProjectSummary`, `SessionSummary` when merged). Node payloads never carry it.
- **Project IDs** come from the folder path (for example `-fixture-alpha`), so they collide across machines. The pair `(machineId, projectId)` is the key everywhere on the hub and in the web.
- **Cursors** are opaque strings issued by a node, valid only on that machine.
- **Node identity** lives in `~/.claude/c9view/node/identity.json`: `{ machineId, hubUrl, privateKey }`.
- **Hub DB tables:** `machines (id, name, publicKey, pairedAt, lastSeenAt)` and `pairing_codes (codeHash, expiresAt)`.
- **Node DB:** the existing SQLite index, unchanged, owned by `packages/node`.

### Design reference

- **Shell:** a machine switcher next to the project picker with "All machines" first. Hidden with only one machine.
- **Overview and board:** a machine chip on each card and project row; filter by machine. Offline machines' cards are greyed out, with text, not colour alone.
- **Machines page** (hub only): name, state, last seen, version, Control and Bypass badges, Pair and Revoke. Revoke uses the kit `Dialog` with a typed confirmation.
- **Session and project headers:** the machine name, and an offline banner when it is offline.
- **Partial content:** a one-line notice with "Load more" where a budget cut a page or file short.
- **Architecture diagram:** three components, the in-process and WebSocket transports, and the control loop; see the published specs page.
- No mock exists. Use the existing tokens and kit components.

### Non-goals and later

- A separate web UI server or CDN-hosted UI (see Components).
- Event replay or exactly-once event delivery (R7 makes them unnecessary).
- Optimistic approval cards carried in events; revisit only if measured latency over WebSocket is a problem.
- A separate, smaller `c9view-node` npm package. One package for now; split it if install size matters on servers.
- Several owners or per-user access on one hub.
- Search across all machines in one query (cursors per machine make this a separate design).
- Moving or copying sessions between machines.
- Caching transcripts on the hub for offline reading.
- A hosted hub. The owner runs the hub on one of their own machines, exposed as described in `docs/deploy.md`.
- Docker for nodes with control (see Deployment and R27).
- A **devcontainer node**: a container that _is_ the development environment, holding the project, its toolchain, `claude` and its own `~/.claude`. It would be a safe place for a `--bypass` node, because Claude can't touch the host. It is a different model from wrapping a host machine in Docker; design it separately.
- A native Windows node. v1 supports Windows through WSL.

### Open questions

1. **Transport.** Proposal: outbound WebSocket from each node (above). The alternative is the hub calling nodes over Tailscale, which is simpler only when every machine is always on the tailnet.
2. **Hub serves its own machine by default.** Proposal: yes, as `local`, with `--no-local` for a hub on a box without Claude Code.
3. **Search across machines.** Proposal: per machine in v1; revisit after use.
4. **Merged Overview timeout.** Proposal: 5 seconds per node, then `partial`. Is that right for a slow remote server?
5. **Identity storage.** Proposal: a 0600 file under `~/.claude/c9view/node/`. The OS keychain would be stronger but adds a native dependency.
6. **Node with a local listener.** Proposal: allowed with `--listen` so the owner can still open a node directly when the hub is down; the usual login rules apply.
7. **Renaming `apps/server` to `apps/hub`.** Proposal: rename in PR 6.0a so the name says what it does. The cost is a one-time path change in the Dockerfile, CI and docs.
8. **Budgets.** Proposal: 1 MiB pages, an 8 MiB file ceiling, 48 KiB request bodies, 256 KiB chunks, 30 s total and 10 s idle deadlines. Measure on real sessions in 6.0c and adjust before Step 7.
9. **Service install writes outside `~/.claude`.** `install-service` writes to `~/.config/systemd/user/` or `~/Library/LaunchAgents/`. Proposal: allowed, because the owner runs it explicitly and it prints the file first, like `hooks install`; `AGENTS.md` lists it next to the hooks exception.
10. **Windows.** Proposal: WSL only in v1; revisit a native Windows node when someone needs it.
