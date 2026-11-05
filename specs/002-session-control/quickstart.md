# Quickstart: validating Session Control

Run from the PR's worktree. Never use port 7777; use 7790. Automated tests use the fake `sdk.ts` adapter and a fake git runner, so CI spends no tokens.

## Every PR

```sh
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build
```

## Control off (US1)

`node packages/cli/dist/main.js start --port 7790` (no `--control`): `GET /api/m/local/control/runs` → 404; a logged-in `POST /api/m/local/control/runs/x/stop` that passes the guard → 404 (an unauthenticated `POST` gets the hub guard's 403 first, per [contracts/control-api.md](contracts/control-api.md)); `GET /api/machines` shows control `off`; no composer on session pages.

## Startup refusals (US1)

- `C9VIEW_CONTROL=1 C9VIEW_AUTH=none C9VIEW_INSECURE_NO_AUTH=1 … start --port 7790` → refuses, names `C9VIEW_AUTH=token`.
- `C9VIEW_CLAUDE_BIN=/nonexistent` → refuses, names `C9VIEW_CLAUDE_BIN`.

## Guard (US1)

With control on and a token: a `POST` without `Origin`, without `X-C9view-Control: 1`, with `text/plain`, or without the session cookie → 403 each ([contracts/control-api.md](contracts/control-api.md)).

## Manual end-to-end check (maintainer, with consent to use real tokens)

```sh
mkdir -p /tmp/c9view-scratch/roots && cd /tmp/c9view-scratch
C9VIEW_CONTROL=1 C9VIEW_AUTH=token C9VIEW_WORKSPACE_ROOTS=/tmp/c9view-scratch/roots \
  node <worktree>/packages/cli/dist/main.js start --port 7790
```

1. New session in a scratch project; reply; approve a Bash call; deny one with a message; answer a question; interrupt; stop.
2. Reply to a session open in a terminal → 409 "live elsewhere" → "Fork and reply" opens the fork.
3. New project in the scratch root (with "Initialize git"), and import a small public repo over `https`; the trust step lists a project hook in the repo; nothing starts until "Trust this folder".
4. Set a label on a session; restart without `--control`: no label shown.
5. Check at 1440×900 and 390×844, keyboard only and with a screen reader for the cards.

If a node ever reports control `unavailable` with "restart the node to accept new commands", it has reached `C9VIEW_CONTROL_TOMBSTONE_MAX` (100,000 command IDs in one boot). New commands, including approval decisions, are refused until the node restarts, and a pending approval is denied at its 30-minute timeout.
