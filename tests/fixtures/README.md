All fixtures are synthetic; none contain real data.

`tests/fixtures/claude/` is shared by core and CLI tests (see its README).

`packages/node/test/fixtures/claude/` is used by node and hub tests.

New fixtures must stay synthetic, without secrets or real paths.

Fixtures never contain a `c9view/` state folder. Ignore tests create state folders only in temporary directories.

`tests/fixtures/claude-control/` is the control-on e2e tree. `tests/e2e/control-server.ts` copies it to a temporary folder and starts c9view with control on and token login. The Agent SDK import is replaced by `tests/e2e/control-fake-sdk.ts` through a Node `--import` hook that only that script passes (and only with `C9VIEW_E2E_FAKE_SDK=1`), so production code has no test seam.
