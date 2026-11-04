# Research: Components and Multiple Machines

Phase 0 for [plan.md](plan.md). The Technical Context has no open NEEDS CLARIFICATION; the decisions below come from the design draft ([notes](design-notes.md)), its two reviews, and the owner's answers of 2026-11-04 ([spec.md](spec.md#clarifications)).

## R1. Hub–node transport

- **Decision**: nodes dial out to the hub over one WebSocket each (`wss://<hub>/api/nodes/connect`); the hub reaches every node, local or remote, only through `NodeTransport` with explicit envelopes ([contracts/node-transport.md](contracts/node-transport.md)).
- **Rationale**: nodes need no listening port, so sleeping or NAT'd laptops still work; the in-process and WebSocket implementations share limits and contract tests.
- **Alternatives**: hub calls nodes over Tailscale/HTTP (every node listens; same reconnect logic anyway); syncing `~/.claude` (no control, copies secrets); passing browser `Request` objects through (leaks headers, no shared limits).

## R2. Node authentication and the Origin rule

- **Decision**: Ed25519 key pair per node (`node:crypto`), created at pairing; the hub sends a random challenge after upgrade and verifies the signature against the stored public key. `/api/nodes/connect` is checked for Host (allowed hosts, as every path) but not Origin; browser login and cookies do not apply to it. Constitution Principle III states this exception.
- **Rationale**: nodes aren't browsers and send no Origin; the signed challenge is stronger than an Origin header, which a non-browser client can set to anything.
- **Alternatives**: a fixed node Origin header (security theatre); a separate listener (extra port, conflicts with FR-025).

## R3. WebSocket library

- **Decision**: `ws` on the hub, attached to the existing `@hono/node-server` HTTP server's `upgrade` event for `/api/nodes/connect` only, with `maxPayload` = `C9VIEW_WS_MAX_MESSAGE_BYTES`. The node uses `ws` too, because it must send `CF-Access-Client-*` headers on the upgrade (FR-025), which the WHATWG `WebSocket` in Node 22 doesn't allow.
- **Rationale**: mature, no native code, supports backpressure via `bufferedAmount` for bounded queues (FR-016).
- **Alternatives**: `@hono/node-ws` (thin wrapper over `ws`, less control of upgrade and payload limits); Node's built-in client (no custom headers).

## R4. Response budgets

- **Decision**: `packages/node/src/budget.ts` serializes items one by one after redaction, adds them while the encoded total stays under `C9VIEW_PAGE_BUDGET_BYTES`, and returns an opaque cursor; a single oversized item is truncated with a marker and its own cursor. Files above `C9VIEW_FILE_BUDGET_BYTES` return metadata and a notice.
- **Rationale**: stops before the budget and never cuts JSON (FR-008); counting messages (today) can exceed any size.
- **Alternatives**: streaming JSON (harder to page and to resume); compressing (does not bound memory).

## R5. Refresh rules in the web

- **Decision**: one refresh at a time per query key with a dirty flag (TanStack Query `invalidateQueries` with `cancelRefetch: false` plus a per-key in-flight set in `live/index.tsx`); on SSE reopen or a `machine` reconnect event, invalidate every query whose key starts with that `machineId`, including files, git status and changes. Node `store.ts` uses a generation counter so a snapshot invalidated mid-build is rebuilt.
- **Rationale**: fixes the Implementation round-2 findings (overlapping refreshes discarding newer data, reconnect not refreshing files/git/changes, stale in-flight snapshot builds).
- **Alternatives**: event replay with IDs (rejected: events are hints, GET is the source of truth).

## R6. c9view state folder and the hook events migration

- **Decision**:
  - One resolver, `packages/core/src/hooks/state-dir.ts` (`node:` imports only, so the hook entry stays dependency-free): a `--c9view-state-dir <path>` argument on the hook command if present, else `C9VIEW_STATE_DIR`, else `<home>/.claude/c9view`. Installed hooks run in Claude Code's environment, not c9view's, and today's hook command (`hookCommand` in `packages/core/src/hooks/settings.ts`) carries no environment, so `hooks install` appends `--c9view-state-dir '<resolved dir>'` (shell-quoted like the existing paths) whenever the state folder is not the default; reinstalling updates it. The default does not follow `C9VIEW_CLAUDE_DIR` either, for the same reason; with a custom Claude dir the owner sets `C9VIEW_STATE_DIR` and reinstalls hooks (documented in deploy). Control-run children receive `C9VIEW_STATE_DIR` (002 research R11), so their hooks agree as well.
  - Subfolders: `node/` (identity, `state.db` from 002), `hub/` (`hub.sqlite`), and `events.jsonl` / `events.1.jsonl` at the top, as today's file names.
  - **Migration: the reader also checks the old path.** `HookEventTailer` tails `<state>/events.jsonl` and, if it exists, a legacy file, read-only, merged by timestamp, with the same per-session caps. The legacy folder is `C9VIEW_LEGACY_STATE_DIR` when set; otherwise, only when `C9VIEW_STATE_DIR` is unset, the old default `${XDG_STATE_HOME:-~/.local/state}/c9view/`. The explicit setting exists because the Docker image sets `C9VIEW_STATE_DIR` (and `HOME=/tmp`), which would otherwise switch the legacy read off. c9view never moves or deletes the old file. `hooks status` reports both. The legacy read is removed in a later release, noted in `docs/data-sources.md`.
  - `packages/core/src/state/ignore.ts` exports `isC9viewStatePath(claudeDir, stateDir, path)`, true for anything under the real path of `<claudeDir>/c9view/` and under the real path of the resolved state folder when that lies inside the Claude dir under another name; the watcher's `ignored`, project discovery and config document readers call it, with regression tests for both cases.
  - Permissions, per caller: the **hook entry** keeps today's behaviour — it creates folders 0700 and files 0600, tightens a folder it owns that is wider to 0700, skips (silently writes nothing) a symlinked or foreign-owned folder or a symlinked file, and appends with `O_NOFOLLOW`. The **node and hub** (identity, `state.db`, `hub.sqlite`) never tighten: a folder wider than 0700 or a file wider than 0600 stops them at startup with the `chmod` to run (FR-029), and a symlinked or foreign-owned folder or symlinked file stops them too.
  - Docker: the image sets `C9VIEW_STATE_DIR=/data/claude/c9view` (its `HOME=/tmp` makes the default useless there); compose mounts `${HOME}/.claude/c9view` writable at `/data/claude/c9view` on top of the read-only `/data/claude`; the old `~/.local/state/c9view` mount stays at `/data/c9view-state`, read-only, with `C9VIEW_LEGACY_STATE_DIR=/data/c9view-state` set next to it, and both can be removed together once no legacy events matter.
- **Rationale**: one place for everything c9view writes (owner's answer); hooks keep working immediately after upgrade because the writer and reader agree on the new default, and old events stay visible.
- **Alternatives**: rely on `C9VIEW_STATE_DIR` for existing installs (silent loss of history for anyone who doesn't set it); move the old file (a write outside the state folder).

## R7. Hub store

- **Decision**: `hub.sqlite` (better-sqlite3 + Drizzle, generated migrations) in `<state>/hub/`, tables `machines (id, name, publicKey, pairedAt, lastSeenAt)` and `pairing_codes (codeHash, expiresAt)`. Codes are 128-bit random, shown once, stored as SHA-256. In the hub Docker profile the state folder is the hub's own volume.
- **Rationale**: persistent state separate from the index (Principle IV); nothing from node data on disk (FR-020).

## R8. Identity file

- **Decision**: `<state>/node/identity.json` `{ machineId, hubUrl, privateKey }` (PKCS#8 PEM), 0600 in a 0700 folder; the node refuses to start if either is wider and prints the `chmod`. No keychain.
- **Rationale**: owner's answer; no native dependency.

## R9. Ways to run and Docker defaults

- **Decision**: `c9view start` = hub + in-process `local` node; `c9view hub [--no-local]`; `c9view node --hub <url> [--listen] [--control] [--bypass]`. From 7b the image's default command is `c9view hub --no-local` and sets `C9VIEW_IN_CONTAINER=1`, which makes the node refuse `--control` and `--bypass`.
- **Rationale**: The design draft deployment table; tools must run where the node runs.

## R10. Version reporting

- **Decision**: `hello` carries `version` (c9view), `protocol` (integer, starts at 1) and `claudeCodeVersion` (from the binary the node would run, in 002 FR-002's order: `C9VIEW_CLAUDE_BIN`, `claude` on PATH, the SDK's bundled binary). The hub supports a `[minProtocol, protocol]` range; below it refuses, at the lower bound but older c9view than the hub marks `outdated`.

## R11. No login means no remote nodes, at runtime too (FR-010)

- **Decision**: the startup refusal is not enough, because a hub started with auth `none` and no paired node could pair one later. While the hub's auth mode is `none`: `c9view hub pair` and `POST /api/machines/pair` refuse with "enable login first"; the socket handler closes on any `pair` or `auth` frame without detail. The hub's `challenge` frame carries `auth: 'none' | 'token' | 'password'`; a node started with `--control` closes the socket and exits with "the hub has no login; enable it on the hub" when it sees `none`. A read-only node may still connect only if the hub accepted its `auth` frame, which it never does under `none`, so in practice no remote node connects without login.
- **Rationale**: Principle III requires login with a paired remote node "at runtime as well as at startup"; the node-side check is defence in depth against a misconfigured or downgraded hub.

## R12. Pre-authentication limits on `/api/nodes/connect` (FR-012, FR-016)

- **Decision**: the path skips login and Origin, so the hub bounds it before a node is authenticated:
  - handshake deadline `C9VIEW_NODE_HANDSHAKE_MS` (10,000): no valid `auth` or `pair` frame by then → close;
  - at most `C9VIEW_NODE_MAX_UNAUTHENTICATED` (8) unauthenticated sockets at once; above that the upgrade gets 503;
  - per-IP backoff shared with the login limiter's design (`C9VIEW_TRUST_PROXY` rules for the client address): each failed `pair`, or `auth` naming an unknown key, doubles the delay before the next attempt is read, and after `C9VIEW_NODE_MAX_FAILURES` (10) such failures in 15 minutes new upgrades from that address get 429 until the window passes. A known machine's `auth` with a valid signature is never blocked by the address budget: the hub reads its `auth` frame even when the address is over budget, so one attacker behind the same tunnel address can't lock out paired nodes. A tunnelled hub must set `C9VIEW_TRUST_PROXY=1`, or every client shares one address;
  - unauthenticated sockets may send only `auth` or `pair`, each at most 4 KiB, enforced by the `ws` server's `maxPayload` of 4 KiB until authentication succeeds (then raised to `C9VIEW_WS_MAX_MESSAGE_BYTES`); anything else closes.
- **Rationale**: the key challenge makes guessing useless, but without limits the path is an unauthenticated resource sink and a pairing-code guessing surface.
