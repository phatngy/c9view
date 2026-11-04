# Node

`@c9view/node` reads Claude data and project files on one machine. It owns the data layer, read routes, runtime and transport used by the hub.

From the workspace root:

- `corepack pnpm --filter @c9view/node dev` builds from source in watch mode.
- `corepack pnpm --filter @c9view/node test` runs synthetic fixture tests.
- `corepack pnpm --filter @c9view/node typecheck` checks the package types.

The package does not handle browser login or Host and Origin checks; those belong to `apps/hub`.
