# Data Model: Remote Control of Terminal Sessions

From [spec.md](spec.md) Key Entities and [research.md](research.md). Node payloads never carry `machineId`; the hub adds it in envelopes (001 FR-005). All new contract types are additive in `packages/api/src/control.ts` or `packages/api/src/index.ts`, except the removal of `ReplyBody.fork` ([research R8](research.md#r8-replybodyfork-open-question)).

## Contract types

| Type | Fields and rules | PR |
| ---- | ---------------- | -- |
| `RemoteUnavailableReason` | `'control-unavailable' \| 'unsupported-platform' \| 'own-run' \| 'not-live' \| 'liveness-unknown' \| 'address-invalid' \| 'not-interactive' \| 'too-old' \| 'unknown-protocol' \| 'no-address' \| 'token-required' \| 'inbound-refused'` ([research R7](research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018)). `own-run` and `not-live` mean "use 002's reply". `token-required` is reserved; nothing returns it on Linux. | 003-b |
| `RemoteAvailability` | `sessionId`; `available: boolean`; `reason?: RemoteUnavailableReason` (set iff not available); `minVersion?: string` (with `too-old`); `inbound?: 'hold' \| 'may-hold'` (`hold`: the settings say the session holds messages, or hold on an invalid value; `may-hold`: the key is unset and the receiver is in `bypassPermissions` or its mode is unknown; advisory, never blocks a send); `sessionState?: 'idle' \| 'busy' \| 'waiting' \| 'unknown'` (from the live file's `status`, mapped; the raw `waitingFor` text is never forwarded); `checkedAt` (ISO). Never carries the socket path, PID or version string. | 003-b |
| `RemoteSendBody` | `text` (1–20,000 characters, 002's `C9VIEW_CONTROL_TEXT_MAX_CHARS`; must not contain `cross-session-message`, case-insensitive), `clientRequestId` (uuid). Strict: unknown fields → 400. | 003-b |
| `RemoteDeliveryState` | `'sent' \| 'delivered' \| 'not-seen' \| 'uncertain' \| 'failed'` | 003-b |
| `RemoteDelivery` | `state: RemoteDeliveryState`; `turn?: 'new-turn' \| 'next-step'` (only with `delivered`); `reason?: 'session-ended' \| 'unreachable'` (only with `failed`); `sentAt?`, `deliveredAt?` (ISO; `deliveredAt` is the transcript record's timestamp, which for a released hold is the release time) | 003-b |
| `CommandReceipt` (002) | gains optional `delivery?: RemoteDelivery`, set only for operation `remote`. `status` stays 002's: `done` once the frame is written (`sent`, `uncertain`, later `delivered` or `not-seen`), `failed` when nothing was sent. | 003-b |
| `ControlConflictReason` (002) | gains `'remote-unavailable'`; `ControlConflict` gains optional `availability?: RemoteAvailability` | 003-b |
| `ControlBadRequest` (002) | `reason` gains `'bad-text'` | 003-b |
| `ControlEvent` (002) | gains `{ type: 'control.remote'; clientRequestId; projectId; sessionId }` | 003-b |
| `Message` (`packages/api/src/index.ts`) | gains `sentFrom?: 'c9view' \| 'peer'` and `sentFromVerified?: boolean` (only with `'c9view'`) | 003-a |
| `ReplyBody` (002) | loses `fork` | 003-d |

Keys on the hub and in the web: `(machineId, projectId, sessionId)` for availability, `(machineId, clientRequestId)` for receipts.

## Node-only data (never leaves the node)

| Item | Contents | Lifetime |
| ---- | -------- | -------- |
| Live entry (read) | Parsed `sessions/<pid>.json`: `pid`, `sessionId`, `procStart`, `pidDomain`, `kind`, `entrypoint`, `version`, `peerProtocol`, `messagingSocketPath`, `status`, `cwd`. Zod with an explicit pick schema (`z.object({...}).strip()`, never passthrough), so a `peerToken` in the file is dropped at parse time; every field optional except `sessionId`. A `.json` without `sessionId` is skipped silently and does not cause liveness-unknown ([contracts/live-status.md](contracts/live-status.md)). There is no permission-mode field in the file. | One check or one send; never stored, logged or returned. |
| Receiver mode (transcript tail) | The last `permission-mode` record, or else the last `permissionMode` string, from the last 64 KiB of the session transcript; absent = unknown. | Read per check, node-only, never stored or returned. |
| Socket address | The validated `messagingSocketPath`. | In memory for one connect; dropped after. |
| Pending delivery (`tracker.ts`) | `msg_id`, operation key (`remote:<clientRequestId>`), `projectId`, `sessionId`, transcript file path, byte offset at send, not-seen timer. No text. | Until `delivered`, or until the receipt is gone: on each tick the tracker asks 002's `Receipts.has(operation, id)` (read-only, additive) and drops the entry when it returns false. Lost on restart. |
| Receipt (002 `receipts.ts`) | 002's reservation: fingerprint (SHA-256 of the body without `clientRequestId`), receipt with `delivery`; then 002's key-only tombstone. | 002's lifetimes. |
| Node self identity | `process.pid` and this process's `procStart` (`/proc/self/stat` field 22), for `sentFromVerified`. | Process lifetime. |

No new file, table or state-folder record. The node state store (`state.db`) is unchanged.

## Transcript records read (core, `packages/core/src/transcript/peer.ts`)

| Record | Shape used (all optional, passthrough) | Maps to |
| ------ | -------------------------------------- | ------- |
| Peer prompt (idle) | `type: "user"`, `isMeta: true`, `origin: { kind: "peer", from, name, msg_id, verifiedPeerPid, verifiedPeerProcStart, body }`, `message.content` (receiver's wrapper text) | `Message { role: 'user', sentFrom, sentFromVerified }`, display text = `origin.body` minus the attribution line |
| Peer message mid-turn | `type: "attachment"`, `attachment: { type: "queued_command", prompt, origin: {…} }` | same `Message`, `uuid` from the record; today these records are skipped |
| Typed prompt | `type: "user"`, `origin.kind: "human"` or no `origin` | unchanged, no `sentFrom` |

A record is from c9view when `origin.kind === "peer"`, `origin.from === "uds:/dev/null/c9view"` and `origin.name === "c9view"`; both record types carry these fields, so there is no wrapper-content fallback. A peer record missing either field gets `sentFrom: 'peer'` ([research R6](research.md#r6-sent-from-c9view-label-fr-013-us3)). Other `origin.kind === "peer"` records get `sentFrom: 'peer'` and keep today's display. The SQLite index is unchanged (no migration): message text for search keeps whatever the indexer stores today.

## State transitions

- **Remote command**: `reserved` → (check fails: 409 `remote-unavailable`, nothing sent) | (write) → `sent` → `delivered` (record found) | `not-seen` (timer) → `delivered` (record found later, while the receipt lives; a held message released at the terminal keeps its `msg_id`). There is no state for an earlier "accepted by the session" step. Write timeout or break after bytes → `uncertain` → `delivered` possibly. Connect or early write error → `failed` (`session-ended` or `unreachable`). Every transition emits `control.remote`. No transition ever resends.
- **Availability** (per session, recomputed on each check): `remote` (available) ⇄ `refused` (a reason other than `not-live`/`own-run`) ⇄ `reply` (`not-live` or `own-run`). The web switches the composer mode on each change and keeps the typed text.
