# Contract: Control events (hints)

Emitted by the node's `EventHub`, wrapped by the hub as `MachineEvent { machineId, event }` on `/api/events` (001 FR-018). IDs only: no card content, tool input, answers, text or state.

| `event.type`               | Fields                            | Web reaction                                                 |
| -------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `control.run`              | `runId`, `sessionId`, `projectId` | refetch `GET …/control/runs`                                 |
| `control.request`          | `requestId`, `runId`, `sessionId` | refetch runs; live-region announcement once the card arrives |
| `control.request.resolved` | `requestId`                       | refetch runs                                                 |
| `control.project`          | `clientRequestId`                 | refetch the receipt                                          |

After any gap (SSE reopen, `machine` reconnect event) the web refetches runs and any receipt it is waiting on. A missed or reordered event can delay an update, never corrupt it.
