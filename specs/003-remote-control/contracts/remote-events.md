# Contract: Remote send events (hints)

Emitted by the node's `EventHub` (`packages/node/src/data/events.ts`), wrapped by the hub as `MachineEvent { machineId, event }` on `/api/events`, like [002's control events](../../002-session-control/contracts/control-events.md). IDs only: no text, address, PID or outcome.

| `event.type` | Fields | When | Web reaction |
| ------------ | ------ | ---- | ------------ |
| `control.remote` | `clientRequestId`, `projectId`, `sessionId` | each `delivery` transition: `sent`, `uncertain`, `failed`, `delivered`, `not-seen` | refetch `GET …/control/receipts/:clientRequestId` and the session's availability |
| `session` (001, existing) | `projectId`, `sessionId` | transcript changed | existing conversation refresh; also refetch availability |

After any gap (SSE reopen, `machine` reconnect) the web refetches the receipt it is waiting on and the availability. A missed or reordered hint can delay an update, never corrupt it.
