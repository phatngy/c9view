# Hub

The hub handles browser login, Host and Origin checks, serves the web build, and relays API requests to the local node. The node data layer, read routes, runtime and transport live in [`packages/node`](../../packages/node/README.md).

From the workspace root:

- `corepack pnpm --filter @c9view/hub dev` starts the hub from source.
- `corepack pnpm build` builds the workspace for production.
- `corepack pnpm --filter @c9view/hub start` runs the built hub.
- `corepack pnpm --filter @c9view/hub test` runs hub tests.

`PORT` defaults to 7777 and accepts integers from 1 through 65535. `HOST` defaults to `127.0.0.1`. `C9VIEW_WEB_DIST` overrides the default `apps/web/dist` static directory. Non-API GET routes fall back to its `index.html`.
