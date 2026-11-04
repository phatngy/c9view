# Research: Session Control

Phase 0 for [plan.md](plan.md). No open NEEDS CLARIFICATION; decisions come from the design draft ([notes](design-notes.md#approach)) and the owner's answers of 2026-11-04 ([spec.md](spec.md#clarifications)). Items marked **spike** are confirmed in PR 6a before building on them (T001–T003), with answers recorded in `docs/data-sources.md`.

## R1. Agent SDK

- **Decision**: `@anthropic-ai/claude-agent-sdk`, imported only by `packages/node/src/control/sdk.ts` through a dynamic `import()` when control is on. `query({ prompt: AsyncIterable<SDKUserMessage>, options })` in streaming input mode; options used: `resume`, `forkSession`, `sessionId`, `cwd`, `settingSources` (default all), `canUseTool`, `abortController`, `env`, `maxTurns`, `maxBudgetUsd`, `pathToClaudeCodeExecutable`, `permissionMode`, `extraArgs: { name }`. `interrupt()`, `setPermissionMode()`, `close()`. Spike answers (2026-11-04, SDK 0.3.317, [docs/data-sources.md](../../docs/data-sources.md#sessions-started-through-the-agent-sdk)): `permissionMode` is always passed explicitly (omitted, the SDK starts in `auto`); bypass sets `allowDangerouslySkipPermissions: true` and is gated by c9view, since the SDK does not refuse bypass without it; `renameSession()` is not used (it writes the transcript from c9view's process).
- **Rationale**: typed control protocol; avoids re-implementing prompts, interrupts and framing. Justifies the new runtime dependency (constitution Technology Constraints).
- **Alternatives**: `claude -p --input-format stream-json` directly (same protocol, untyped).

## R2. Claude Code binary

- **Decision**: `C9VIEW_CLAUDE_BIN`, else `claude` resolved on `PATH` (no shell), else the SDK's bundled binary; passed as `pathToClaudeCodeExecutable`. `claude --version` (execFile, timeout) gives `claudeCodeVersion` for `hello` (001 FR-028). Not found → startup refusal naming `C9VIEW_CLAUDE_BIN`.
- **Rationale**: owner's answer; web and terminal sessions write the same transcript format.

## R3. Command receipts

- **Decision**: `receipts.ts` keeps `Map<operation:clientRequestId, Reservation>` in memory; fingerprint = SHA-256 of the canonical JSON body (sorted keys) minus `clientRequestId`. Reserve before acting (synchronous map insert, so atomic in one process); a repeat with the same fingerprint awaits the in-flight promise or returns the stored receipt; a different fingerprint → 409 `payload-mismatch`. TTL `C9VIEW_CONTROL_RECEIPT_MIN`. Every mutation carries `X-C9view-Boot-Id`, the node `bootId` the browser knew when it first sent the command (from `/api/machines`, kept with the command for retries). If the key is unknown and that `bootId` differs from the node's current one → 409 `unknown-outcome`, never acted on; the UI refetches the machine and runs and says the command may or may not have run. A matching `bootId` with an unknown key is a first send and acts — unless the key is in the boot's **tombstone set**: when a receipt expires, its `(operation, clientRequestId)` key (no body, no result) stays in a set for the rest of the boot, and a repeat of a tombstoned key gets 409 `unknown-outcome`, never a second action. The set is capped at `C9VIEW_CONTROL_TOMBSTONE_MAX` (100,000 keys, about 10 MB) and never evicts: at the cap the node can no longer prove a new key is new, so it answers every new mutation 409 `unknown-outcome` without acting and reports control `unavailable` with "restart the node to accept new commands"; a restart clears it with a new `bootId`.
- **Rationale**: FR-021; the hub never retries; 504 means "stopped waiting".
- **Alternatives**: persisting receipts (rejected: runs are memory-only, so a restart has nothing to resume).

## R4. Liveness and own runs

- **Decision**: `liveness.ts` wraps `packages/node/src/data/status.ts`: a `sessions/*.json` entry with matching `sessionId`, alive PID in the same `pidDomain`, not one of c9view's runs (by session ID in the registry, and child PID if the SDK exposes it — **spike**). Undecidable (e.g. no host PID namespace) → `liveness-unknown`. Checked before resume and again right before spawning.

## R5. Folder trust

- **Decision**: `trust.ts` builds the summary from `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, enabled plugins and `CLAUDE.md` presence (via `packages/core/src/claude-config/`), redacted; fingerprint = SHA-256 over each source file's path, size, mtime and content hash. Trusted if `~/.claude.json` `projects[path].hasTrustDialogAccepted === true` or `state.db` has a matching record for the path. Checked before every new run.

## R6. Node state store

- **Decision**: `state.ts` opens `~/.claude/c9view/node/state.db` (001 FR-031; 0700 folder, 0600 file) with better-sqlite3 + Drizzle, tables `trusted_folders` (6a) and `session_labels` (6d). Never the index DB.

## R7. Hardened git runner (6d)

- **Decision**: `packages/node/src/projects/git-write.ts`, the only code that runs git commands that write. It shares nothing with `createGit` (in particular it does not inherit `createGit`'s `core.sshCommand=false` or its credential and network blocks).
  - **Process**: `execFile('git', args, { shell: false, timeout: C9VIEW_CLONE_TIMEOUT_MIN })`; `clone --no-recurse-submodules --template= -- <url> <dir>` or `init --template= -- <dir>`; `--` always precedes the URL and the directory.
  - **Config**: `-c protocol.file.allow=never -c protocol.ext.allow=never -c core.hooksPath=/dev/null -c core.fsmonitor=false`.
  - **Environment**: built from scratch, never inherited wholesale: `PATH`, `HOME`, `LANG`, `SSH_AUTH_SOCK`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, plus `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https:ssh`, `GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'`, `GIT_CONFIG_NOSYSTEM=1`. No other `GIT_*` variable is passed.
  - **Credentials, chosen: whitelist, not a documented helper list.** `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` are what the common Linux helpers need (`libsecret`/GNOME Keyring and KWallet over D-Bus; `ssh-agent` and `gpg-agent` sockets under `XDG_RUNTIME_DIR` on systemd), and macOS `osxkeychain` and `git-credential-manager` need only `HOME`. With them the owner's own credential helper works as it does in the terminal, which is the point of "the owner's own credentials"; without them the most common helper silently fails. They grant no new access: they point at the same user's agent sockets the terminal uses. `BatchMode=yes` and `GIT_TERMINAL_PROMPT=0` make any helper or host-key prompt fail instead of hanging; an unknown SSH host fails with "add the host to known_hosts first". `docs/deploy.md` lists the helpers tested (osxkeychain, libsecret, `cache`, `store`, `gh auth setup-git`).
  - **URL check** (Zod, before anything runs), rejecting with 400 `bad-url`:
    - any whitespace or control character anywhere;
    - userinfo with a password (`https://user:password@host/…`): credentials come from the owner's credential helper or SSH agent, never from the URL, so nothing secret can reach `.git/config` or logs;
    - schemes other than `https://` and `ssh://` (so `file://`, `ext::`, `git://`, `http://`, `fd::` and local paths are out);
    - a host or user that starts with `-`, is empty, or has characters outside `[A-Za-z0-9._-]` (user) or a hostname or bracketed IPv6 (host);
    - scp-like `user@host:path` only when `user@` is present, the host passes the host rule, and there is no `/` before the `:`; anything git would treat as a local path (`./x:y`, `/x:y`, `x:y` without `user@`, a Windows drive) is refused.
- **Rationale**: owner's answer; constitution Principle I exception requires its own runner. The URL rules close the option-injection (`-oProxyCommand`) and local-path cases that `--` alone does not.

## R8. Workspace roots and locations

- **Decision**: `roots.ts`: roots must be absolute and existing; a location expands `~`, resolves the real path of its nearest existing parent, appends the missing segments (no `..`, no empty segments), and must be inside a root's real path (`path.relative` without `..`). Symlinks under the parent resolved, so an escaping symlink fails. Project ID computed with the rule the spike confirms (**spike**; today Claude Code replaces `/` and `.` with `-`).

## R9. Spike items (PR 6a, first tasks)

Resume file behaviour (append vs copy; follow `session_id` from init); whether SDK children write `sessions/<pid>.json` and the `entrypoint`; whether installed c9view hooks fire; what `bypassPermissions` needs (for example `allowDangerouslySkipPermissions`) and whether `AskUserQuestion` reaches `canUseTool` under bypass; whether `extraArgs.name` names the session and where it is stored, and whether rename is supported; project folder name rule. Answers go to `docs/data-sources.md`; a "no" changes only the feature it gates (rename stays out; questions under bypass are documented).

## R10. Events and refresh

- **Decision**: node emits `control.run`, `control.request`, `control.request.resolved`, `control.project` with IDs only ([contracts/control-events.md](contracts/control-events.md)); the web invalidates `['m', machineId, 'control', 'runs']` (001 query-key factory) on any of them and after every gap.

## R11. Child environment

- **Decision**: `env.ts` builds the child env from `process.env` minus an explicit strip list, not a `C9VIEW_*` prefix: `C9VIEW_TOKEN`, `C9VIEW_PASSWORD`, `C9VIEW_AUTH`, `C9VIEW_HUB_ACCESS_CLIENT_ID`, `C9VIEW_HUB_ACCESS_CLIENT_SECRET`, `C9VIEW_INSECURE_NO_AUTH`, `C9VIEW_CONTROL`, `C9VIEW_CONTROL_BYPASS`, `C9VIEW_ALLOWED_HOSTS`, `C9VIEW_TRUST_PROXY`, plus any key matching `/(TOKEN|SECRET|PASSWORD|KEY)$/` under the `C9VIEW_` prefix. `C9VIEW_STATE_DIR` is passed through (set to the resolved state folder even when it came from the default), so hooks fired inside the child write where c9view reads; `C9VIEW_LEGACY_STATE_DIR` is stripped. When c9view runs with a non-default `C9VIEW_CLAUDE_DIR`, the child gets `CLAUDE_CONFIG_DIR` set to that directory, so the session reads and writes the same Claude data c9view shows.
- **Rationale**: hooks run in the child's environment and today's hook command carries no environment for a default install (001 research R6); a prefix strip would cut the state folder off. Secrets stay out by name and by pattern.
