# Quickstart: validating Remote Control

Run from the PR's worktree. Never use port 7777; use 7790. Automated tests use the fake terminal session (`packages/node/src/remote/fake-session.ts`: a Unix-socket listener, a fake `sessions/<pid>.json` and a fixture transcript), so CI spends no tokens and runs no `claude`. Routes and texts are in [contracts/remote-api.md](contracts/remote-api.md).

## Every PR

```sh
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build
```

End-to-end tests run in Docker on the dev machine (Ubuntu 20.04 can't install Playwright's Chromium); match the image tag to `@playwright/test`:

```sh
docker run --rm --ipc=host -u $(id -u):$(id -g) -e HOME=/tmp -e CI=1 \
  -v $PWD:$PWD -w $PWD mcr.microsoft.com/playwright:v<version>-noble npx playwright test
```

The remote e2e server (`tests/e2e/control-server.ts`, 003-c) needs Linux for the socket checks; the Playwright image is Linux, so it runs there and in CI.

## Control off (US1 scenario 4)

`node packages/cli/dist/main.js start --port 7790` (no `--control`): `GET /api/m/local/projects/<p>/sessions/<s>/remote` → 404; a logged-in, guarded `POST` to the same path → 404; no send control on any session page.

## Fake terminal session (US1, US2, US4)

The node tests (003-b) and the e2e test (003-c) cover:

1. Available session: send → 202 `delivery.state: 'sent'`; the fake receives exactly one frame with `msgV: 1`, a uuid `msg_id`, the c9view `from` marker and wrapper, no auth line, no `from-mode`. The fake appends a `user` peer record → receipt `delivered`, `new-turn`; with an `attachment.queued_command` record → `next-step`.
2. Hold or drop (no record) → `not-seen` after the time limit; a record appended later → `delivered`.
3. Same command twice → one frame; changed body → 409 `payload-mismatch`; after a node restart → 409 `unknown-outcome`; two tabs → two frames in order.
4. Each refusal row of [research R7](research.md#r7-gating-ownership-checks-and-error-mapping-fr-002-fr-003-fr-018): too old, unknown protocol, no address, socket mode 0644, socket in another folder, socket name not `<pid>.sock`, `procStart` mismatch, other PID namespace, `crossSessionInbound: "refuse"`, not interactive (`kind` other than `interactive`, or `entrypoint: "sdk-cli"`) → 409 `remote-unavailable` with the reason; the fake receives nothing; the web keeps the text and offers no fork.
5. Socket removed before send → `failed/session-ended`; listener closed (stale socket) with a dead PID or a `procStart` mismatch → `failed/session-ended`; listener closed while the process lives and matches → `failed/unreachable`; reset mid-frame → `uncertain`.
   Inbound rule (research R7 step 15): user `hold` beats a project `accept`; project `hold` beats a user `accept`; project `accept` with nothing else changes nothing; invalid value → `hold`; unset with a prompting mode → no warning; unset with a `bypassPermissions` transcript record or no record → `inbound: 'may-hold'`; `refuse` → 409 with `inbound-refused`.
   A stale `sessions/<pid>.json` (dead PID, old `status`) is `not-live`. A held message released later keeps its `msg_id` and becomes `delivered` with the record's timestamp.
6. Process gone → availability `not-live`; the composer becomes 002's reply with the text kept, nothing sent.

## Privacy and no-write checks (SC-005, SC-006)

After the node tests and the e2e run, the leak test searches captured stdout and stderr, SSE events, receipts and hub responses for the fake socket path, the sentinel message text, a sentinel `peerToken` (in the fake's status JSON) and `token`: 0 matches. `no-write.test.ts` compares the temp Claude dir and project folder before and after a send (the fake session's own transcript appends excluded): no change; no `*.key` file opened (spy on opens).

## Manual check (maintainer, with consent: spends real tokens)

On Linux with Claude Code ≥ 2.1.318:

```sh
mkdir -p /tmp/c9view-scratch/rc && cd /tmp/c9view-scratch/rc && claude --model haiku   # terminal 1
C9VIEW_CONTROL=1 C9VIEW_AUTH=token node <worktree>/packages/cli/dist/main.js start --port 7790   # terminal 2
```

1. Open the scratch session in c9view: "Send to the terminal session" is offered; no "Fork and reply" anywhere.
2. Send "Reply with the word OK only." while the session is idle: "Sent", then "Delivered: Claude is starting a new turn"; the reply appears without reload; the message shows "Sent from c9view"; the terminal shows "Message from @c9view". No new session on the board.
3. Ask Claude in the terminal to run `sleep 8` three times; send during it: "Delivered: Claude sees it at its next step".
4. Set `"crossSessionInbound": "hold"` in the scratch project's `.claude/settings.local.json`, restart the session: the hold hint shows; a send ends as "not seen yet"; let it in at the terminal: it becomes "Delivered".
5. `"refuse"`: sending is unavailable with the fix.
   The may-hold warning for bypass mode is covered by unit and component tests with a synthetic transcript `permission-mode` record (T033, T034, T063); it is not exercised against real Claude Code.
6. Exit the terminal session: the composer becomes 002's reply with the text kept.
7. At 390×844, keyboard only and with a screen reader: send, hear the outcome once, see the label.
8. `grep -r cc-socks` over c9view's logs from the run: nothing.

Re-spike on every Claude Code upgrade: steps 2 and 3 plus a check of the record fields ([research R13](research.md#r13-re-spike-items)); record the result in `docs/data-sources.md`.
