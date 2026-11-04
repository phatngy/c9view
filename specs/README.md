# Specs

One folder per feature, `NNN-feature/`, created by [Spec Kit](https://github.com/github/spec-kit): `spec.md`, `plan.md`, `tasks.md` and the plan's design artifacts. Each plan is checked against the [constitution](../.specify/memory/constitution.md). The workflow is in [AGENTS.md](../AGENTS.md#workflow).

| Feature                                            | Status    |
| -------------------------------------------------- | --------- |
| [000-baseline](000-baseline/spec.md)               | Shipped   |
| [001-multi-machine](001-multi-machine/spec.md)     | Specified |
| [002-session-control](002-session-control/spec.md) | Specified |

`000-baseline` is the as-built record of everything c9view shipped before later features were planned with Spec Kit. Its open tasks are the known follow-ups.

## Steps

| Step    | Feature                                            | Status    | What's delivered                                                                                             |
| ------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| 0       | [000-baseline](000-baseline/spec.md)               | Shipped   | Setup: monorepo, linting, CI, agent instructions, synthetic fixtures and Spec Kit.                           |
| 1       | [000-baseline](000-baseline/spec.md)               | Shipped   | Read and index projects, sessions, usage and config into SQLite; watch for new data; `c9view scan --json`.   |
| 2       | [000-baseline](000-baseline/spec.md)               | Shipped   | Four-column status detection and `c9view hooks install`.                                                     |
| 3       | [000-baseline](000-baseline/spec.md)               | Shipped   | Overview, project board, session page and config screens.                                                    |
| 3b      | [000-baseline](000-baseline/spec.md)               | Shipped   | Project file browser and Changes tab, inline diffs, session file history and linked file viewer.             |
| 4       | [000-baseline](000-baseline/spec.md)               | Shipped   | Token and cost charts, search and export.                                                                    |
| 4b      | [000-baseline](000-baseline/spec.md)               | Shipped   | Design system, app shell, chat-style sessions, phone layouts and visual polish.                              |
| 5       | [000-baseline](000-baseline/spec.md)               | Shipped   | CLI, Docker and Compose, optional login, tunnel setup guide.                                                 |
| 6.0     | [001-multi-machine](001-multi-machine/spec.md)     | Specified | Split into web UI, hub and node; machine-scoped API and web; response budgets; unified c9view state folder.  |
| 6       | [002-session-control](002-session-control/spec.md) | Specified | Opt-in session control through the Agent SDK, including replies, approvals, questions and starting sessions. |
| 7       | [001-multi-machine](001-multi-machine/spec.md)     | Specified | Hub and node modes, pairing and one dashboard across machines.                                               |
| Planned | —                                                  | Planned   | Edit configs from the web.                                                                                   |
| Planned | —                                                  | Planned   | Codex support through the data-source layer.                                                                 |
