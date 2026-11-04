# Quickstart: Baseline: c9view as shipped

Build c9view from source, run it against the synthetic fixtures, and verify the shipped behaviour. Requires Node 22 or newer and Corepack. Never use port 7777 if you already run your own instance, and never point a test at your real `~/.claude`.

## Build and check

```sh
corepack pnpm install
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

All four checks must pass (they are the CI gate in `.github/workflows/ci.yml`).

## Run against the fixtures

```sh
export C9VIEW_CLAUDE_DIR="$PWD/tests/fixtures/claude"
export C9VIEW_DB="$(mktemp -d)/index.sqlite"
export C9VIEW_STATE_DIR="$(mktemp -d)"
node packages/cli/dist/main.js scan --json
PORT=7790 node packages/cli/dist/main.js start --open
```

Open `http://127.0.0.1:7790`. Without `C9VIEW_WEB_DIST` the CLI serves `apps/web/dist` from the repository; a missing build fails with instructions.

For development, `corepack pnpm dev` runs the server (tsx watch) and the Vite dev server together.

## Verify by area

1. **Data reading** (US1): `scan --json` prints the two fixture projects, three main sessions and one subagent session. Delete the index file and run it again: the counts are the same.
2. **Status board** (US2): open a fixture project. The sessions land in columns with reasons. Run `node packages/cli/dist/main.js hooks status --claude-dir "$C9VIEW_CLAUDE_DIR"`; `hooks install` against a copy of the fixture shows a diff before writing.
3. **Conversation** (US3): open a session. It opens at the newest message; the outline, in-session search and the right rail work; resize to 390 px to see the Chat / Outline / Files / Usage tab bar.
4. **Files and diffs** (US4): a session with Edit or Write calls shows inline diffs and a Files changed panel; the project Files tab lists the fixture project folder if it exists on disk; `.env` style files are refused.
5. **Usage** (US5): Overview shows the cost card with the "≈" and API-equivalent label; `curl 'http://127.0.0.1:7790/api/usage?from=2026-01-01&to=2026-01-31&tz=UTC'` returns days, models and totals.
6. **Config** (US6): `/config` shows sections with counts and a filter; the fixture `settings.json` contains a fake env secret that must appear masked.
7. **Search and export** (US7): search for a word from a fixture conversation; open the hit; export a session from the More menu.
8. **Visual design** (US8): `corepack pnpm test:e2e` checks the Overview, project, session, config and search pages at desktop and phone sizes.
9. **Running and securing** (US9):
   - `node packages/cli/dist/main.js start --host 0.0.0.0` exits with the login-required message.
   - `C9VIEW_TOKEN=<32+ characters> node packages/cli/dist/main.js start --auth token --port 7791`, then `curl -i http://127.0.0.1:7791/api/overview` gives 401 even from loopback; `curl -i -H 'Host: evil.example' http://127.0.0.1:7791/api/health` gives 403.
   - `curl -N http://127.0.0.1:7790/api/events` shows `retry: 3000` and a heartbeat comment; touch a fixture transcript copy to see `session` events.

## Docker

```sh
export C9VIEW_TOKEN="<at least 32 characters>"
docker compose up --build
```

Open `http://127.0.0.1:7777/login`. See [docs/deploy.md](../../docs/deploy.md) for tunnels and image verification.

## Where to look when something fails

- Server errors are logged redacted to stderr; index state is in `GET /api/health` (`index.state`).
- Fixture rules: [tests/fixtures/README.md](../../tests/fixtures/README.md); formats: [docs/data-sources.md](../../docs/data-sources.md).
