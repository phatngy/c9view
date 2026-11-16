# Contract: Remote send API

Paths are relative to `/api/m/:machineId` (or the `local` alias), relayed by the hub to the node that holds the session (FR-019). Both routes exist only when control is on for that node; with control off each answers 404 (FR-001). Every `POST` passes the hub's `apps/hub/src/control/guard.ts` first (JSON, allowed `Origin`, `X-C9view-Control: 1`, authenticated, `X-C9view-Boot-Id`), as in [002's control API](../../002-session-control/contracts/control-api.md). Types in [data-model.md](../data-model.md).

| Method and path | Body | Success | Errors | PR |
| --------------- | ---- | ------- | ------ | -- |
| `GET /projects/:projectId/sessions/:sessionId/remote` | — | 200 `RemoteAvailability` | 404 unknown project or session, or control off | 003-b |
| `POST /projects/:projectId/sessions/:sessionId/remote` | `RemoteSendBody` | 202 `CommandReceipt` with `operation: 'remote'`, `status: 'done'`, `delivery: { state: 'sent' \| 'uncertain' }`; or 202 with `status: 'failed'`, `delivery: { state: 'failed', reason }` | 400 invalid body, `bad-text`; 413 body above 48 KiB or frame above 128 KiB; 409 `remote-unavailable` (+ `availability`), `payload-mismatch`, `unknown-outcome`; 404 as above | 003-b |
| `GET /control/receipts/:clientRequestId` (002) | — | 200 `CommandReceipt`; `delivery` moves to `delivered` (+ `turn`) or `not-seen` | 404 expired | 002 |

Rules:

- The node reserves `(remote, clientRequestId)` before anything else (002 FR-021). A repeat with the same body returns the same receipt and never writes again; a changed body → 409 `payload-mismatch`; an unknown key after a restart, a tombstoned key, or the tombstone cap → 409 `unknown-outcome`. The hub never retries.
- Sends to the same session are written in the order the node receives them (002's per-session chain).
- The availability check ([research R7](../research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018)) runs again inside the reservation, right before connecting. A failed check → 409 `remote-unavailable` with the fresh `availability`; nothing is written.
- 202 returns once the frame is written or has failed; it never waits for Claude (FR-009). The write has a time limit (`C9VIEW_REMOTE_SEND_TIMEOUT_SEC`, 3 s); a timeout is `uncertain`, never resent.
- No response, event or error carries the socket path, PID, version string, token or message text. Error messages are fixed strings.
- 002's `POST …/messages` is unchanged for 003: a session held by a live terminal process still gets 409 `live-elsewhere` from it (the node never resumes a live session). The web uses this route instead whenever availability is `available`.

## Reasons and fixes

What the web shows for each `RemoteUnavailableReason` (the node sends only the reason; the text lives in the web).

| Reason | Text | Fix shown |
| ------ | ---- | --------- |
| `not-live`, `own-run` | (none: the composer is 002's reply) | — |
| `liveness-unknown` | "c9view can't tell whether another process holds this session." | "Check the terminal. Nothing is sent or resumed until c9view can tell." |
| `too-old` | "Update Claude Code to {minVersion} or newer." | "Restart the session in the terminal after updating." |
| `no-address` | "This session can't be reached: it has no messaging address." | "Update Claude Code, or turn on cross-session messaging in that session." |
| `unknown-protocol` | "This session uses a messaging version c9view doesn't know." | "Update c9view." |
| `not-interactive` | "This is not an interactive terminal session. Only those can receive messages." | — |
| `address-invalid` | "This session's messaging address can't be confirmed as its own." | "Restart the session in the terminal." |
| `inbound-refused` | "This session refuses messages from other sessions." | "Change `crossSessionInbound` in that session's settings." |
| `token-required` | "This session can't be reached: it requires a token c9view doesn't keep." | — |
| `unsupported-platform` | "Sending to terminal sessions isn't supported on this machine yet." | — |
| `control-unavailable` | 002's control `unavailable` text | 002's fix |

## Warnings on an available session

Shown above the composer when `RemoteAvailability.inbound` is set. Send stays enabled.

| `inbound` | Text | Fix shown |
| --------- | ---- | --------- |
| `hold` | "This session holds messages until you let them in at the terminal." | "Let it in at the terminal, or set `crossSessionInbound` to `accept` in your user settings." |
| `may-hold` | "This session may hold messages from c9view: it may be in bypass mode, or its permission mode isn't known." | "If nothing arrives, let it in at the terminal, or set `crossSessionInbound` to `accept` in your user settings." |

Both are advisory: managed and `--settings` sources are unreadable, so "not seen yet" remains the fallback.

## Delivery texts

| `delivery` | Text |
| ---------- | ---- |
| `sent` | "Sent. Waiting for the session to pick it up…" |
| `delivered`, `new-turn` | "Delivered: Claude is starting a new turn." |
| `delivered`, `next-step` | "Delivered: Claude sees it at its next step." (time shown is the transcript record's) |
| `not-seen` | "Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages." Tracking continues; it can still become `delivered`. |
| `uncertain` | "This may have been sent. c9view is watching the conversation for it." |
| `failed`, `session-ended` | "Not delivered: the terminal session ended." (also for a refused connection when the process is gone or no longer matches) |
| `failed`, `unreachable` | "Not delivered: the session couldn't be reached." |
| receipt 404 while waiting | "c9view stopped tracking this message. Check the conversation." |

## Socket frame

The one line the node writes to the session's socket ([research R4](../research.md#r4-wire-frame-and-attribution-fr-011)), then ends the connection without reading:

```json
{"msgV":1,"msg_id":"<uuid v4>","type":"user","message":{"role":"user","content":"<cross-session-message from=\"uds:/dev/null/c9view\" from-name=\"c9view\">\nSent by this session's owner from c9view.\n\n<text>\n</cross-session-message>"},"priority":"next","from":"uds:/dev/null/c9view"}
```

No auth line, no `from-mode`. Built only by `packages/node/src/remote/frame.ts`.
