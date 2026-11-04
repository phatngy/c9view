# Implementation Plan: Session Control

**Branch**: `docs/speckit-multi-machine` (docs); one branch per PR below | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-session-control/spec.md`, with implementation detail from [design-notes.md](design-notes.md). Builds on [001-multi-machine](../001-multi-machine/plan.md) PRs 6.0a, 6.0b and 6.0d.

## Summary

The node runs Claude Code sessions through the TypeScript Agent SDK (`@anthropic-ai/claude-agent-sdk`) in streaming input mode: reply (resume), fork, new session, approvals and questions through `canUseTool`, interrupt, stop and permission mode. Everything that touches `~/.claude`, project folders and processes lives in `packages/node/src/control/` behind one `ControlService`; the browser-facing guard lives on the hub (`apps/hub/src/control/guard.ts`). Every mutation is retry-safe with a `clientRequestId` reservation and a receipt carrying the node's `bootId`. Events are ID-only refresh hints; `GET …/control/runs` is the source of truth. Folder trust gates every run. 6d adds new or imported projects under workspace roots through a separate hardened git runner, and c9view labels, both only with control on. Work ships as the design draft's PRs 6a–6d.

## Technical Context

**Language/Version**: TypeScript (strict, ESM), Node 22.

**Primary Dependencies**: existing Hono, Zod, better-sqlite3 + Drizzle, TanStack Query/Router, Base UI, lucide. **New**: `@anthropic-ai/claude-agent-sdk` in `packages/node` only, loaded with a dynamic `import()` from `control/sdk.ts` when control is on ([research.md](research.md#r1-agent-sdk)).

**Storage**: runs, pending requests and receipts in memory; node state store `~/.claude/c9view/node/state.db` (trusted folders with fingerprints, session labels), separate from the rebuildable index; reads `~/.claude.json` (`projects[path].hasTrustDialogAccepted` only).

**Testing**: Vitest with a fake `sdk.ts` adapter and a fake git runner; CI makes no real Claude calls. Guard tests run against the hub with an in-process node. Manual end-to-end check by the maintainer with the owner's consent (spends real tokens).

**Target Platform**: native Linux and macOS nodes (WSL on Windows); refused in containers (001 FR-027).

**Project Type**: pnpm workspace: web app + hub + node + CLI.

**Performance Goals**: reply returns 202 before the SDK starts; control state read is small (runs ≤ max runs).

**Constraints**: control off by default; login always required with control, no override; no browser-supplied paths except a new project's location; tool input never from the browser.

**Scale/Scope**: single owner; `C9VIEW_CONTROL_MAX_RUNS` concurrent runs (default 3).

### Settings and their environment variables

Parsed with Zod in `packages/node/src/control/config.ts`; every value configurable by environment (clarified 2026-11-04).

| Variable / flag                                            | Default                                         | FR     |
| ---------------------------------------------------------- | ----------------------------------------------- | ------ |
| `C9VIEW_CONTROL=1` / `--control`                           | off                                             | FR-001 |
| `C9VIEW_CONTROL_BYPASS=1` / `--bypass`                     | off; only with control                          | FR-025 |
| `C9VIEW_CLAUDE_BIN`                                        | unset → `claude` on PATH → SDK's bundled binary | FR-002 |
| `C9VIEW_CONTROL_MAX_RUNS`                                  | 3                                               | FR-006 |
| `C9VIEW_CONTROL_IDLE_MIN`                                  | 10                                              | FR-012 |
| `C9VIEW_CONTROL_APPROVAL_MIN`                              | 30                                              | FR-013 |
| `C9VIEW_CONTROL_MAX_TURNS`                                 | unset                                           | FR-012 |
| `C9VIEW_CONTROL_MAX_BUDGET_USD`                            | unset (no budget cap)                           | FR-012 |
| `C9VIEW_CONTROL_RECEIPT_MIN`                               | 10                                              | FR-021 |
| `C9VIEW_CONTROL_TOMBSTONE_MAX`                             | 100000                                          | FR-021 |
| `C9VIEW_CONTROL_TEXT_MAX_CHARS`                            | 20000                                           | FR-007 |
| `C9VIEW_WORKSPACE_ROOTS` / `--workspace-root` (repeatable) | none ("New project" hidden)                     | FR-023 |
| `C9VIEW_CLONE_TIMEOUT_MIN`                                 | 10                                              | FR-023 |
| Body limit                                                 | 001's `C9VIEW_REQUEST_BODY_MAX_BYTES` (48 KiB)  | FR-007 |

## Constitution Check

_GATE: checked against constitution v1.0.0 before Phase 0, re-checked after Phase 1 design. Result: **PASS**, no violations to justify._

| Principle                               | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| I. Never Change Claude Data or Projects | Control is opt-in (node flag, off by default), in its own spec with its own guard (`guard.ts`). c9view writes only `~/.claude/c9view/node/state.db`; the Claude Code children write their own data. `~/.claude.json` read only. Project create, `git init` and clone only with control on, only under workspace roots, only on explicit request, never auto-trusted, through `packages/node/src/projects/git-write.ts`, separate from `createGit`; all other git stays on `createGit`. Writable checks use `fs.access(W_OK)`, never test writes. | Pass   |
| II. Private by default                  | Permission cards, trust summaries and clone errors pass through secret hiding before leaving the node; prompts, tool input and answers never logged; child env drops every `C9VIEW_*` key; c9view handles no Claude credentials.                                                                                                                                                                                                                                                                                                                 | Pass   |
| III. Local first, explicit exposure     | Hub refuses auth `none` with control on any host, and refuses a node reporting control, with no override (FR-002). Guard: JSON POST, allowed Origin (missing refused), `X-C9view-Control: 1`, authenticated (FR-003). Node control routes unreachable except through the hub.                                                                                                                                                                                                                                                                    | Pass   |
| IV. Tolerant parsing                    | Bodies, SDK messages, `~/.claude.json`, project settings for the trust summary parsed with Zod tolerating unknown fields. `state.db` is persistent state, separate from the index; labels survive index rebuilds.                                                                                                                                                                                                                                                                                                                                | Pass   |
| V. Strict, small, tested                | Contract types in `@c9view/api` (`control.ts`, additive). `sdk.ts` is the only SDK import; `git-write.ts` the only git writer. All routes new (additive).                                                                                                                                                                                                                                                                                                                                                                                        | Pass   |
| VI. Fast on large data                  | Conversation stays transcript-driven; no second render path; control state read is bounded by the run cap.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass   |
| VII. Honest and accessible UI           | Run cost labelled "≈ API-equivalent" with the billing note; Bypass badge with text; cards keyboard and screen-reader accessible, 44 px targets below 1024 px, live-region announcements; 390 px layout.                                                                                                                                                                                                                                                                                                                                          | Pass   |
| Technology constraints                  | Agent SDK allowed with this justification (research R1); no WebSocket use here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass   |

## Project Structure

### Documentation (this feature)

```text
specs/002-session-control/
├── spec.md
├── design-notes.md
├── plan.md              # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── control-api.md
│   └── control-events.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/
├── api/src/control.ts                      # 6a: contract types
└── node/src/
    ├── control/                            # 6a
    │   ├── config.ts  sdk.ts  runs.ts  requests.ts  receipts.ts
    │   ├── trust.ts  state.ts  liveness.ts  service.ts  routes.ts  env.ts
    │   └── *.test.ts, fake-sdk.ts
    ├── projects/                           # 6d
    │   ├── roots.ts  browse.ts  create.ts  clone.ts  git-write.ts  url.ts  routes.ts  *.test.ts
    └── labels/                             # 6d
        ├── labels.ts  routes.ts  *.test.ts
apps/
├── hub/src/control/guard.ts                # 6a
└── web/src/
    ├── kit/Dialog.tsx                      # 6c (Base UI Dialog; also used by 001 PR 7d)
    └── control/                            # 6b, 6c, 6d
        ├── api.ts  useControl.ts  Composer.tsx  PermissionCard.tsx  QuestionCard.tsx
        ├── RunBar.tsx  TrustCard.tsx  BypassBadge.tsx
        ├── NewSessionDialog.tsx            # 6c
        └── NewProjectDialog.tsx  FolderPicker.tsx  SessionLabel.tsx   # 6d
```

**Structure Decision**: control code sits on the node and the guard on the hub, as 001's components require; nothing in `apps/hub` imports the SDK.

## PR split

Order: **6a → 6b → 6c → 6d**. 6a starts after 001's 6.0a, 6.0b and 6.0d merge; 001's 6.0c merges before 6b. 6c starts after 6b (and after project page PR 3b if both are open, since both edit `apps/web/src/project/header.tsx`). 6d starts after 6c. Task ranges are in [tasks.md](tasks.md).

| PR                                              | Responsibility                                                                | Owns (new)                                                                                                                                                      | Additive edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Tasks                |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **6a** control on the node, guard on the hub    | Implementation (security-sensitive); maintainer adds the SDK and the lockfile | `packages/node/src/control/` (all files above), `apps/hub/src/control/guard.ts`, `packages/api/src/control.ts`                                                  | `packages/api/src/index.ts`; `packages/node/src/app.ts` (mount control routes when on); `packages/node/src/hello.ts` (control and bypass capability); `packages/node/src/runtime.ts` (shutdown closes runs); `apps/hub/src/app.ts` (guard on control paths before relaying); `apps/hub/src/main.ts` (refuse auth `none` with control); `apps/hub/src/machines.ts` (capabilities); `packages/cli/src/start.ts` and `packages/cli/src/main.ts` (`--control`, `--bypass`; `--workspace-root` in 6d); `packages/node/package.json` (SDK); `docs/deploy.md`; `docs/data-sources.md` (spike answers) | T001–T040, T091–T092 |
| **6b** web reply and approvals                  | Implementation                                                                | `apps/web/src/control/` (`api.ts`, `useControl.ts`, `Composer.tsx`, `PermissionCard.tsx`, `QuestionCard.tsx`, `RunBar.tsx`, `TrustCard.tsx`, `BypassBadge.tsx`) | `apps/web/src/session.tsx` and the phone Chat tab (mount points); `apps/web/src/live/index.tsx` (`control.*` invalidation); `apps/web/src/session/header/` (Driven by c9view, Bypass badge); board cards (Bypass badge)                                                                                                                                                                                                                                                                                                                                                                        | T041–T056            |
| **6c** new session from the project page        | Implementation                                                                | `apps/web/src/control/NewSessionDialog.tsx`, `apps/web/src/kit/Dialog.tsx`                                                                                      | `apps/web/src/project/header.tsx` ("New session"); `apps/web/src/kit/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | T057–T062            |
| **6d** new or imported projects, session labels | Implementation (security-sensitive)                                           | `packages/node/src/projects/`, `packages/node/src/labels/`, `apps/web/src/control/NewProjectDialog.tsx`, `FolderPicker.tsx`, `SessionLabel.tsx`                 | `packages/node/src/app.ts` (mount when control on); `packages/node/src/control/state.ts` (labels table); Overview and project list ("New project"); session header (label); `AGENTS.md` (already states the write rule — verify)                                                                                                                                                                                                                                                                                                                                                               | T063–T085, T093      |
| Polish                                          | maintainer                                                                    | —                                                                                                                                                               | `specs/README.md`, manual check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | T086–T090            |

## Complexity Tracking

No constitution violations.
