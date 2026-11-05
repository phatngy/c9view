# AI-assisted workflow

c9view is built by a small team of AI agents directed by one maintainer: a lead Claude Code session plans with the maintainer, hands work to Codex and Claude subagents, verifies it and merges. This page records that process: the steps each feature goes through, which model runs each one, and how agents are spawned. You don't need any of this to contribute by hand; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Feature steps

The steps every new feature goes through, and which model runs each one. The rules a feature is checked against are in the [constitution](../.specify/memory/constitution.md); the commands are in [AGENTS.md](../AGENTS.md); worktree rules and spawning are [below](#agent-team).

"Design settled" means the design comes from an approved source (an earlier spec, a reviewed proposal or the maintainer's answers) and only the implementation is left. "Design open" means the approach still needs choosing.

The maintainer takes part in three steps: the idea (1), the clarify answers (4) and the approval (8).

| #   | Step                                                                                                                                                                                                             | Who runs it                                                  | Model                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Idea:** the maintainer describes the feature                                                                                                                                                                   | Owner and lead                                               | Lead session                                                                                                                                                                                                                        |
| 2   | **Worktree:** branch from the latest `main` into `.worktrees/<branch>`, one feature at a time                                                                                                                    | Lead                                                         | Lead session                                                                                                                                                                                                                        |
| 3   | **Specify:** `/speckit-specify` writes `spec.md` and a requirements checklist                                                                                                                                    | Claude subagent                                              | **Sonnet** (medium) when the design is settled. **Opus** (medium) when it's open                                                                                                                                                    |
| 4   | **Clarify:** up to 5 questions per feature, answers recorded in the spec                                                                                                                                         | Lead asks, **maintainer answers**, a subagent writes them in | Lead session asks. **Sonnet** (medium) records the answers                                                                                                                                                                          |
| 5   | **Plan:** `/speckit-plan` writes the plan and design files, checks the plan against the constitution, and splits the work into PRs with the files each owns                                                      | Claude subagent                                              | **Sonnet** (medium) when the design is settled. **Opus** (medium) when it's open                                                                                                                                                    |
| 6   | **Tasks:** `/speckit-tasks` writes `tasks.md`                                                                                                                                                                    | Codex worker, or Opus                                        | **Sol** (`gpt-6.1-sol`, medium) when the design is settled. **Opus** (medium) when it's open                                                                                                                                        |
| 7   | **Analyze and task review:** `/speckit-analyze` checks spec, plan and tasks against each other and the constitution; the maintainer resolves findings and records task status in `tasks.md`                      | Read-only reviewer, then the lead                            | **Sonnet** (medium, read-only). Fixes by **Sonnet**                                                                                                                                                                                 |
| 8   | **Approval:** the maintainer approves; the lead commits `specs/NNN-feature/` with its `specs/README.md` row as the first commit and opens a spec PR                                                              | Owner, then lead                                             | Lead session                                                                                                                                                                                                                        |
| 9   | **Build, one PR at a time:** the lead makes a worktree per PR and writes a brief with the task IDs and files the worker owns; the worker builds and ticks its tasks                                              | Codex worker or Claude subagent                              | **Luna** (`gpt-6-luna`, high) for small or clearly specified tasks. **Sol** (medium) for new modules, security-sensitive code, data-model changes and multi-file features. **Sonnet** (medium) for unclear design or hard debugging |
| 10  | **Verify and review:** root `lint`, `typecheck`, `test`, `build` and `test:e2e`; review, fix and re-review until approved                                                                                        | Lead, Sonnet reviewer, then the same worker                  | **Sonnet** (medium, read-only), always a separate agent from the one that built the PR. Fixes by whoever built it                                                                                                                   |
| 11  | **Merge and close:** merge once approved with root `lint`, `typecheck`, `test`, `build` and `test:e2e` green, tick the PR's tasks in `tasks.md`, then `/speckit-converge`. Anything it finds goes back to step 9 | Lead                                                         | Lead session                                                                                                                                                                                                                        |

The lead session is the one the maintainer talks to. It writes briefs, verifies, commits, opens PRs and merges, whatever model it runs on.

## Agent team

The lead always splits feature work across these agents ([AGENTS.md](../AGENTS.md#workflow) makes this the default; the maintainer doesn't have to ask). Use this distribution:

| Work                                                                                        | Agent           | Model         | Effort   |
| ------------------------------------------------------------------------------------------- | --------------- | ------------- | -------- |
| Easy or clearly specified tasks: precise review fixes, small features, config, docs         | Codex           | `gpt-6-luna`  | `high`   |
| Medium tasks: new modules, security-sensitive code, data-model changes, multi-file features | Codex           | `gpt-6.1-sol` | `medium` |
| Implementation where the design is unclear, or hard debugging                               | Claude subagent | `sonnet`      | `medium` |
| Designing a feature whose design is open, and architecture                                  | Claude subagent | `opus`        | `medium` |
| Spec Kit `specify` and `plan` when the design is settled                                    | Claude subagent | `sonnet`      | `medium` |
| Spec Kit `specify` and `plan` when the design is open                                       | Claude subagent | `opus`        | `medium` |
| Spec Kit `tasks` when the design is settled                                                 | Codex           | `gpt-6.1-sol` | `medium` |
| Spec Kit `tasks` when the design is open                                                    | Claude subagent | `opus`        | `medium` |
| Recording clarify answers in the spec, and other mechanical spec edits                      | Claude subagent | `sonnet`      | `medium` |
| `/speckit-analyze` and task review (read-only), and the fixes they lead to                  | Claude subagent | `sonnet`      | `medium` |
| Reviewing every PR and re-reviewing its fixes (never the agent that built it)               | Claude subagent | `sonnet`      | `medium` |

Sol, Sonnet or Opus: use Sol when the design is clear and only the implementation is involved, even across many files. Use Sonnet when the implementation's design is unclear or debugging is hard. Use Opus only when the feature's design is still open (designing it, or its Spec Kit specify, plan and tasks).

The lead (the agent the user talks to) writes the briefs, verifies, commits, opens PRs and merges. It may make one- or two-line fixes itself, with a regression test.

Spawning:

- Codex, from the task's worktree:
  `codex exec -m <model> -c model_reasoning_effort='"<effort>"' -s workspace-write -c sandbox_workspace_write.network_access=true --skip-git-repo-check -C <worktree> -o <result.md> - < <brief.md>`
- Opus: Claude Code `Agent` tool with `model: "opus"` and `effort: "medium"`, for open design only. It returns a plan or a Spec Kit spec and plan that the lead turns into briefs.
- Sonnet worker: Claude Code `Agent` tool with `model: "sonnet"` and `effort: "medium"`. For implementation with an unclear design or hard debugging it works in its own worktree, then follows the same review and merge flow; for settled `specify` and `plan`, clarify answers, analyze fixes and other mechanical spec edits it works in the feature's worktree.
- Sonnet reviewer: Claude Code `Agent` tool with `model: "sonnet"` and `effort: "medium"`, read-only. Send fix re-reviews to the same reviewer so it keeps its context.

Codex sandbox: `codex exec -s workspace-write` uses `bwrap`, which needs unprivileged user namespaces. On Ubuntu with AppArmor, if Codex reports `bwrap: setting up uid map: Permission denied`, the user runs `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0` in their own terminal (it resets on reboot). Never run Codex unsandboxed instead.

Flow for each task:

1. One branch and one git worktree per task, created inside the repository at `.worktrees/<branch-name>` (git-ignored; for example `git worktree add -b feat/x .worktrees/feat-x main`). The lead installs dependencies before the worker starts; workers never edit lockfiles.
2. The brief lists the files the worker owns. Parallel workers never own the same file; shared barrels (`packages/core/src/index.ts`, `packages/api/src/index.ts`) only get additive edits.
3. The lead verifies with the full root `lint`, `typecheck`, `test`, `build` and `test:e2e` (not just one package).
4. Commit as `Claude <noreply@anthropic.com>`, open a PR, get the Sonnet review, send findings back to Luna or Sol, then re-review.
5. Merge only when the review approves and every CI run is green: `if gh pr checks <n> > /dev/null; then gh pr merge <n> --rebase; fi`. `main` has no branch protection, so this check is the gate. A pass/fail split on the same commit is a flaky test to fix, not to re-run.
