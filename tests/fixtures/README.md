All fixtures are synthetic; none contain real data.

`tests/fixtures/claude/` is shared by core and CLI tests (see its README).

`packages/node/test/fixtures/claude/` is used by node and hub tests.

New fixtures must stay synthetic, without secrets or real paths.

Fixtures never contain a `c9view/` state folder. Ignore tests create state folders only in temporary directories.
