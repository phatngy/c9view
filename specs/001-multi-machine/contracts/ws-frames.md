# Contract: WebSocket frames (node ↔ hub, 7b)

Endpoint: `wss://<hub>/api/nodes/connect` (`ws://` only to a loopback hub). Schemas: `packages/node/src/tunnel/frames.ts` (Zod, exported for the hub). JSON text messages; max message `C9VIEW_WS_MAX_MESSAGE_BYTES` (512 KiB); unknown `type` ignored on both ends. Upgrade checked on Host only; optional `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers from `C9VIEW_HUB_ACCESS_CLIENT_ID` / `C9VIEW_HUB_ACCESS_CLIENT_SECRET`, never logged.

## Handshake

0. Before the upgrade: Host check; at most `C9VIEW_NODE_MAX_UNAUTHENTICATED` (8) unauthenticated sockets (else 503); an address over its failure budget gets 429 unless its first frame is a valid `auth` from a known machine (research R12).
1. Hub → node `challenge { nonce, auth: 'none' | 'token' | 'password' }` (32 random bytes, base64url). Under `auth: 'none'` the hub accepts no `auth` or `pair` frame (closes without detail), and a node with control closes and exits with "the hub has no login" (FR-010).
2. Node → hub `auth { machineId, signature }` — Ed25519 signature over `c9view-node-v1\n<nonce>\n<hub host>`. Unknown key, revoked machine or bad signature: close with no detail.
3. Node → hub `hello { name, version, protocol, claudeCodeVersion?, bootId, capabilities }`. Unsupported `protocol` → `close` with `{ minProtocol, protocol }` so the node can log what to install. The `machineId` comes from step 2's verified key; any `machineId` in `hello` is ignored.
4. Node → hub `snapshot.chunk { seq, data }`… `snapshot.end { seq }` after every connect.
5. A second authenticated connection for the same `machineId` replaces the first.

Pre-authentication rules: the `auth` or `pair` frame must arrive within `C9VIEW_NODE_HANDSHAKE_MS` (10 s); before authentication only `auth` and `pair` frames of at most 4 KiB are accepted; every failed `pair`, and every `auth` naming an unknown key, counts against the client address (per-IP backoff, then 429 after `C9VIEW_NODE_MAX_FAILURES` in 15 minutes); the 4 KiB limit is the `ws` server's `maxPayload` until authentication.

## Steady state

| Frame           | Direction  | Fields                                                                    |
| --------------- | ---------- | ------------------------------------------------------------------------- |
| `event`         | node → hub | `{ event: NodeEvent }` (hint, IDs only)                                   |
| `req`           | hub → node | `{ id, method, path, query, body? (base64) }`, `id` unique per connection |
| `res`           | node → hub | `{ id, status, contentType }`                                             |
| `chunk`         | node → hub | `{ id, data }` (≤ 256 KiB payload before encoding)                        |
| `end`           | node → hub | `{ id }`                                                                  |
| `cancel`        | hub → node | `{ id }`; node aborts the request's signal                                |
| `ping` / `pong` | both       | every `C9VIEW_HEARTBEAT_MS`; three missed pongs close                     |

A message above `C9VIEW_WS_MAX_MESSAGE_BYTES` closes the socket (close code 1009).

No frame can set `control`, `bypass` or any node flag (FR-022). Send and receive queues are bounded; a slow browser stream is disconnected rather than allowed to stall the socket.

## Pairing (same endpoint)

Pairing uses the same `/api/nodes/connect` path, so it is the only path without an Origin check (FR-030). After the hub's `challenge`, an unpaired node sends `pair { code, publicKey, name?, signature }` (signature over the same challenge text with the new key) instead of `auth`. A valid, unexpired, unused code → `paired { machineId }`, the code is deleted and the socket closes; the node writes `identity.json` and reconnects with `auth`. Any failure closes with no detail. Used by `c9view node pair --hub <url> --code <code> [--name <name>]`.
