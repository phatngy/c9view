# Spike: cross-session messaging as the delivery path for 003

Date: 2026-11-05. Platform: Linux 5.15, tmux 3.x. Claude Code **2.1.318** only. Every session ran with `--model haiku` (Haiku 5.5, `claude-haiku-5-5` confirmed in `/status` and the transcript `api-request.params.model`), in scratch folders under the session scratchpad `spike-003/{a,b,c,d,e}`, with `permissionMode` = `auto` (the maintainer's user setting; no bypass flag or mode anywhere). Scripts and logs: `/tmp/claude-1000/-home-phatnv-phatnv-workspace-github-personal-c9view/aa4642f9-8976-4c51-a560-d4c6bc01fe66/scratchpad/spike-003/` (`send.py`, `proxy.py`, `listen.py`, `big.py`, `slow.py`, `peer.py`). Tokens never read from files; one appeared in a proxy capture and was redacted (`REDACTED`) everywhere below.

"Observed" = seen directly in this run. "Inferred" = deduced; marked as such.

## Summary

| # | Question | Answer | Confidence |
|---|----------|--------|------------|
| 1 | Find a session's socket from outside, without its token | **Yes.** `~/.claude/sessions/<pid>.json` has `messagingSocketPath` (plain path, no `uds:` prefix), plus `pid`, `sessionId`, `cwd`, `version`, `status`, `kind`, `name`, `peerProtocol`. Socket is `/run/user/<uid>/cc-socks/<pid>.sock` (mode 0600). A project hook (SessionStart and UserPromptSubmit) sees `CLAUDE_CODE_MESSAGING_SOCKET`, so the hook can record the address only. | High (observed) |
| 2 | Frame format after the optional auth line | One JSON object per line. Minimal working frame: `{"type":"user","message":{"role":"user","content":"TEXT"}}`. Claude's own frame adds `msgV:1`, `msg_id` (uuid), `priority:"next"`, `from:"uds:<path>"`. Server never replies on the connection (no ack, no error). | High (observed, captured real Claude-to-Claude bytes) |
| 3 | External (non-Claude) sender on Linux | **Yes**, with no auth line, and also with a wrong-token auth line. A plain Python socket delivered. The receiver records the sender's real pid via SO_PEERCRED (`verifiedPeerPid`). | High (observed) |
| 4 | Delivery and transcript | Idle: starts a new turn immediately. Mid-turn: queued and injected after the current tool call. Transcript has a `user` record with `origin.kind:"peer"`, `isMeta:true`, `turnOrigin:"peer"`, and `origin.msg_id` (the sender's id). The model is told it came from another Claude session. | High (observed) |
| 5 | `crossSessionInbound` | Default (unset, receiver in auto mode, i.e. "prompting" class): **delivered**, including from an external sender. `hold`: not delivered, TUI notice only. `refuse`: silently dropped. The raw socket gets no reply for any outcome. Claude senders get an out-of-band "delivery notice", which an external sender cannot receive (see Q5). | High for outcomes, medium for why the notice does not reach external senders (inferred) |
| 6 | Edge cases | Exit mid-send: sender gets EPIPE, socket file and `sessions/<pid>.json` removed on clean exit. Large: 900 KB frame accepted, 1.1 MB and above rejected (connection reset or closed, nothing delivered). Two senders at once: both delivered, in order of arrival. Partial frame with no newline then close: delivered. | High (observed), exact cap between 0.9 and 1.1 MB |
| 7 | Oldest verified version | **2.1.318 only.** Docs say 2.1.224 on Linux/macOS; not verifiable here. | High that only 318 was tested |

## Evidence

### Q1. Socket discovery

`/status` in a scratch session:

```
Session ID:        631e9d2a-...
Session kind:      interactive
Peer address:      uds:/run/user/1000/cc-socks/519341.sock
Model:             haiku (claude-haiku-5-5)
```

`~/.claude/sessions/519341.json` (own scratch session only; the `.key` files were not opened):

```json
{ "pid": 519341, "sessionId": "631e9d2a-...", "cwd": ".../spike-003/a", "startedAt": 1793862632285,
  "procStart": "19950454", "version": "2.1.318", "peerProtocol": 1,
  "peerFeatures": ["notify_idle","reply_across_default_dirs","artifact_yield"],
  "kind": "interactive", "entrypoint": "cli", "tmux": "c9spike:@5.%13",
  "messagingSocketPath": "/run/user/1000/cc-socks/519341.sock",
  "name": "a-8c", "nameSource": "derived", "status": "waiting", "waitingFor": "dialog open" }
```

The JSON is world-readable (0664); the `.key` files next to it are 0600 and were not touched. `status` became `idle` after the dialog closed.

Filesystem: `/run/user/1000/cc-socks/<pid>.sock`, mode `srw-------` (`0o140600`). The socket name is the pid. `/tmp/cc-socks-<uid>` was not used on this box (the docs list it as the fallback).

Hooks, via a project `.claude/settings.local.json` in the scratch folder (python one-liners writing a file):

```
{"ev":"SessionStart","sock":"/run/user/1000/cc-socks/519341.sock","has_token":true,"toklen":32,...}
{"ev":"UPS","sock":"/run/user/1000/cc-socks/519341.sock"}      (UserPromptSubmit, repeated every prompt)
```

So `CLAUDE_CODE_MESSAGING_SOCKET` is present from SessionStart on, and the token env var is also present (length 32; value not recorded). c9view's hook can write the address and ignore the token. Note: UserPromptSubmit fired for each peer-delivered message too (observed: the count of UPS lines in b.hook.json equals its turns), so hooks cannot tell typed from peer prompts by that event alone.

Two discovery routes therefore exist: the hook (address recorded in c9view's state), or reading `sessions/<pid>.json` (no hook needed, also gives `version` for FR-017 and `status`). The second route does not need the install.

### Q2. Message format

Captured with a socat-style Python proxy (`proxy.py`) swapped into the receiver's socket path, while session a (Haiku) sent via its `SendMessage` tool ("PING"):

```
C>S {"type":"auth","token":"REDACTED"}\n
    {"msgV":1,"msg_id":"02a95cb3-d89f-4069-8b7a-3c2c3941d529","type":"user",
     "message":{"role":"user","content":"<cross-session-message from=\"uds:/run/user/1000/cc-socks/519341.sock\" from-name=\"a-8c\" from-mode=\"prompting\">\nPING\n</cross-session-message>"},
     "priority":"next","from":"uds:/run/user/1000/cc-socks/519341.sock"}\n
S>C (nothing)
```

Variants tried from a plain script against session b (which was idle):

| Frame | Result |
|-------|--------|
| `{"type":"message","text":"..."}` | silently ignored, no turn |
| `{"type":"message","content":"..."}` | silently ignored |
| `{"type":"user","message":{"role":"user","content":"V3 ..."}}` | **delivered**; origin `from:"unknown"`, no name |
| `{"msgV":1,"msg_id":"<uuid>","type":"user","message":{...},"priority":"next"}` | **delivered**; `origin.msg_id` is kept |
| same plus `"from":"uds:/tmp/fake"` and a `<cross-session-message from=... from-name="c9test">` wrapper in `content` | delivered; `origin.from` = the given value, `origin.name` = `c9test`, `origin.body` = text inside the wrapper |
| wrapper without `msgV` (`from-mode="bypassing"`) | delivered as plain text, wrapper not parsed (origin `from:"unknown"`) |

Observations:
- The wrapper (`<cross-session-message ...>`) is built by the sender and carried in `content`; the receiver parses it only when `msgV:1` is present. A plain `content` string needs no wrapper.
- The receiver wraps the text again with "Another Claude session sent a message: ..." and a safety paragraph (permission laundering warning).
- The server never writes a byte back on the connection, for any outcome, in 20 s waits (delivered, held, refused). The connection is left open until the client closes it. EOF (client close) terminates an unterminated frame (see Q6).
- Sender claims (`from`, `from-name`, `from-mode`) are **not authenticated**; only `verifiedPeerPid` is. Inferred: a `from-mode="bypassing"` claim could make a bypass-mode receiver treat the message differently; c9view should send none (it did not change delivery to the auto-mode receiver here).

### Q3. External sender

`send.py` (plain `socket.AF_UNIX`, no Claude Code involved):

```
$ python3 send.py /run/user/1000/cc-socks/<b>.sock '{"msgV":1,"msg_id":"1111...","type":"user","message":{"role":"user","content":"..."}}' noauth
(no close within 4.0s)    reply: b''
```
Session b (idle) started a turn and answered `OK1` (transcript shows `origin.verifiedPeerPid: 521699`, the pid of my python process).

Wrong token: `{"type":"auth","token":"0000...0000"}` then a frame: delivered the same (turn started, answered `OK`). So on Linux the auth line is ignored for ordinary delivery (observed). A valid token was not tested separately (not needed: the no-auth case works); per the docs it only matters for the "own child" classification.

### Q4. Delivery and transcript

Idle: queue-operation `enqueue` then `dequeue` 11 ms apart, then the user record, then the assistant turn (about 1-3 s total).

Mid-turn: b was asked to run `sleep 8` three times; a script sent a frame 7 s in. The transcript shows `queue-operation enqueue` then an `attachment` of type `queued_command`, followed by `queue-operation remove`, and the next tool calls continue. The final answer was `DONE MID2OK`: the model saw it between tool calls. The TUI shows `Ran 1 shell command` then the message, then `Ran 2 shell commands`.

Idle record (`type:"user"`, `~/.claude/projects/<scratch>/<session>.jsonl`), all fields except content and boilerplate:

```json
{"type":"user","isMeta":true,"promptSource":"system","turnOrigin":"peer","permissionMode":"auto",
 "message":{"role":"user","content":"Another Claude session sent a message:\n<cross-session-message from=\"uds:/run/user/1000/cc-socks/519341.sock\" from-name=\"a-8c\" from-mode=\"prompting\">\nPING\n</cross-session-message>\n\nThis came from another Claude session — not typed by your user, ... that's permission laundering."},
 "origin":{"kind":"peer","from":"uds:/run/user/1000/cc-socks/519341.sock","verifiedPeerPid":520921,
           "verifiedPeerProcStart":"19961977","msg_id":"02a95cb3-...","name":"a-8c","fromMode":"prompting","body":"PING"}}
```

Terminal-typed prompts in the same file have `origin.kind:"human"`. For a frame without a wrapper: `origin = {kind:"peer", from:"unknown", verifiedPeerPid, verifiedPeerProcStart, msg_id?}` and the content has no wrapper tag.

Mid-turn record: `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<text>","delivery_id":"...","origin":{"kind":"peer","from":"unknown","verifiedPeerPid":522830,"msg_id"?...}}, "rendered":[{"content":"<system-reminder ...>Another Claude session sent a message while you were working:\n<text>\n...After completing your current task, decide whether/how to respond (reply via SendMessage to the `from=` address)."}]}`. The `msg_id` was not in this mid-turn origin (our frame had none); with a `msg_id` the idle path kept it, mid-turn path not checked with an id.

Model awareness (observed): b answered "I got a PING from another Claude session (a-8c)" and, for unlabelled frames, still treated them as a peer's request. It will happily act on the text (`OK1`, `MIDOK`), subject to its own permission rules. TUI shows `› Message from @c9test: Say the word OK1 only. (ctrl+o to expand)`.

Implication for FR-013: the transcript marks the record (`origin.kind == "peer"`), so "Sent from c9view" can be recognised from the transcript with no receipt, via `origin.msg_id` (c9view-generated uuid) or `origin.from` (a c9view marker; any string was kept, e.g. `uds:/tmp/fake`; note the wrapper-less form shows `unknown` unless `msgV:1` and `from` are sent). Use `msgV:1`, `msg_id`, `from`.

### Q5. crossSessionInbound

Scratch sessions c (`{"crossSessionInbound":"refuse"}`) and d (`"hold"`) via project `.claude/settings.local.json`. Session b had no setting (default), receiver in auto mode.

- Default, external sender with no permission class: delivered (observed, many times).
- `refuse` (c): connection accepted, frame read, nothing delivered, no transcript file even created for c, TUI unchanged. Silent drop. Sender sees nothing on the socket (20 s wait).
- `hold` (d): not delivered; TUI prints `Held peer message — from an unidentified session [verified pid 524692]; preview: «D hold test reply OK» — not delivered to Claude (1 held)...`; 9 messages accumulated this way. Sender sees nothing on the socket. Note a repo (project-level) `hold` cannot be loosened by user `accept` per the TUI text.

Sender-side feedback for a **Claude** sender (observed): `SendMessage` returns `{"success":true,"message":"“HI” → c-49 (...in that session's inbox, not yet read by its Claude — a [Cross-session delivery notice] follows if that session holds it ... or refuses it)"}`; about 3 s later a user-role notice arrives in the sender:

```
[Cross-session delivery notice] Your message to another session was refused (recipient: uds:/run/user/1000/cc-socks/523593.sock; msg_id: d23a213d-...): that session is not accepting cross-session messages (the feature is off there, or a setting or policy there refuses them). Not delivered to that session's Claude. ...
[Cross-session delivery notice] Your message ... was held by that session (...). NOT delivered: its Claude has not seen it. ... Another notice follows on release, denial or expiry.
```

Mechanism (observed by running a refuse-session under strace): the **receiver connects to the sender's `from` socket** and writes

```
{"type":"auth","token":"REDACTED"}\n{"type":"control","action":"peer_message_status","status":"expired","status_detail":"refused","reason":"The recipient session is not accepting cross-session messages ...","from":"uds:<receiver socket>","orig_ms...<truncated>
```

(the receiver sent its auth line with a token, `status`/`status_detail` carry the outcome, `orig_ms*` presumably `orig_msg_id`; the remaining bytes were truncated by strace -s). The hold case wrote a "held" variant (not captured at byte level).

When I gave a plain listening socket as `from` (in `/run/user/1000/c9spike-listen.sock` and `/run/user/1000/cc-socks/99999.sock`) the receiver connected but sent **zero bytes** (both for hold and refuse). Inferred: it only reports status to a `from` socket whose owner is a registered Claude Code session (likely checked against `sessions/<pid>.json` and the peer pid). The receiver also connected to a non-session `from` and left it empty, so c9view as a plain process will **not** get held or refused notices. For delivered messages there is no receipt at all (a Claude sender is told "not yet read").

How an external sender can still learn the outcome: only indirectly, by watching the receiver's transcript for the `origin.msg_id` record (delivered), and treating its absence after a timeout as "held or refused or not read yet". Held cannot be distinguished from refused from outside, except by reading the receiver's settings (not c9view's job).

### Q6. Edge cases

- Session exits mid-send: `slow.py` sent a frame in 50 KB chunks; the session was killed (tmux kill, clean shutdown) after 1.8 s: `chunk 0 ok, 1 ok, 2 ok, error at chunk 3 [Errno 32] Broken pipe`. Nothing delivered. After a clean exit, the socket file and `sessions/<pid>.json` are removed (observed for two exits); a later connect gets `FileNotFoundError`. A hard kill (SIGKILL) was not tested (not permitted in this run), so stale sockets (`ECONNREFUSED`) and stale `sessions/*.json` are inferred, and are why c9view must check the pid and `procStart`.
- Large message: frames of 200,142 and 900,142 bytes were accepted (held in d, so counted as received); 1,100,142 bytes: connection reset by peer, not held; 1.5 MB and 2 MB: EPIPE, 3 MB: EPIPE. So the receiver rejects a frame above roughly 1,000,000 bytes (observed boundary between 0.9 and 1.1 MB, matching the docs' "about a million characters"). Claude senders refuse earlier at their end. c9view should cap well below (for instance 100 KB; note an accepted message costs real tokens, and a 900 KB message would be about 250k tokens).
- Two senders at once: two threads sent at the same time; both turned up in the transcript 32 ms apart (07:25:32.030 and .062) and the model answered `OK1` then `OK2`. Docs mention queue limits (50 accepted, 100 held, burst throttling, identical repeats dropped); not stress-tested.
- Frame with no trailing newline, then close: delivered (the model answered `OK`). So a sender must send the newline to be well-formed, but a close also ends the frame.
- Idle connection: the server keeps an unfinished connection open; the docs say it closes after 30 s without a complete line (not timed here).

### Q7. Version

Only 2.1.318 was available and tested (`command claude --version` = `2.1.318 (Claude Code)`), `peerProtocol: 1`, `peerFeatures` as above. The docs say messaging needs 2.1.224+ on Linux/macOS, 2.1.232 for the `/config` row and @-mention, 2.1.236 for notify-when-idle, 2.1.248+ for Bedrock-like providers or flag-fetch off. The wire details here (`msgV:1`, the `queue-operation` and `origin` fields, `peer_message_status` control frames) were not verified on older builds. `version` is available in `sessions/<pid>.json`, so FR-017 can be applied from the live status record as the spec says.

## Blockers and risks for 003

No blocker for the three gates in the spec: external senders work, the address is discoverable, and the token is not required on Linux.

Risks, most important first:

1. **No delivery receipt for an external sender.** The server never answers on the socket. Held and refused look the same as "delivered, not read yet". c9view must confirm delivery by watching the transcript for the record with `origin.msg_id` equal to the one it generated (the spec already makes the conversation transcript-driven), and show "not delivered yet" after a timeout. It cannot tell held from refused. Receiving the control `peer_message_status` frame would need c9view to look like a registered Claude session; do not attempt that.
2. **`hold` is invisible from outside** and keeps up to 100 messages, which may be released later without any signal (a stale "pending" can later become delivered). A sent message that was held can be delivered much later when the maintainer approves; c9view should keep tracking its `msg_id`.
3. **Undocumented format.** `{"type":"user","message":{"role":"user","content":...}}` with `msgV:1`, `msg_id`, `priority:"next"`, `from` is what Claude itself sends in 2.1.318. It is not documented and could change; gate on `peerProtocol` and `version` from `sessions/<pid>.json` and fail closed on unknown. Unknown `type` values are silently ignored (no error), which would look like a hang.
4. **Prompt-injection surface.** The receiver acts on c9view text as a peer request within its own permissions. The receiver cannot be told the text came from the human owner; the wrapper says "another Claude session ... not typed by your user". The receiver may refuse or hedge; set expectations in the UI. Do not send `from-mode` claims.
5. **Hooks cannot separate peer from typed prompts** by event; use `origin` in the transcript (FR-013).
6. **Stale entries.** After a clean exit both socket and `sessions/<pid>.json` vanish; after a crash they may stay (inferred). Validate the pid and `procStart`, and handle `ENOENT`, `ECONNREFUSED` and `EPIPE`.
7. **Cost.** Each delivered message starts a real turn (billed like a prompt). Cap size (the receiver hard limit is about 1 MB) and consider a confirm step.
8. **Auth token.** Not needed on Linux (also accepted when wrong), so c9view never needs the token. On macOS this was not tested; the docs say the line is optional there as well. Native Windows is out of scope already. Because the hook environment contains the token, c9view's hook must not log its environment.
9. **Version floor.** Only 2.1.318 verified.

## Recommendation for the plan

- Go: the spike's three gates pass on Linux. Keep the spec's design (hook records address only; transcript-driven).
- Address source: prefer reading `~/.claude/sessions/<pid>.json` (`messagingSocketPath`, `version`, `status`, `pid`, `procStart`) for sessions c9view already reads; keep the hook as a fallback/earlier source (`CLAUDE_CODE_MESSAGING_SOCKET`). Never open `*.key` files. Strip the `uds:` prefix handling carefully: the JSON holds a bare path, `/status` and `from` use `uds:<path>`.
- Sender: node `net` over the Unix socket, no auth line, one frame `{"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"<text>"},"priority":"next","from":"uds:<c9view marker>"}` plus `\n`, then end the connection. Treat `ENOENT`, `ECONNREFUSED`, `EPIPE`, and a size over a c9view cap as "cannot be reached/too large". Do not wait for a reply.
- Label (FR-013): recognise transcript records with `origin.kind === "peer"` and the c9view `msg_id`/`from` marker; keep the receipt only as a fallback while the record has not appeared. Peer messages from other Claude sessions also have `origin.kind:"peer"`, so the c9view marker must be what distinguishes "Sent from c9view".
- Outcome UI: "Sent" (written to socket), then "Delivered" when the record with the `msg_id` shows up, otherwise "Not seen yet (the session may be holding or refusing it)" after a timeout; do not claim held vs refused.
- Version (FR-017): record in `docs/data-sources.md` that 2.1.318 is the only version verified; set the minimum to 2.1.318 unless the maintainer wants to test an older build, or keep the documented 2.1.224 as an unverified floor with a clear note (decision for the maintainer).
- Size: cap at a value far under 1 MB.
- Re-run this spike (two Haiku turns are enough: one idle send, one record check) on each Claude Code upgrade, because the format is undocumented.

## Cleanup

All five scratch sessions (a, b, c, d, e) ran with `--model haiku` and were stopped (tmux sessions `c9spike`, `c9spike2`, `c9spike_c`, `c9spike_d`, `c9spike_e` killed; no `claude --model haiku`, proxy or listener process left; the scratch sockets under `/run/user/1000/cc-socks` and the test listener sockets are gone). The `strace` capture (it contained the environment) was deleted; `~/.claude/settings.json` was not touched; no repo files were changed other than this document.

## Re-spike (2026-11-05)

Claude Code **2.1.318** again (`peerProtocol: 1`, Linux 5.15, tmux). All sessions: `/home/phatnv/.local/bin/claude --model haiku` (Haiku 5.5), auto permission mode (user setting), no bypass flag or mode. Three interactive scratch sessions in tmux (`a` default, `h` with `crossSessionInbound: "hold"`, `r` with `"refuse"`, the settings only in each scratch folder's `.claude/settings.local.json`) plus two `claude -p` runs; about 10 Haiku turns. Scratch root: `/tmp/claude-1000/-home-phatnv-phatnv-workspace-github-personal-c9view/03cc802d-cde7-44bd-b5e0-6b4110160fc6/scratchpad/respike-003/` (`send.py` builds exactly the R4 frame: `msgV:1`, uuid-shaped `msg_id`, `type:"user"`, wrapper with `from="uds:/dev/null/c9view" from-name="c9view"` and the attribution line, `priority:"next"`, `from:"uds:/dev/null/c9view"`, no auth line, no `from-mode`). No token was read or printed. Item 7 was answered from the settings schema compiled into the `claude` binary (its own description strings and gate code, read as text) plus behaviour. The only process signalled was the `r` session (pid 539837, started by this run). Both tmux sessions were killed at the end and the one stale socket and JSON were deleted by hand.

### Results

| # | Question | Answer | Evidence | Confidence |
|---|----------|--------|----------|------------|
| 1 | Mid-turn `attachment.queued_command` keeps `origin.msg_id`, `from`, `name` | **Yes** | `a` was running three `sleep 6` calls; frame sent about 6 s in. Record: `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<cross-session-message from=\"uds:/dev/null/c9view\" from-name=\"c9view\">...","source_uuid":"...","delivery_id":"...","origin":{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":541898,"verifiedPeerProcStart":"20306689","msg_id":"33333333-aaaa-4bbb-8ccc-000000000003","name":"c9view","body":"Sent by this session's owner from c9view.\n\nReply MID3 only"}},"isMeta":true}`. The model saw it before its final `DONE`. | High |
| 2 | `queue-operation enqueue` carries `msg_id` | **No** | `{"type":"queue-operation","operation":"enqueue","timestamp":"...","sessionId":"...","content":"<cross-session-message from=\"uds:/dev/null/c9view\" from-name=\"c9view\">\nSent by ...\n\nReply OK1 only\n</cross-session-message>"}`. Only `content` (the wrapper) is there, no `msg_id`, no `origin`. Mid-turn the later `queue-operation remove` has `reason:"absorbed_mid_turn"`, `commandUuid`, `deliveryId` (matches `attachment.delivery_id`) and also no `msg_id`. Idle: `dequeue` 7-40 ms after `enqueue`, then the `user` record. | High |
| 3 | `procStart` equals `/proc/<pid>/stat` field 22 | **Yes** | For pids 539829, 539832, 539837: JSON `"procStart": "20294533"/"...534"/"...535"` (a **string**, decimal) equals field 22 (`starttime`) parsed after the last `)` of the line (the `comm` is `(claude)`; parse from `rindex(")")` so a `comm` with spaces or parens cannot shift the fields). Units are clock ticks since boot (`getconf CLK_TCK` = 100), not epoch time. The transcript's `origin.verifiedPeerProcStart` uses the same format (a sender's python process: `"20300107"`). | High |
| 4 | Delivery with `from: "uds:/dev/null/c9view"`; hold and refuse notices fail quietly | **Yes** | Idle `a`: turn started, `› Message from @c9view: ...`, answered `OK1`; mid-turn as in item 1. `origin.from` and `origin.name` were kept as given. Hold (`h`): TUI line `Held peer message — from uds:/dev/null/c9view [verified pid 542224] (peer claims name: c9view); preview: «Sent by this sessions owner from c9view.» ...[3 lines, 59 chars total ...] — not delivered to Claude (1 held). This repository's settings set "crossSessionInbound" to "hold" (a repo may only tighten ...)` (the preview drops the apostrophe in "session's"). Refuse (`r`): TUI unchanged, no transcript file created. No error text in either TUI, no error record in `h`'s transcript, and the sender's socket got no bytes back (3 s wait). The receiver's status report to the bogus `from` fails silently (`/dev/null/...` is `ENOTDIR`). Not observed at byte level (strace not used), but nothing visible anywhere. | High for delivery and TUI/transcript quietness; medium that no stderr or debug-log line exists (debug log not read) |
| 5 | A released held message keeps its `msg_id` | **Yes** | While held, `h`'s transcript had **no** record for it. Replacing the file with `{}` released it within seconds: TUI `Released 1 held cross-session message to Claude's queue (crossSessionInbound now accepts).`, then `enqueue` (08:10:46.012Z), `dequeue`, and a `user` record with `origin:{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":542224,"msg_id":"44444444-aaaa-4bbb-8ccc-000000000004","name":"c9view",...}`. The `msg_id` is the original one and the pid is the original sender's. The record's timestamp is the release time, not the send time. | High |
| 6 | After `SIGKILL`: stale socket gives `ECONNREFUSED`, stale JSON with dead PID remains | **Yes** | `kill -KILL 539837` (the `r` session): `/proc/539837` gone, `/run/user/1000/cc-socks/539837.sock` still there (`srw-------`), `~/.claude/sessions/539837.json` still there with `"status":"idle"` (stale; never updated). Connect: `ConnectionRefusedError [Errno 111]`. Both files stay until someone deletes them (I removed these two by hand). | High |
| 7 | `crossSessionInbound` | **Yes** (see below) | Settings schema description and gate code in the binary; behaviour for `hold`, `refuse`, release and unset confirmed. | High for schema text, medium for the unset-by-mode cases (read from code, only `auto` tested) |
| 8 | `kind` values other than `interactive` | **Yes** | See below. | High for the enum, medium for what each does |

### Item 7 detail: `crossSessionInbound`

- **Key and values**: top-level settings key `crossSessionInbound`, one of `"accept"`, `"hold"`, `"refuse"`. Schema text: "'accept' delivers them, 'hold' parks them for your review without letting Claude act, 'refuse' opts this session out. An explicit value always wins. Unset (mode parity): a message auto-delivers only when the sending session's permission-mode class matches yours (bypass<->bypass or prompting<->prompting); a mismatched sender's message is held for your approval; a sender that asserts no class is held only while this session bypasses permission prompts." Also a `/config` row "Messages from your other sessions" (`default`, `accept`, `hold`, `refuse`; `default` = unset), hidden when a non-user file sets it.
- **Invalid value**: ignored with a settings warning, and while it is present everything is **held** (fail closed). A managed (policy) invalid value is treated as `refuse`.
- **Which files and precedence** (from the gate code): first `policySettings` (managed), then `flagSettings` (`--settings`), then `userSettings` (`~/.claude/settings.json`): the first of these that defines it wins outright. Then `localSettings` and `projectSettings` (`.claude/settings.local.json`, `.claude/settings.json`) can only **tighten**, with order accept < hold < refuse: a repo value that is stricter than the current result replaces it; one that is looser is ignored. So with nothing in managed/flag/user files, a repo `accept` does nothing (default applies), and a repo `hold` or `refuse` applies. The TUI says so: "a repo may only tighten, so your own 'accept' cannot override it". Observed: `hold` in `.claude/settings.local.json` held; `refuse` dropped; replacing the file with `{}` released the held message live (settings are watched, no restart).
- **Default when unset, by the receiver's permission mode** (code path `unset`): receivers in `default`, `acceptEdits`, `plan`, `auto` and other non-bypass modes are the "prompting" class; `bypassPermissions` (or a mode where bypass is available and active) is the "bypass" class. A mode the code does not recognise, or no mode available yet: **hold** (`mode-unknown`, "delivered once the session finishes starting up" in one case). For a sender that **asserts no class** (c9view sends no `from-mode`): prompting receiver -> **accept** (observed in `auto`); bypass receiver -> **hold** (`no-mode-asserted`: "The sender did not attest its permission mode, and this session bypasses permission prompts."). A sender that does assert `from-mode` is accepted only if it equals the receiver's class (else `mode-mismatch` hold). A session's own messages (`selfSent`) are accepted. There is also a remote kill switch that makes receivers `refuse`.
- **Held-state reasons shown to the owner**: `explicit-setting`, `managed-setting`, `repo-setting`, `invalid-setting`, `bypass-default`/`no-mode-asserted`, `mode-mismatch`, `mode-unknown`. A held message expires if nobody approves it by an approval deadline (the receipt to Claude senders then says `expired`).
- **Not tested here**: bypass-mode receivers (rule: no bypass mode), `default`/`plan` modes (read from code), user-level setting (not allowed to edit), managed policy.

### Item 8 detail: `kind` and non-interactive sessions

- The `kind` enum in `sessions/<pid>.json` (binary): **`interactive`, `bg`, `daemon`, `daemon-worker`**. Other fields seen in the binary for the writer: `entrypoint`, `hostSessionId`, `jobId` (for `bg`), `parkedJobId`, `logPath`, `agent`, `spare`, `pidDomain`, `state/detail/tempo/needs`. FleetView-style readers treat only `interactive` and `bg` as user sessions. `bg`/`daemon*` were not started here.
- **`claude -p` is not a different `kind`**: two runs of `claude --model haiku -p "Reply OK only"` wrote `~/.claude/sessions/<pid>.json` with `"kind":"interactive"`, `"entrypoint":"sdk-cli"` (interactive TUI sessions have `"entrypoint":"cli"`), `messagingSocketPath` set, `peerProtocol: 1`. The socket existed during the run (`srw-------`), and both the socket and the JSON were removed on exit (after about 3 s). Whether a frame sent to a `-p` session is delivered was not tested (the window is a few seconds); its `status` field was absent in the one record seen.
- So `kind` cannot tell c9view whether a session is a user's interactive one; **`entrypoint`** can (`cli` vs `sdk-cli`, and probably `sdk-ts`/`sdk-py` and others).

### Other observations

- New field in the JSON in this build: `pidDomain` (`linux:<hash>:pid:[<pid-namespace inode>]`), plus `asksForConvertedSkills`, `nameSince`, `updatedAt`, `statusUpdatedAt`. Useful as a pid-namespace check.
- `UserPromptSubmit`-style hooks were not re-checked.
- A stale JSON keeps its last `status` (here `idle`): `status` is only meaningful when pid and `procStart` match a live process.

### Implications for the plan

Nothing in items 1, 3, 4, 5, 6 changes a decision; they confirm R4/R5/R6. The changes:

1. **Item 2 is a "no"** (R5 optional step). There is no earlier "accepted by the session" step keyed by `msg_id`. Drop the optional step from R5. If an earlier step is ever wanted it must match the `queue-operation enqueue` `content` string (the wrapper text), which is fragile and adds nothing the `user` record (7-40 ms later when idle) does not give; keep the tracker on `origin.msg_id` in `user` and `attachment.queued_command` records only. Mid-turn, the `enqueue` record appears when the frame arrives, but the `attachment` may come seconds later (4.4 s here), so `delivered` can lag a long tool call; the `not-seen` text ("the session may be busy with a long step") already covers it, and `C9VIEW_REMOTE_NOT_SEEN_SEC` 20 s may be short for long tool calls (consider counting an `enqueue` match on content as "queued in session" if the maintainer wants a better mid-turn message; optional).
2. **R6 fallback is no longer needed** for the mid-turn record: `origin.from`/`origin.name` are present on both record types, so the wrapper-content fallback can be dropped (keep it tolerant, not required).
3. **Item 3 settles R10-style ownership checks**: `procStart` is the decimal string of field 22 of `/proc/<pid>/stat` (clock ticks since boot), to be read with the "after the last `)`" parse. Note the transcript's `verifiedPeerProcStart` is the same format, so the label's "verified" check (R6) can compare it to the node's own `/proc/self/stat` field 22.
4. **Item 6**: after a crash, both files stay and `status` goes stale, so availability must check pid alive and `procStart` match before using `messagingSocketPath` (already in R2). `ECONNREFUSED` => `unreachable`, as R5 has it; with a dead pid the better reason is `session-ended` (R5 maps `ECONNREFUSED` to `unreachable` only when the process is alive; adjust the mapping so `ECONNREFUSED` with a dead pid or a `procStart` mismatch is `session-ended`).
5. **Item 7 changes the pre-send check in R5** (this is the main plan change): c9view reads `crossSessionInbound` only from settings files it can read, but the real value comes from `policySettings` > `flagSettings` > `userSettings` > a tighten-only merge of local/project settings, not from a plain merge. The existing `mergeSettings` precedence is wrong for this key (a project `accept` would wrongly beat a user `hold`, and a repo `hold` cannot be loosened). Implement it with the rules above, and treat the permission mode as part of the answer: **a receiver in `bypassPermissions` mode holds c9view's messages by default** (`no-mode-asserted`), because c9view must not send an unauthenticated `from-mode`. The availability model needs a state for that (for example unavailable with reason `inbound-held-bypass`, hint "This session bypasses permission prompts, so it holds messages from c9view until you accept them at the terminal, or set crossSessionInbound to accept in your user settings"). Managed/flag sources are not readable by c9view, so the check stays advisory (`not-seen` remains the fallback). The in-session `/config` change is written to the user settings file, which c9view can read.
6. **Item 8 changes FR-017/availability**: do not filter on `kind === "interactive"` to mean "owner's terminal session". `claude -p` runs are `kind: "interactive"` with `entrypoint: "sdk-cli"` and a socket for seconds; `bg`, `daemon`, `daemon-worker` kinds exist. Offer remote control only for `kind === "interactive"` **and** `entrypoint === "cli"` (fail closed on anything else, reason `not-interactive`), and reuse the same liveness checks. Add `entrypoint` to the status-file schema used by the node if it is not read today.
7. **Small**: a held message is released with its original `msg_id`, so the tracker's `not-seen` -> `delivered` transition (R5 step 3) is confirmed to work; the transcript timestamp is then the release time, so the receipt should show the delivery time from the record, not from the send time. Keep the tracker alive for the receipt lifetime only (as planned); a hold released after the receipt expired still gets the label through R6.

## Re-spike (2026-11-16)

Claude Code **2.1.325** (not the expected 2.1.323; `command claude --version` = `2.1.325 (Claude Code)`, `peerProtocol: 1`, same `peerFeatures`), Linux 5.15, tmux (own server `-L c9respike`). All sessions: `/home/phatnv/.local/bin/claude --model haiku` (Haiku 5.5, `claude-haiku-5-5` in the transcript `api-request.params.model`), auto permission mode (user setting), no bypass flag or mode (the shell alias adds `--allow-dangerously-skip-permissions`, so the binary was called by full path). Scratch sessions `a` (default), `h` (project `crossSessionInbound: "hold"`), `r` (`"refuse"`), a second `r`-folder session killed for item 6, and one `claude -p`; settings only in each scratch folder's `.claude/settings.local.json`. About 8 Haiku turns (the size test used the holding session, so no big message reached the model). Scripts: `send.py` (exact R4 frame, no auth line, no `from-mode`), `size.py`, `info.py`, `tr.py` under `/tmp/claude-1000/-home-phatnv-phatnv-workspace-github-personal-c9view/9be92e15-d28a-4b9f-a26c-631c9c2c9aff/scratchpad/respike-003/scripts/`. No `.key` file was opened; no `peerToken` appeared in any status JSON or output (the status JSON has none). Only pids this run started were signalled.

### Results

| # | Question | Answer | Evidence | Confidence |
|---|----------|--------|----------|------------|
| 10 | Basics: status JSON, socket, external sender, transcript origin | **Pass** | `sessions/<pid>.json` has `messagingSocketPath` (bare path `/run/user/1000/cc-socks/<pid>.sock`, mode `srw-------`), `version:"2.1.325"`, `peerProtocol:1`, `procStart` (string), `pidDomain` (`linux:<hash>:pid:[4026531836]`), `kind:"interactive"`, `entrypoint:"cli"`, `status` (`idle`, then `busy`). The frame from `send.py` to idle `a`: no reply bytes, turn started within 20 ms (`enqueue` 15:49:56.206, `dequeue` .217, `user` .236), answer `OK1`. `user` record: `isMeta:true`, `turnOrigin:"peer"`, `promptSource:"system"`, `origin:{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":1104011,"verifiedPeerProcStart":"66189937","msg_id":"11111111-...0001","name":"c9view","body":"Sent by this session's owner from c9view.\n\nReply OK1 only"}`. No `fromMode` (none sent). | High |
| 1 | Mid-turn `attachment.queued_command` keeps `origin.msg_id`, `from`, `name` | **Yes** | `a` ran `sleep 10` calls; frame sent 6 s in. `{"type":"attachment","attachment":{"type":"queued_command","prompt":"<cross-session-message ...>","source_uuid":"8e81...","delivery_id":"518d...","commandMode":"prompt","origin":{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":1108076,"verifiedPeerProcStart":"66201022","msg_id":"55555555-...0005","name":"c9view","body":"..."}},"isMeta":true}`. The model saw it between tool calls (TUI: `Ran 1 shell command`, message, `Ran 2 shell commands`). | High |
| 2 | `queue-operation enqueue` carries `msg_id` | **No** | `enqueue` has only `timestamp`, `sessionId`, `content` (wrapper text). Mid-turn `remove` has `reason:"absorbed_mid_turn"`, `commandUuid` (= `source_uuid`), `deliveryId` (= `delivery_id`), no `msg_id`. Idle `dequeue` 11 ms after `enqueue`. | High |
| 3 | `procStart` equals `/proc/<pid>/stat` field 22 | **Yes** | pids 1101902, 1101905, 1101908, 1111985, 1110226: JSON `"procStart": "66185290"` etc. (decimal string) equals field 22 parsed after the last `)`. `verifiedPeerProcStart` has the same format. | High |
| 4 | Delivery with `from: "uds:/dev/null/c9view"`; hold and refuse notices fail quietly | **Yes** | Delivered idle and mid-turn, `origin.from`/`name` kept. `h`: TUI `Held peer message — from uds:/dev/null/c9view [verified pid 1109608] (peer claims name: c9view); preview: «Sent by this sessions owner from c9view.» ...[3 lines, 57 chars total ...] — not delivered to Claude (1 held). This repository's settings set "crossSessionInbound" to "hold" (a repo may only tighten ...)`. `r`: TUI unchanged, no transcript folder created. Sender socket got nothing back (3 s) in both. | High |
| 5 | A released held message keeps its `msg_id` | **Yes** | Held: 0 records for `6666...0006` in `h`'s transcript. Replacing the file with `{}`: `enqueue` 15:52:48.026, `dequeue`, `user` record with `origin` `msg_id: "66666666-...0006"`, `verifiedPeerPid` of the original sender, `turnOrigin:"peer"`. Timestamp is the release time. | High |
| 6 | After `SIGKILL`: stale socket gives `ECONNREFUSED`, stale JSON with dead PID | **Yes, with a caveat** | `kill -KILL 1101908`: `/proc` entry gone, socket (`srw-------`) and JSON still present right after; connect gave `ConnectionRefusedError [Errno 111]`. A second kill (pid 1111985) left socket, JSON and the `.key` file for 90+ s (checked six times). Caveat: the first killed pid's JSON and socket were gone about 12 minutes later, after other sessions started and exited (the sweep, if any, is not ours to identify; two of my sessions exited in between). So stale files may or may not persist. | High for ECONNREFUSED and the stale window, low for the sweep |
| 7 | `crossSessionInbound` | **Yes** (as before) | Unset, receiver in `auto`, sender with no `from-mode`: delivered (`a`, 5 messages). Project `hold`: held, TUI as above. Project `refuse`: dropped silently. Released by rewriting the file as `{}` (no restart). Not retested: user-level, managed, other permission modes, bypass. | High for tested cases |
| 8 | `claude -p` gives `kind` / `entrypoint` | **Yes** | `kind:"interactive"`, `entrypoint:"sdk-cli"`, `messagingSocketPath` set, `status:"busy"` (present this time), `tmux` field set from the inherited environment, no `bgJobId`-style field. A frame sent to the running `-p` process was accepted: `queue-operation enqueue`, `remove` with `absorbed_mid_turn`, and an `attachment.queued_command` with the same `origin` shape (`msg_id` kept). So `-p` sessions do accept frames while they run; socket and JSON were removed on exit. | High |
| size | Cap is about 1 MB | **Yes, narrower** | Sent to `h` (holding, so no tokens): 900,191 bytes and 990,191 bytes accepted (held count 1, 2), 1,048,191 bytes accepted (3 held), 1,100,191 bytes: `ConnectionResetError`, not held. The limit lies between 1,048,191 and 1,100,191 bytes per frame line (probably 1 MiB = 1,048,576 for the line). | High |

### Differences from 2.1.318

- Version is 2.1.325, not 2.1.323.
- New field in `sessions/<pid>.json`: `bridgeSessionId` (a `session_...` id; the TUI banner shows `/rc`). Interactive sessions only; the `-p` record had none. Not used by the plan. No `peerToken` field in the JSON.
- `-p` sessions now show `status` (`busy`) and accept frames mid-run (item 8's open part is answered: yes).
- Everything else matched: frame, `origin` fields (`kind`, `from`, `verifiedPeerPid`, `verifiedPeerProcStart`, `msg_id`, `name`, `body`), `isMeta`, `turnOrigin`, `procStart` format, socket folder and mode, `crossSessionInbound` behaviour, `ECONNREFUSED` after `SIGKILL`.
- Size limit: 1,048,191 bytes accepted, 1,100,191 rejected (2.1.318: 0.9 MB accepted, 1.1 MB rejected).
- Possible: stale files after a hard kill may be swept by some later activity (observed once, not reproduced in 90 s).

### Implications for the plan

None. The format, origin fields, `procStart` and the default all hold on 2.1.325. The minimum can stay 2.1.318 with "verified also on 2.1.325" added in `docs/data-sources.md`; gating on `kind === "interactive"` and `entrypoint === "cli"` stays right (a `-p` session accepts frames, so the `entrypoint` gate is what keeps them out). Keep the c9view size cap far below 1 MB. Stale-file handling (pid and `procStart` check, `ECONNREFUSED` with a dead pid => `session-ended`) stays as is, and must also cope with the files vanishing.

### Cleanup

Sessions `a`, `h` exited with `/exit`; `r` and the second kill-test session were `SIGKILL`ed by pid; the `-p` run ended by itself. tmux server `c9respike` killed. The leftover socket, JSON and `.key` of the second killed pid were deleted by name (not opened). No `claude --model haiku` process of this run remains. No settings file outside the scratch folders and no other repo file was touched.

## Re-check (2026-11-23)

Claude Code **2.1.330** (`/home/phatnv/.local/bin/claude --version` = `2.1.330 (Claude Code)`, `peerProtocol: 1`, same `peerFeatures`), Linux 5.15, own tmux server `-L c9recheck`. One session `a`, started with `/home/phatnv/.local/bin/claude --model haiku` (no alias, no bypass flag), auto permission mode, no settings file in the scratch folder and no `crossSessionInbound` in the user settings. About 5 Haiku turns (3 idle or mid-turn peer messages, one typed prompt with `sleep 8` calls). Scripts `send.py` (R4 frame, no auth line; the content carries a `<cross-session-message from="uds:/dev/null/c9view" from-name="c9view">` wrapper, which is where `origin.name` and `origin.body` come from, as in the earlier runs), `info.py`, `tr.py` under `/tmp/claude-1000/-home-phatnv-phatnv-workspace-github-personal-c9view/9be92e15-d28a-4b9f-a26c-631c9c2c9aff/scratchpad/recheck-330/scripts/`. No `.key` file opened; no `peerToken` in the status JSON.

### Results

| # | Question | Answer | Evidence | Confidence |
|---|----------|--------|----------|------------|
| 10 | Basics: status JSON, socket, external sender, transcript origin | **Pass** | `sessions/<pid>.json` has `messagingSocketPath` (`/run/user/1000/cc-socks/<pid>.sock`, mode `srw-------`, `0o140600`), `version:"2.1.330"`, `peerProtocol:1`, `procStart` (string), `pidDomain` (`linux:<hash>:pid:[4026531836]`), `kind:"interactive"`, `entrypoint:"cli"`, `status:"idle"`. Frame to idle `a` with no auth line: no reply bytes, `enqueue` 16:38:10.100, `dequeue` .108, `user` .122, answer `OK2`. `user` record: `isMeta:true`, `turnOrigin:"peer"`, `promptSource:"system"`, `permissionMode:"auto"`, `origin:{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":9147,"verifiedPeerProcStart":"762088","msg_id":"22222222-...0002","name":"c9view","body":"Sent by this session's owner from c9view.\n\nReply OK2 only"}`. A frame without the wrapper (first send, `OK1`) gave the same record without `name` and `body`. | High |
| 1 | Mid-turn `attachment.queued_command` keeps `origin.msg_id`, `from`, `name` | **Yes** | Frame sent 7 s into a turn of three `sleep 8` calls: `enqueue` 16:39:14.779, `remove` `reason:"absorbed_mid_turn"` 16:39:17.855 (`commandUuid` = `source_uuid`, `deliveryId` = `delivery_id`, no `msg_id`), and `attachment.queued_command` with `origin:{"kind":"peer","from":"uds:/dev/null/c9view","verifiedPeerPid":9666,"verifiedPeerProcStart":"768554","msg_id":"44444444-...0004","name":"c9view","body":"..."}`, `isMeta:true`. The final answer included `MID2OK`. | High |
| 3 | `procStart` equals `/proc/<pid>/stat` field 22 | **Yes** | pid 8226: JSON `"procStart": "757502"`, field 22 (after the last `)`) = 757502. `verifiedPeerProcStart` has the same decimal-string format. | High |
| 4 | Unset `crossSessionInbound`, receiver in `auto`, still delivers | **Yes** | Three messages (idle with and without wrapper, mid-turn) all delivered with no setting anywhere; the sender's `from-mode` was absent. | High |

Skipped as agreed: size, kill, `-p`, `hold` and `refuse` (nothing above looked different).

### Differences from 2.1.325

- Version is 2.1.330.
- `sessions/<pid>.json` fields unchanged since 2.1.318 (including `asksForConvertedSkills`, `nameSince`, `updatedAt`, `statusUpdatedAt`). `bridgeSessionId` is still present for an interactive session; no `peerToken` field.
- The mid-turn attachment now also carries `timestamp` and `reminderId` (not previously noted); the `origin` shape is unchanged.
- Everything else matched: frame, wrapper-derived `name` and `body`, `origin` fields, `isMeta`, `turnOrigin`, `procStart`, socket folder and mode, the unset default.

### Implications

None. The minimum stays 2.1.318; `docs/data-sources.md` now says the behaviour was also re-checked on 2.1.330. No 003 code assumption changes: `discovery.ts` picks fields explicitly, so `bridgeSessionId` and other extras are ignored, and 003 sending uses none of them.

### Cleanup

Session `a` ended with `/exit` (pid 8226); its socket and JSON were removed by Claude Code. tmux server `c9recheck` killed. No process of this run remains; no settings or other repo file touched.
