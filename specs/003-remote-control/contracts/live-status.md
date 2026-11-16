# Contract: inputs read from Claude Code

What 003 reads from Claude Code, as observed in the [spike](../spike.md) on Claude Code 2.1.318 (Linux). Undocumented by Claude Code; parsed with Zod schemas that tolerate unknown fields and treat every field as optional (constitution Principle IV). Anything missing or malformed fails closed ([research R7](../research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018)).

## `<claudeDir>/sessions/<pid>.json`

Read by `packages/node/src/remote/discovery.ts` (with 002's existing `*.json` filter; `*.key` files are never opened).

| Field | Type | Use |
| ----- | ---- | --- |
| `sessionId` | string | match the session (required) |
| `pid` | positive integer | alive check, socket name |
| `procStart` | decimal string of digits | equals `/proc/<pid>/stat` field 22 (clock ticks since boot), parsed after the last `)` of the line (PID reuse guard) |
| `pidDomain` | string or number | same PID namespace as the node (002) |
| `kind` | string | must be `interactive` (other values seen: `bg`, `daemon`, `daemon-worker`) |
| `entrypoint` | string | must be `cli`; `claude -p` runs are `interactive` with `sdk-cli`. Anything else, or missing → `not-interactive` |
| `version` | string `x.y.z` | ≥ 2.1.318 |
| `peerProtocol` | integer | must be `1` |
| `messagingSocketPath` | string | bare absolute path, `<dir>/cc-socks/<pid>.sock` or `/tmp/cc-socks-<uid>/<pid>.sock` |
| `status` | string | `idle`, `busy`, `waiting` → `sessionState`; anything else → `unknown`. A stale file (dead PID) keeps its last `status`, so it is read only after the pid and `procStart` checks pass |
| `cwd` | string | settings lookup for `crossSessionInbound` |
| `waitingFor`, `name`, `tmux`, `peerFeatures`, `peerToken`, others | — | not picked: the discovery schema lists the fields above explicitly and strips the rest, so a `peerToken` is dropped at parse time and never kept, logged, stored or returned |

The status file has no permission-mode field; the receiver's mode comes from its transcript (below). A `.json` without `sessionId` (token-only files carrying `peerToken`, `pidDomain`, `procStart`) is skipped silently and does not make liveness unknown.

## Settings (`crossSessionInbound`)

Values `accept`, `hold`, `refuse`. Read by `inbound.ts`, a small dedicated reader (not `readSettings`, `mergeSettings` or `settingSource`), through core's root-confined `readTextResult`. Exactly three layers: user `<claudeDir>/settings.json` (`<claudeDir>/settings.local.json` is ignored for this key); project `<cwd>/.claude/settings.json`; local `<cwd>/.claude/settings.local.json`, with `cwd` from the status file. Only `crossSessionInbound` is parsed, with Zod. The user value is the base (managed policy and the `--settings` flag can't be read, so the result is advisory). Project or local replace it only when stricter (accept < hold < refuse). An invalid value, or a layer that exists but can't be read or parsed, counts as `hold`. Unset: a prompting-class receiver accepts c9view's message (it asserts no `from-mode`); a `bypassPermissions` or unknown-mode receiver holds it. Full rule in [research R7](../research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018) step 15; evidence in the [re-spike](../spike.md#item-7-detail-crosssessioninbound).

## Receiver permission mode (session transcript)

Not in the status file. `remote/mode.ts` reads the last 64 KiB of the session's transcript on each check, Zod-tolerant: the last `permission-mode` record, or else the last `permissionMode` string on a record. None found means unknown (treated as may-hold when `crossSessionInbound` is unset). Node-only, never stored or returned.

## Transcript records

See [data-model.md](../data-model.md#transcript-records-read-core-packagescoresrctranscriptpeerts). The tracker matches `origin.msg_id` on `type: "user"` records (→ `new-turn`) and on `type: "attachment"` with `attachment.type: "queued_command"` (→ `next-step`). Both carry `origin.msg_id`, `from` and `name` (re-spike item 1). `queue-operation` records are not used (no `msg_id`, item 2).
