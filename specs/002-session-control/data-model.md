# Data Model: Session Control

From [spec.md](spec.md) Key Entities and the design draft's Data section ([notes](design-notes.md#data)). Node payloads never carry `machineId`; the hub adds it in envelopes (001 FR-005).

## Contract types (`packages/api/src/control.ts`, 6a)

| Type                | Fields and rules                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ControlCapability` | `state: 'off' \| 'ready' \| 'unavailable'`, `bypass: boolean`, `reason?: string`                                                                                                                                                                                      |
| `PermissionMode`    | `'default' \| 'acceptEdits' \| 'plan'` (browser-settable); `'bypassPermissions'` only as a reported run mode, never accepted in a body (400)                                                                                                                          |
| `RunState`          | `'starting' \| 'running' \| 'waiting' \| 'idle' \| 'ended' \| 'failed'`                                                                                                                                                                                               |
| `RunSummary`        | `runId`, `sessionId`, `projectId`, `state: RunState`, `mode`, `queued: number`, `costUsd?: number` (API-equivalent), `error?: string` (redacted), `startedAt`, `ownedByC9view: true`                                                                                  |
| `ControlRequest`    | `requestId`, `runId`, `sessionId`, `kind: 'permission' \| 'question'`, `createdAt`, `expiresAt`; permission: `toolName`, `summary` (redacted, tool-row style); question: `questions[]` with `question`, `header`, 2–4 `options { label, description }`, `multiSelect` |
| `ControlRuns`       | `{ runs: RunSummary[]; requests: ControlRequest[] }` — `GET …/control/runs`                                                                                                                                                                                           |
| `ReplyBody`         | `text` (1–20,000 chars), `fork?: boolean`, `clientRequestId` (uuid)                                                                                                                                                                                                   |
| `NewSessionBody`    | `text`, `permissionMode?`, `name?` (1–80 chars), `clientRequestId`                                                                                                                                                                                                    |
| `NewProjectBody`    | `location` (string), `gitUrl?` (`https://`, `ssh://`, `user@host:path`), `gitInit?` (default true when no `gitUrl`), `text`, `name?` (≤ 80), `permissionMode?`, `clientRequestId`                                                                                     |
| `DecisionBody`      | `clientRequestId` and one of `{ decision: 'allow' }`, `{ decision: 'deny'; message?: string (≤ 2,000) }`, `{ answers: Record<string, string \| string[]> }` (each value an option label or "Other" text ≤ 2,000)                                                      |
| `ModeBody`          | `mode: PermissionMode`, `clientRequestId`                                                                                                                                                                                                                             |
| `RunActionBody`     | `clientRequestId` (interrupt, stop)                                                                                                                                                                                                                                   |
| `TrustSummary`      | `path`, `fingerprint`, `hooks: string[]`, `mcpServers: string[]`, `allowRules: string[]`, `plugins: string[]`, `hasClaudeMd: boolean` — all redacted                                                                                                                  |
| `TrustBody`         | `path`, `fingerprint`, `clientRequestId`                                                                                                                                                                                                                              |
| `LabelBody`         | `label` (0–80 chars; empty removes), `clientRequestId`                                                                                                                                                                                                                |
| `CommandReceipt`    | `clientRequestId`, `bootId`, `operation`, `status: 'accepted' \| 'running' \| 'done' \| 'failed' \| 'cloning' \| 'ready'`, `runId?`, `sessionId?`, `projectId?`, `error?` (redacted)                                                                                  |
| `ControlConflict`   | `error`, `reason: 'live-elsewhere' \| 'liveness-unknown' \| 'payload-mismatch' \| 'unknown-outcome' \| 'untrusted-folder' \| 'settings-changed' \| 'decided' \| 'run-exists'`, `trust?: TrustSummary`                                                                 |
| `ControlBadRequest` | `error`, `reason?: 'outside-roots' \| 'bad-url' \| 'not-empty' \| 'bypass-not-allowed'`                                                                                                                                                                               |

Keys on the hub and in the web: `(machineId, runId)`, `(machineId, requestId)`, `(machineId, clientRequestId)`.

## In-memory state on the node

| Store                            | Contents                                                                                           | Lifecycle                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run registry (`runs.ts`)         | ≤ 1 run per session, ≤ `C9VIEW_CONTROL_MAX_RUNS` total; SDK query handle, input queue, state, cost | Idle close after `C9VIEW_CONTROL_IDLE_MIN`; all closed on `SIGINT`/`SIGTERM`                                                                                                                |
| Pending requests (`requests.ts`) | held original tool input, questions, resolver                                                      | Single use; deny after `C9VIEW_CONTROL_APPROVAL_MIN`; dropped with their run                                                                                                                |
| Receipts (`receipts.ts`)         | reservation, fingerprint, receipt; then a key-only tombstone `(operation, clientRequestId)`        | `C9VIEW_CONTROL_RECEIPT_MIN` (10 min) for receipts; tombstones for the whole boot, capped at `C9VIEW_CONTROL_TOMBSTONE_MAX` (never evicted; at the cap new mutations are `unknown-outcome`) |

## Node state store (`~/.claude/c9view/node/state.db`)

| Table             | Columns                                                         | PR                                        |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `trusted_folders` | `path` (real path, PK), `fingerprint`, `trustedAt`              | 6a                                        |
| `session_labels`  | `projectId`, `sessionId` (PK pair), `label` (1–80), `updatedAt` | 6d; read and written only with control on |

Read-only input: `~/.claude.json` → `projects[path].hasTrustDialogAccepted`.

## State transitions

- **Run**: `starting` → `running` ⇄ `waiting` (requests pending) → `idle` (result) → `running` (next reply) … → `ended` (stop, idle close, shutdown) or `failed` (error).
- **Request**: `pending` → `allowed` / `denied` / `answered` / `timed-out` (deny) / `aborted` (run ended).
- **Receipt**: `reserved` → `accepted` → `done` or `failed`; project creation: `cloning` → `ready` → (trust) → `done`, or `failed`.
- **Folder**: `untrusted` → `trusted` (owner confirms matching fingerprint) → `untrusted` again when the fingerprint changes.
