# Data Model: Components and Multiple Machines

From [spec.md](spec.md) Key Entities and the design draft's Data section ([notes](design-notes.md#data)). Wire shapes are in [contracts/](contracts/).

## Shared API types (`packages/api/src/machines.ts`, 6.0b)

| Type                  | Fields                                                                                                                                                                              | Rules                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MachineId`           | string                                                                                                                                                                              | `'local'` for the hub's in-process node; a random UUID (v4) assigned by the hub at pairing for remote nodes. Never taken from a node payload. |
| `CapabilityState`     | `'off' \| 'ready' \| 'unavailable'`                                                                                                                                                 |                                                                                                                                               |
| `MachineCapabilities` | `control: { state: CapabilityState; reason?: string }`, `bypass: boolean`                                                                                                           | Refreshed on every `hello`; advisory only — the node rechecks on every call.                                                                  |
| `MachineSummary`      | `machineId`, `name`, `state: 'online' \| 'offline'`, `lastSeenAt: string \| null` (ISO), `version`, `protocol`, `claudeCodeVersion?`, `outdated: boolean`, `bootId`, `capabilities` | `outdated` from 7c; `local` is always `online`.                                                                                               |
| `NodeHello`           | `name`, `version`, `protocol: number`, `claudeCodeVersion?`, `bootId`, `capabilities`                                                                                               | No `machineId`. `bootId` random per node process.                                                                                             |
| `NodeSnapshot`        | `projects: ProjectSummary[]`, `sessions: SessionSummary[]` (with status), `control: unknown` (002's `RunSummary[]`, empty before 002)                                               | Node payload, no `machineId`. Sent in chunks.                                                                                                 |
| `MachineEvent`        | `{ machineId; event: NodeEvent }`                                                                                                                                                   | Hub-made envelope.                                                                                                                            |
| `MachineStateEvent`   | `{ type: 'machine'; machineId; state: 'online' \| 'offline'; bootId? }`                                                                                                             | Emitted on connect (with `bootId`) and drop.                                                                                                  |
| `Partial` field       | `partial: MachineId[]` on merged Overview, projects, usage                                                                                                                          | Machines that missed the merge timeout.                                                                                                       |

**Changed types**: merged `ProjectSummary` and `SessionSummary` items carry `machineId` (hub-added, 7a). Node payloads never carry it.

**Identity rule**: on the hub and in the web, a project is keyed by `(machineId, projectId)`, a session by `(machineId, projectId, sessionId)`. Query keys start with `machineId` for every machine-scoped query; global keys (machines, hub health) don't.

**Cursor**: opaque string issued by a node, valid only on that machine and only for the route that issued it.

## Node-side types (`packages/node/src/transport.ts`, 6.0a)

`NodeRequest`, `NodeResponse`, `NodeEvent`, `NodeTransport`: see [contracts/node-transport.md](contracts/node-transport.md).

## Persistent state (c9view state folder, FR-031)

Root: `C9VIEW_STATE_DIR`, default `~/.claude/c9view/`. Folder and every subfolder 0700; files 0600; symlinked or foreign-owned folders and symlinked files refused.

| Path                             | Owner                              | Contents                                                                                                            | Lifecycle                                                                          |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `events.jsonl`, `events.1.jsonl` | hook entry (writer), node (reader) | metadata-only hook events, v1                                                                                       | Rotated above 20 MB (today's rules). Legacy path also read (research R6).          |
| `node/identity.json`             | node (7b)                          | `{ machineId: string (uuid), hubUrl: string (wss:// or loopback ws://), privateKey: string (PKCS#8 PEM, Ed25519) }` | Written once at `node pair`; never rewritten on upgrade; loss means pairing again. |
| `node/state.db`                  | node (002)                         | trust records and session labels                                                                                    | 002's data model.                                                                  |
| `hub/hub.sqlite`                 | hub (7b)                           | `machines`, `pairing_codes`                                                                                         | Persistent, not cache.                                                             |

### Hub store tables (7b)

| Table           | Columns                                                                                                              | Rules                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `machines`      | `id` (uuid, PK), `name` (1–80 chars), `publicKey` (Ed25519 SPKI PEM), `pairedAt` (ISO), `lastSeenAt` (ISO, nullable) | `lastSeenAt` is the only column written after pairing (FR-019). Revoke deletes the row.                  |
| `pairing_codes` | `codeHash` (SHA-256 hex, PK), `expiresAt` (ISO)                                                                      | Single use: deleted on success; expired rows deleted on read. TTL `C9VIEW_PAIRING_CODE_TTL_MS` (10 min). |

After the full test suite the hub store holds only these two tables (SC-007).

## In-memory state on the hub (7b, 7c)

| Item            | Per                         | Rules                                                                                                                   |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Registry entry  | machine                     | connection state, transport, last `NodeHello`, last `NodeSnapshot` (only used when offline), open-request count (≤ 16). |
| Pending request | request `id` per connection | deadline timers, cancel on browser abort.                                                                               |

## State transitions

- **Machine**: `paired` → `online` (socket + challenge + `hello` accepted) → `offline` (socket closed, heartbeat lost) → `online` (reconnect; fresh snapshot) … → `revoked` (row deleted, socket closed).
- **Pairing code**: `issued` → `used` (deleted) or `expired` (deleted).
- **Snapshot install** (hub, on connect): subscribe to events → read snapshot chunks → if an event arrived during the read, refresh → mark current.
