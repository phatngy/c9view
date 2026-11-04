# Tasks: Baseline: c9view as shipped

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md).

**Status: shipped. Ticked tasks record work done before this spec was written; open tasks are the known follow-ups.**

**Organization**: Setup and foundations precede the nine stories in specification order, then Polish and the open follow-ups. Paths are relative to the repository root. Each task lists the FR IDs it covers; verification tasks identify existing regression coverage, rather than claiming a new test run.

**Format**: Sequential task IDs; story tasks carry [US1] through [US9]. All shipped tasks are ticked. The final phase contains exactly one open task per known gap.

## Phase 1: Setup (Shared Infrastructure)

**Goal**: Establish the workspace, quality gates, synthetic fixtures and project instructions.

- [x] T001 Create the pnpm packages and apps with strict ESM TypeScript, ESLint, Prettier and package test scripts in `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc` and `package.json` (FR-173).

- [x] T002 Run lint, typecheck, test and build on pushes and pull requests in `.github/workflows/ci.yml`; keep synthetic data in `tests/fixtures/claude/` and `apps/server/test/fixtures/claude/` (FR-172).

- [x] T003 Centralize instructions in `AGENTS.md` with the one-line include in `CLAUDE.md`, and establish the constitution, templates and skills in `.specify/`, `.claude/skills/` and `.agents/skills/` (FR-173).

- [x] T004 Verify workspace and fixture integration with `packages/core/src/index.test.ts`, `packages/cli/src/main.test.ts` and `apps/web/src/App.test.tsx` (FR-172, FR-173).

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Share HTTP types, cache source data and protect every response before building screens.

- [x] T005 Define shared project, session, message, usage, config and live-event contracts in `packages/api/src/index.ts`; compose Hono routes and the cached snapshot in `apps/server/src/app.ts` and `apps/server/src/data/store.ts` (FR-029, FR-042, FR-081, FR-093, FR-169).

- [x] T006 Hide secrets in config, messages and outgoing responses with `packages/core/src/redact/index.ts` and `apps/server/src/data/redaction.ts`; return redacted logs, generic server errors and JSON API 404s in `apps/server/src/app.ts` (FR-092, FR-168, FR-171).

- [x] T007 Verify cached snapshots and response security with `apps/server/src/data/cache.test.ts`, `apps/server/src/index.test.ts`, `packages/core/src/redact/index.test.ts` and `packages/core/src/redact/security.test.ts` (FR-168, FR-171).

## Phase 3: User Story 1 — Read and index Claude data reliably (P1)

**Goal**: Read tolerant, resumable transcripts and maintain a rebuildable index.

**Independent test**: Scan synthetic fixtures, append a complete record, rescan incrementally and rebuild a deleted index with the same counts.

- [x] T008 [US1] Load the Claude directory and extra workspace roots in `packages/core/src/config/index.ts`; discover projects and prefer matching encoded cwd hints, then frequent hints, filesystem and decoded paths in `packages/core/src/projects/index.ts` and `packages/core/src/index-db/indexer.ts` (FR-001, FR-002, FR-003).

- [x] T009 [US1] Parse tolerant Zod records, count malformed and unknown lines, stream by byte offset and retain incomplete trailing lines in `packages/core/src/transcript/schemas.ts` and `packages/core/src/transcript/reader.ts` (FR-004, FR-005).

- [x] T010 [US1] Link subagent transcripts to parent Task calls and summarize titles, time, cwd, branch, models, permission modes, tools, errors and counts in `packages/core/src/transcript/subagents.ts` and `packages/core/src/transcript/summary.ts` (FR-006, FR-007).

- [x] T011 [US1] Count input, output, cache-read, cache-creation and thinking tokens and de-duplicate repeated assistant message usage in `packages/core/src/transcript/usage.ts`; read optional stats and history in `packages/core/src/stats/index.ts` (FR-008, FR-009).

- [x] T012 [US1] Build SQLite projects, sessions, messages, daily usage and FTS5 tables in `packages/core/src/index-db/schema.ts` and `packages/core/src/index-db/queries.ts`, with generated migrations and drift checks in `packages/core/src/index-db/migrations/` and `packages/core/src/index-db/migration.ts`; keep the index outside Claude data with `packages/core/src/index-db/paths.ts` (FR-010, FR-170).

- [x] T013 [US1] Resume indexing by offsets and detect replacement or truncation by identities and hashes in `packages/core/src/index-db/indexer.ts`; watch updates with `packages/core/src/watch/index.ts` and `apps/server/src/data/start-index.ts` (FR-005, FR-011).

- [x] T014 [US1] Expose scan counts, token totals and unknown record types through `packages/core/src/scan/index.ts` and `packages/cli/src/main.ts`; retain the full-scan, no-op and incremental performance checks in `apps/server/test/benchmark.ts` (FR-012, FR-011; SC-001 records the historical real-data measurement).

- [x] T015 [US1] Verify reading, summaries, subagents, stats, resolution, rebuilds and CLI output with `packages/core/src/transcript/reader.test.ts`, `packages/core/src/transcript/summary.test.ts`, `packages/core/src/transcript/subagents.test.ts`, `packages/core/src/stats/index.test.ts`, `packages/core/src/projects/index.test.ts`, `packages/core/src/projects/indexer.test.ts`, `packages/core/src/index-db/indexer.test.ts`, `packages/core/src/index-db/migration.test.ts` and `packages/cli/src/main.test.ts` (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012).

## Phase 4: User Story 2 — See which sessions need attention (P1)

**Goal**: Combine status evidence into a live board with reasons and confidence.

**Independent test**: Feed each hook, live-file and transcript rule and inspect columns, reasons, confidence, stale flags and live movement.

- [x] T016 [US2] Read live process files, check process liveness and PID namespace, and derive unfinished-tool and question evidence in `apps/server/src/data/status.ts` and `packages/core/src/status/transcript.ts` (FR-020, FR-028).

- [x] T017 [US2] Decide the four columns from newest evidence, prefer hooks within five seconds, retain the last 200 evidence entries, lower confidence on disagreement and mark old active evidence stale in `packages/core/src/status/index.ts` (FR-020, FR-021, FR-022, FR-023, FR-024, FR-149).

- [x] T018 [US2] Append silent, whitelisted, size-limited hook events with private rotation and a dependency-free entry in `packages/core/src/hooks/hook-entry.ts`, `packages/core/src/hooks/writer.ts` and `packages/core/src/hooks/fields.ts`; tail events incrementally in `apps/server/src/data/hook-events.ts` (FR-026, FR-170).

- [x] T019 [US2] Show settings diffs, confirm writes, create backups and report installed hooks through `packages/cli/src/hooks.ts` and `packages/core/src/hooks/settings.ts` (FR-027).

- [x] T020 [US2] Keep status history and cheap polling in `apps/server/src/data/store.ts` and `apps/server/src/routes/sessions.ts`; emit column changes through `apps/server/src/data/start-index.ts` (FR-025, FR-029).

- [x] T021 [US2] Render four session columns and cards with title, branch, model, preview, tokens, age and reason in `apps/web/src/project/board.tsx` and `apps/web/src/project/sessions.ts` (FR-030, FR-149).

- [x] T022 [US2] Verify every status rule, hooks, history and cards with `packages/core/src/status/index.test.ts`, `packages/core/src/status/transcript.test.ts`, `packages/core/src/hooks/index.test.ts`, `packages/cli/src/hooks.test.ts`, `apps/server/src/data/status.test.ts`, `apps/server/src/data/hook-events.test.ts`, `apps/server/src/index.test.ts` and `apps/web/src/project/sessions.test.ts` (FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-149).

## Phase 5: User Story 3 — Read long conversations (P1)

**Goal**: Show complete conversation content with stable tail-first paging and navigation.

**Independent test**: Open a generated long session at its end, load older messages without losing position, jump through the outline and search, and expand tools and subagents.

- [x] T023 [US3] Serve indexed or cached session pages with default 200 and maximum 1000 messages, absolute cursors, newest-page mode and total counts in `apps/server/src/routes/sessions.ts`, `apps/server/src/data/indexed.ts` and `apps/server/src/data/messages.ts` (FR-042).

- [x] T024 [US3] Open at the tail, retain the resolved absolute cursor and load earlier pages after refetches at the top edge in `apps/web/src/session.tsx` and `apps/web/src/session/paging.ts` (FR-041, FR-043, FR-044).

- [x] T025 [US3] Render chat messages, thinking folds, attachments and snapshots with stable windowing and scroll position in `apps/web/src/session/Conversation.tsx`, `apps/web/src/session/WindowedMessages.tsx` and `apps/web/src/session/chat/` (FR-040, FR-045).

- [x] T026 [US3] Show Bash commands, Read/Grep details, Task subagent transcripts, questions and plan states, with expandable full output in `apps/web/src/tools/ToolCard.tsx`, `apps/web/src/tools/BashCard.tsx` and `apps/web/src/session/Conversation.tsx` (FR-046, FR-047, FR-048).

- [x] T027 [US3] Merge consecutive tool-only turns in `apps/web/src/session/turns.ts` and `apps/web/src/session/ToolGroup.tsx`; show slash chips, folded pasted text and token dividers in `apps/web/src/session/chat/CommandChip.tsx`, `apps/web/src/session/chat/PastedText.tsx` and `apps/web/src/session/chat/TurnDivider.tsx` (FR-049, FR-054).

- [x] T028 [US3] Navigate prompts, questions, plans and latest messages, track the visible turn, and search backward across loaded pages in `apps/web/src/session/Navigation.tsx` and `apps/web/src/session/header/SessionSearch.tsx` (FR-041, FR-050, FR-051).

- [x] T029 [US3] Separate current context fill from cumulative tokens and show per-turn usage, subagents, models, permission changes, tools, files, errors and the status timeline in `apps/web/src/session/ContextUsage.tsx`, `apps/web/src/session/context.ts` and `apps/web/src/session/Sidebar.tsx` (FR-052, FR-053).

- [x] T030 [US3] Match question answers to exact option labels in `apps/web/src/tools/QuestionCard.tsx`; render notice-only text alongside tools and keep edge errors in a separate alert in `apps/web/src/session/Conversation.tsx` and `apps/web/src/session/ConversationEdge.tsx` (FR-055, FR-056).

- [x] T031 [US3] Verify paging, virtualization, navigation, tool grouping, notices and exact option matching with `apps/web/src/session/paging.test.ts`, `apps/web/src/session/session.test.tsx`, `apps/web/src/session/turns.test.ts`, `apps/web/src/session/chat/chat.test.tsx`, `apps/web/src/tools/ToolCard.test.tsx` and `apps/server/src/data/indexed.test.ts` (FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056).

## Phase 6: User Story 4 — Review files and diffs (P2)

**Goal**: Expose inline and net diffs plus safe read-only project files and git changes.

**Independent test**: Check Edit/Write history and net counts, then exercise traversal, escaping symlinks, denied files, secrets, large files, binary files and git immutability.

- [x] T032 [US4] Parse structured patches and original files for Edit, MultiEdit and Write, and compute missing hunks with jsdiff in `packages/core/src/changes/tools.ts` (FR-060, FR-068).

- [x] T033 [US4] Map backups and snapshot/delta records to file versions and messages, then build net diffs, counts and steps in `packages/core/src/changes/history.ts` and `packages/core/src/changes/index.ts`; serve session change routes in `apps/server/src/routes/changes.ts` (FR-061, FR-062).

- [x] T034 [US4] Enforce project realpaths, symlink boundaries, deny-lists, gitignore and hidden node_modules with `packages/core/src/files/index.ts` and `packages/core/src/files/policy.ts`; return metadata for large or binary files and redact file/history content in `packages/core/src/changes/index.ts` (FR-063, FR-064).

- [x] T035 [US4] Run read-only git without a shell, optional locks, inherited Git environment or repository-configured commands, with timeout and denied git internals in `packages/core/src/git/index.ts` (FR-065).

- [x] T036 [US4] Serve lazy file listings, file contents, git status and diffs in `apps/server/src/routes/files.ts` and `apps/server/src/data/file-project.ts` (FR-066).

- [x] T037 [US4] Render unified/split diffs with Shiki, folded context, windowed rows and single-pass hunk layout in `apps/web/src/diff/DiffView.tsx`, `apps/web/src/diff/highlight.tsx`, `apps/web/src/diff/rows.ts` and `apps/web/src/diff/useWindowedRows.ts`; consume core-computed jsdiff hunks (FR-067).

- [x] T038 [US4] Embed tool diffs and step links in `apps/web/src/tools/EditBody.tsx`, `apps/web/src/tools/ToolRow.tsx` and `apps/web/src/files/SessionChanges.tsx`; show lazy trees, git badges, line anchors and HEAD changes in `apps/web/src/files/` (FR-068, FR-069, FR-070).

- [x] T039 [US4] Verify diffs and all file/git safety boundaries with `packages/core/src/changes/changes.test.ts`, `packages/core/src/files/files.test.ts`, `packages/core/src/git/git.test.ts`, `apps/server/src/routes/files.test.ts`, `apps/server/src/routes/files-errors.test.ts`, `apps/server/src/data/inline-changes.test.ts`, `apps/web/src/diff/DiffView.test.tsx`, `apps/web/src/diff/useWindowedRows.test.tsx` and `apps/web/src/files/files.test.tsx` (FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070).

## Phase 7: User Story 5 — Understand usage costs (P2)

**Goal**: Show API-equivalent token and cost analytics without invented values.

**Independent test**: Query a bounded time-zone-aware range and compare totals, cache-hit ratio, family series and table alternatives with the UI.

- [x] T040 [US5] Price usage from the bundled LiteLLM table and local overrides in `packages/core/src/pricing/prices.ts` and `packages/core/src/pricing/bundled-prices.json` (FR-080).

- [x] T041 [US5] Aggregate inclusive ranges of at most 366 days by IANA time zone, day, model and project in `apps/server/src/routes/usage.ts` and `apps/server/src/data/usage.ts`; compute cacheRead / (input + cacheRead + cacheCreation) in `apps/web/src/overview.tsx` and `apps/web/src/usage/UsageSection.tsx` (FR-081, FR-082).

- [x] T042 [US5] Label all cost figures with ≈ and API-equivalent billing help in `apps/web/src/ui.tsx`, `apps/web/src/usage/UsageSection.tsx` and `apps/web/src/overview.tsx`; use API totals and keep per-turn/context charts in the session in `apps/web/src/session/ContextUsage.tsx` (FR-080, FR-083, FR-085, FR-086).

- [x] T043 [US5] Aggregate model versions by family, use shared family colours and stable series slots with forced-colours patterns, and offer table alternatives in `apps/web/src/charts/UsageCharts.tsx`, `apps/web/src/charts/data.ts` and `apps/web/src/kit/model.ts` (FR-084, FR-138).

- [x] T044 [US5] Verify pricing, range validation, cache ratios, family charts and cost labels with `packages/core/src/pricing/prices.test.ts`, `apps/server/src/routes/usage.test.ts`, `apps/web/src/charts/UsageCharts.test.tsx`, `apps/web/src/usage/UsageSection.test.tsx` and `apps/web/src/overview/overview.test.tsx` (FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-138).

## Phase 8: User Story 6 — Inspect effective configuration (P2)

**Goal**: Read config sources with provenance and present compact, navigable sections.

**Independent test**: Inspect fixture settings and included instructions, confirm user → project → local precedence and masking, then navigate and filter sections by keyboard.

- [x] T045 [US6] Read settings, included instructions, MCP servers, skills, agents, commands, plugins and memory in `packages/core/src/claude-config/`; merge user, project and local settings with provenance in `packages/core/src/claude-config/settings.ts` and redact secrets before serving (FR-090, FR-091, FR-092).

- [x] T046 [US6] Serve global and project config in `apps/server/src/routes/config.ts`, `apps/server/src/routes/projects.ts` and `apps/server/src/data/config.ts`; expose project config tabs in `apps/web/src/config.tsx` (FR-093).

- [x] T047 [US6] Show counted section navigation and a keyboard-usable name/description/path filter, suppress observer changes after clicks and select the last section at the bottom in `apps/web/src/config-page.tsx` and `apps/web/src/config/sections.tsx` (FR-094, FR-096).

- [x] T048 [US6] Show compact expandable rows with scope and paths in `apps/web/src/config/ConfigRow.tsx`; keep one page h1 and stepped Markdown headings in `apps/web/src/markdown.tsx` and `apps/web/src/style.css` (FR-095, FR-097).

- [x] T049 [US6] Verify config readers, precedence, secrets, section navigation and heading hierarchy with `packages/core/src/claude-config/index.test.ts`, `packages/core/src/claude-config/security.test.ts` and `apps/web/src/config/ConfigSections.test.tsx` (FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097).

## Phase 9: User Story 7 — Search and export conversations (P2)

**Goal**: Find redacted conversation hits and export complete session content within shipped limits.

**Independent test**: Search with project/date/model filters, page hits, open a message, and export Markdown and JSON while checking secret masking.

- [x] T050 [US7] Search FTS messages with filters, default 50 and maximum 200 results and cursors in `apps/server/src/routes/search.ts` and `packages/core/src/index-db/queries.ts`; return 503 before readiness and 400 for invalid parameters, treat FTS syntax literally, and redact snippets with highlight/cut metadata (FR-100, FR-101, FR-107).

- [x] T051 [US7] Clean snippets and remap highlights, use accessible themed marks, group flat hits by session and show role/known model/time in `apps/web/src/search/snippet.ts`, `apps/web/src/search/highlights.tsx`, `apps/web/src/search/SearchPage.tsx` and `apps/web/src/style.css` (FR-102, FR-103, FR-104, FR-105).

- [x] T052 [US7] Route top-bar searches to filtered search with kit selects in `apps/web/src/search/TopSearch.tsx` and `apps/web/src/search/SearchPage.tsx` (FR-108).

- [x] T053 [US7] Collect paged, redacted session messages and export Markdown or JSON with progress and cancellation in `apps/web/src/session/export.ts` and `apps/web/src/session/ExportMenu.tsx` (FR-106).

- [x] T054 [US7] Verify literal search, redaction, filters, snippet cleaning, highlights and exports with `apps/server/src/routes/search.test.ts`, `apps/web/src/search/search.test.tsx`, `apps/web/src/search/snippet.test.ts` and `apps/web/src/session/session.test.tsx` (FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108).

## Phase 10: User Story 8 — Use a consistent, accessible interface on phones (P3)

**Goal**: Unify screens, navigation, typography and responsive controls.

**Independent test**: Inspect every page at desktop and phone widths in both themes; exercise keyboard navigation, URL round trips, filters and empty states.

- [x] T055 [US8] Define shared type, spacing, radius, elevation, surfaces and model colours in `apps/web/src/style.css` and `apps/web/src/kit/model.ts`; build accessible lucide/Base UI controls in `apps/web/src/kit/` and the Base UI drawer in `apps/web/src/shell/AppShell.tsx` (FR-120, FR-121, FR-148).

- [x] T056 [US8] Build the collapsible project sidebar with search, status dots, attention counts and current sessions in `apps/web/src/shell/Sidebar.tsx`, `apps/web/src/shell/ProjectNav.tsx` and `apps/web/src/shell/CurrentSessions.tsx`; add the slim top bar and theme menu in `apps/web/src/shell/TopBar.tsx` and `apps/web/src/shell/ThemeMenu.tsx` (FR-122, FR-146).

- [x] T057 [US8] Keep the session header sticky, scroll the chat and rail independently and replace the rail with Chat / Outline / Files / Usage tabs below 1024 px in `apps/web/src/session/header/SessionHeader.tsx`, `apps/web/src/session.tsx` and `apps/web/src/style.css` (FR-123).

- [x] T058 [US8] Show range-aware cost/trend, cache-hit and live-session cards with selected-project context and workspace labels in `apps/web/src/overview.tsx`; add range/project controls and prop-driven usage in `apps/web/src/usage/UsageSection.tsx` (FR-124, FR-126, FR-137, FR-138).

- [x] T059 [US8] Filter Overview through URL-backed aria-pressed status buttons and show ten recent projects with nonzero urgency pills, horizontal scrolling and a Show all toggle in `apps/web/src/overview.tsx` (FR-125, FR-127).

- [x] T060 [US8] Show all-time project totals and Sessions / Usage / Files / Changes / Config underline tabs without a Changes count in `apps/web/src/project/header.tsx` and `apps/web/src/project.tsx` (FR-128, FR-129).

- [x] T061 [US8] Persist Board/List, filter and sort controls, debounce local filter input and distinguish no sessions from no matches in `apps/web/src/project/controls.tsx`; apply urgency order, compact inactive cards and shared sortable tables in `apps/web/src/project/board.tsx`, `apps/web/src/project/list.tsx` and `apps/web/src/project/sessions.ts` (FR-130, FR-131, FR-132, FR-139).

- [x] T062 [US8] Validate Overview and project URL state and defaults in `apps/web/src/router.tsx`; keep list headers/model badges unwrapped and numeric columns right-aligned in `apps/web/src/project/list.tsx` and `apps/web/src/style.css` (FR-133, FR-134).

- [x] T063 [US8] Disambiguate colliding project names with shared accessible parent hints in `apps/web/src/projectNames.ts` and `apps/web/src/shell/ProjectName.tsx`; add real parent Back links and compact mobile trails in `apps/web/src/shell/breadcrumbs.tsx` (FR-135, FR-136).

- [x] T064 [US8] Self-host IBM Plex Sans/Mono 400/500/600 with swap and fallbacks in `apps/web/src/main.tsx` and `apps/web/src/style.css`; use the caption 12/16, small 13/18, body 14/20, lead 16/24, title 20/28 and display 28/34 scale, weights 400/500/600, minimum 12 px text, tabular figures and 13 px mono code with 24 px diff rows (FR-140, FR-141, FR-142, FR-143, FR-144).

- [x] T065 [US8] Provide skeletons, empty states, responsive layouts and reduced-motion styling in `apps/web/src/kit/Skeleton.tsx`, `apps/web/src/kit/EmptyState.tsx`, `apps/web/src/style.css` and `apps/web/src/shell/shell.css` (FR-145, FR-147, FR-148).

- [x] T066 [US8] Verify UI controls, shell, routing, overview, board/list, typography and responsive styling with `apps/web/src/kit/Tabs.test.tsx`, `apps/web/src/kit/Select.test.tsx`, `apps/web/src/shell/shell.test.tsx`, `apps/web/src/shell/breadcrumbs.test.tsx`, `apps/web/src/shell/ProjectName.test.tsx`, `apps/web/src/session/header/header.test.tsx`, `apps/web/src/overview/overview.test.tsx`, `apps/web/src/project/route.test.tsx`, `apps/web/src/project/controls.test.tsx`, `apps/web/src/fonts.test.ts`, `apps/web/src/typography.test.ts` and `apps/web/src/style.test.ts` (FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140, FR-141, FR-142, FR-143, FR-144, FR-145, FR-146, FR-147, FR-148).

## Phase 11: User Story 9 — Run safely locally or through a tunnel (P1)

**Goal**: Package one local process with explicit exposure guards and optional login.

**Independent test**: Start against fixtures, refuse exposed unauthenticated starts, require login even on loopback, reject unknown hosts and observe SSE invalidation and fallback.

- [x] T067 [US9] Start the server and built SPA on loopback port 7777 with CLI flags, environment overrides, optional browser opening and clean shutdown in `packages/cli/src/main.ts`, `packages/cli/src/start.ts` and `apps/server/src/main.ts` (FR-160).

- [x] T068 [US9] Validate exposure and tunnel allow-lists, require token/password login even on loopback, and implement token generation, scrypt, throttling and expiring cookies in `apps/server/src/auth/index.ts`; guard Host/Origin and public login assets in `apps/server/src/app.ts`, with the login screen in `apps/web/src/login.tsx` (FR-161, FR-162, FR-163, FR-164, FR-165).

- [x] T069 [US9] Build the multi-stage non-root image and read-only mounts/root filesystem with dropped capabilities and required token in `Dockerfile` and `docker-compose.yml`; document optional host PID access, Tailscale and Cloudflare Access in `docs/deploy.md` (FR-166, FR-167).

- [x] T070 [US9] Redact all outgoing data and errors and block transcript-driven remote content in `apps/server/src/app.ts`, `apps/server/src/data/redaction.ts` and `apps/web/src/markdown.tsx`; keep all dashboard reads read-only and hook/index writes in their permitted locations through `packages/core/src/config/index.ts` and `packages/core/src/hooks/writer.ts` (FR-168, FR-170, FR-171).

- [x] T071 [US9] Stream live hints with shared targeted query invalidation and polling fallback through `apps/server/src/data/events.ts`, `apps/server/src/routes/events.ts` and `apps/web/src/live/` (FR-169).

- [x] T072 [US9] Verify startup, auth, Host/Origin, redaction and live fallback with `packages/cli/src/start.test.ts`, `apps/server/src/auth/startup.test.ts`, `apps/server/src/auth/auth.test.ts`, `apps/server/src/main-token.test.ts`, `apps/server/src/index.test.ts`, `apps/server/src/data/lifecycle.test.ts`, `apps/web/src/login.test.tsx`, `apps/web/src/live/live.test.tsx` and `apps/web/src/live/state.test.ts` (FR-160, FR-161, FR-162, FR-163, FR-164, FR-165, FR-166, FR-167, FR-168, FR-169, FR-170, FR-171). Docker and tunnel instructions also require the manual checks documented in the deployment guide.

## Phase 12: Polish & Cross-Cutting Concerns

**Goal**: Record shared security, performance and visual regression coverage across the shipped product.

- [x] T073 Keep code splitting and route loading in `apps/web/src/router.tsx` and `apps/web/vite.config.ts`, alongside the CI gate in `.github/workflows/ci.yml` (FR-147, FR-172).

- [x] T074 Verify cross-screen regressions and security with `apps/web/src/App.test.tsx`, `apps/web/src/typography.test.ts`, `packages/core/src/redact/security.test.ts`, `packages/core/src/git/git.test.ts` and `apps/server/src/index.test.ts` (FR-142, FR-148, FR-168, FR-170, FR-172).

- [x] T086 Add a Playwright end-to-end suite in `tests/e2e/` with `playwright.config.ts` and a CI job in `.github/workflows/ci.yml`; remove the former local screenshot helper (FR-147).

## Dependencies and execution order

Build order: data reading → status → screens → files and diffs → analytics → visual design → packaging.

Setup and foundations support US1 data reading, then US2 status. Screens use US3 conversation and US6 configuration; US4 files and diffs builds on conversation and safe core readers. US5 analytics and US7 search/export use the index and screen foundations. US8 visual design refines those screens; US9 packaging ties together startup, authentication and deployment. The phase list follows specification story order; shared foundations and config readers precede the screens that consume them.

## Parallel examples

These describe independent file groups in the shipped architecture; they do not schedule new implementation.

- US1: transcript parsing and project discovery can progress separately before index integration.
- US2: hook settings/CLI work and transcript status rules can progress separately before status integration.
- US3: tool-card rendering and paging helpers can progress separately before conversation integration.
- US4: safe file access and the git runner can progress separately before file API integration.
- US5: pricing and chart rendering can progress separately against the shared usage contract.
- US6: config readers and compact row rendering can progress separately against config types.
- US7: snippet cleanup and export formatting can progress separately.
- US8: font loading and project-name formatting can progress separately; shared styles require coordination.
- US9: container configuration and live-client state can progress separately; auth and server mounting require coordination.

## Implementation strategy

This is an as-built record, so completed tasks are evidence of shipped work rather than instructions to rebuild it. The original minimum useful slice is Setup + Foundational + US1, independently verified by fixture scans and index rebuilds. Status and screens extend that slice; files, analytics, visual design and packaging complete the shipped product. Follow-ups below remain outside the completed baseline.

## Traceability limits

FR-067 maps jsdiff computation to core and rendering to the web; the web does not compute jsdiff hunks. FR-121 maps to the existing kit and the Base UI Dialog used directly by the shell; no standalone kit Dialog or Popover wrapper is claimed. FR-147 is covered by a Playwright end-to-end suite in CI. Docker and tunnel requirements FR-166/FR-167 map to existing deployment artifacts, related startup tests and manual verification, rather than dedicated container/tunnel tests.

## Phase 13: Follow-ups (open)

**Goal**: Preserve exactly the eleven known gaps; paths identify likely implementation or verification sites.

- [ ] T075 Optionally set feature_numbering to timestamp so parallel features do not need an explicit directory; update `.specify/init-options.json`. (GAP-001)

- [ ] T076 Add an endpoint that finds a message position so jumps reach any message regardless of the page cap; touch `apps/server/src/routes/sessions.ts`, `apps/server/src/data/indexed.ts`, `packages/core/src/index-db/queries.ts`, `packages/api/src/index.ts` and `apps/web/src/session/paging.ts`. (GAP-002)

- [ ] T077 Optionally add stat sparklines and change versus the previous period, first returning the prior range from the API; touch `apps/server/src/routes/usage.ts`, `apps/server/src/data/usage.ts`, `packages/api/src/index.ts`, `apps/web/src/overview.tsx` and `apps/web/src/charts/UsageCharts.tsx`. (GAP-003)

- [ ] T078 Confirm on real data that notice-only text beside tool calls renders correctly; inspect `apps/web/src/session/Conversation.tsx` and the existing fixture regression in `apps/web/src/session/session.test.tsx` (FR-056), without copying real content into fixtures. (GAP-004)

- [ ] T079 Consider preserving parent URL state on Back: Overview range/status/project and project tab/view/filter; touch `apps/web/src/shell/breadcrumbs.tsx`, `apps/web/src/router.tsx` and `apps/web/src/shell/breadcrumbs.test.tsx`. (GAP-005)

- [ ] T080 Reset lastCommitted when external URL changes leave the project filter equal to the last commit but the input empty; touch `apps/web/src/project/controls.tsx` and `apps/web/src/project/controls.test.tsx`. (GAP-006)

- [ ] T081 Add deterministic tie-breaking for equal-count cwd hints and pass the counts map rather than expanding it on each scan; touch `packages/core/src/projects/index.ts`, `packages/core/src/index-db/indexer.ts`, `packages/core/src/projects/index.test.ts` and `packages/core/src/projects/indexer.test.ts`. (GAP-007)

- [ ] T082 Improve outline click suppression beyond scrollend or 600 ms and narrow the late-mount MutationObserver that watches document.body until conversation mount; touch `apps/web/src/session/Navigation.tsx` and `apps/web/src/session/session.test.tsx`. (GAP-008)

- [ ] T083 Restore window.setTimeout and clearTimeout spies in config tests; touch `apps/web/src/config/ConfigSections.test.tsx`. (GAP-009)

- [ ] T084 Assess synthesized bold italic and mono italic and add font faces if they look poor; touch `apps/web/src/main.tsx`, `apps/web/src/style.css`, `apps/web/src/fonts.test.ts` and `apps/web/src/typography.test.ts`. Tailwind `text-base`/`text-lg` now map to 14/16 px, so the sidebar wordmark shrank from 18 to 16 px; revisit if wanted. (GAP-010)

- [ ] T085 Add an npm-package and container-image release workflow; packages remain private at version 0.0.0 and npx c9view is not yet available. Touch `.github/workflows/release.yml` (new), `package.json`, `packages/cli/package.json`, `packages/core/package.json`, `packages/api/package.json`, `apps/server/package.json`, `apps/web/package.json`, `Dockerfile` and `docs/deploy.md`. (GAP-011)
