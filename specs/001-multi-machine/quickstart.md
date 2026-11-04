# Quickstart: validating Components and Multiple Machines

Run from the PR's worktree. Never use port 7777 for branch servers; use 7790. Use fixture Claude dirs from `tests/fixtures/`, never real data.

## Every PR

```sh
corepack pnpm install
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build
```

## 6.0a — no behaviour change (US1)

- The end-to-end test compares every `/api/*` response from `c9view start` on the fixture data with the recorded pre-split responses (including `/api/health`): all equal.
- A test import that crosses a boundary (node importing `hono/cookie`, hub importing `@c9view/node` internals) fails `lint`.
- `InProcessTransport` passes [contracts/node-transport.md](contracts/node-transport.md).

## 6.0b — machine-scoped (US2)

- `curl -s localhost:7790/api/m/local/overview` equals `/api/overview`; `/api/m/nope/overview` → 404; with `--no-local`, `/api/overview` → 404.
- Open an old URL in the browser: it lands on `/m/local/…`.
- Kill and restore the SSE connection (DevTools offline): open files, git status and changes views refetch.

## 6.0c — budgets (US3)

- A fixture session with large tool output: first page < `C9VIEW_PAGE_BUDGET_BYTES`, cursor present; following cursors returns every message in order. Set `C9VIEW_PAGE_BUDGET_BYTES=65536` to see the "Load more" notice on a normal session.

## 6.0d — state folder (US7)

- With a temporary `HOME`, fire a hook (`node packages/core/dist/hooks/hook-entry.js --c9view-hook` with a fixture payload): event at `$HOME/.claude/c9view/events.jsonl`, modes 0700/0600.
- Put an `events.jsonl` at `$HOME/.local/state/c9view/`: the session card still shows its hook evidence; nothing is moved.
- Files under `$HOME/.claude/c9view/` never appear in projects, config or search.
- `docker compose config`: `~/.claude/c9view` mounted writable at `/data/claude/c9view`, `/data/claude` read-only.

## Step 7 (US4–US6) — manual check by the maintainer

```sh
C9VIEW_AUTH=token PORT=7790 c9view hub --no-local
c9view hub pair                                      # copy the code
C9VIEW_CLAUDE_DIR=tests/fixtures/claude-a C9VIEW_STATE_DIR=$(mktemp -d)/a c9view node pair --hub ws://127.0.0.1:7790 --code <code> --name alpha
C9VIEW_CLAUDE_DIR=tests/fixtures/claude-a C9VIEW_STATE_DIR=<same> c9view node --hub ws://127.0.0.1:7790
# repeat for a second node with claude-b
```

Expected: both machines on the Machines page; merged Overview keeps same-ID projects apart; stopping one node greys its cards with "offline · last seen …" and its pages answer 503; restarting it changes its `bootId`; revoking it closes its socket and its next connect logs "pair it again". Check at 1440×900 and 390×844.

## 7e

With a temporary `HOME`: `c9view node install-service` prints the unit/plist and writes nothing until confirmed; `uninstall-service` removes only that file.
