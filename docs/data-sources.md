# Data sources

Where c9view reads Claude Code data and project files, checked on a real machine on 2026-10-24 (Claude Code 2.1.x). The format isn't documented and can change between versions. Claude data is rooted at `~/.claude` or `C9VIEW_CLAUDE_DIR`; c9view also reads project folders discovered from transcript `cwd` values and `C9VIEW_WORKSPACE_ROOTS`, checks whether each session's process is still running, and uses a bundled LiteLLM price table; the core loader can merge an override file when its caller supplies a path. It reads `.claude.json` next to the Claude data directory (normally `~/.claude.json`), read-only for MCP configuration. Its own writes are the SQLite index (`C9VIEW_DB`), hook events (`C9VIEW_STATE_DIR`), and Claude `settings.json` only through `c9view hooks install/uninstall`.

## Files

| Data                 | Location                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects             | `~/.claude/projects/<folder-path-with-dashes>/` (e.g. `/home/me/repo` → `-home-me-repo`)                                                             |
| Sessions             | `<project>/<sessionId>.jsonl`, plus `<sessionId>/subagents/` and `tool-results/`                                                                     |
| Project memory       | `<project>/memory/` (`MEMORY.md` index + one file per memory)                                                                                        |
| **Live status**      | `~/.claude/sessions/<pid>.json`                                                                                                                      |
| Global settings      | `~/.claude/settings.json`, `settings.local.json` (hooks, permissions, plugins, model, env)                                                           |
| Usage stats          | `~/.claude/stats-cache.json`                                                                                                                         |
| Prompt history       | `~/.claude/history.jsonl`                                                                                                                            |
| Global instructions  | `~/.claude/CLAUDE.md` (may `@include` other files)                                                                                                   |
| Skills, agents       | `~/.claude/skills/`, `~/.claude/agents/` (skills may be symlinks)                                                                                    |
| Plugins              | `~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`                                                                                |
| Project-level config | `<repo>/.claude/settings*.json`, `<repo>/CLAUDE.md`, `<repo>/.mcp.json`, `<repo>/.claude/skills`, `<repo>/.claude/agents`, `<repo>/.claude/commands` |

## Transcript records (`<sessionId>.jsonl`)

One JSON object per line. Record types seen: `user`, `assistant`, `attachment`, `ai-title`, `last-prompt`, `mode`, `permission-mode`, `file-history-snapshot`, `bridge-session`, `api-request`, `api-request-blob`, `api-request-shape`, `atis-latch`.

Records link to each other through `uuid` / `parentUuid`; `isSidechain` marks subagent records.

`assistant` records carry `message.usage`:

```json
{
  "input_tokens": 2,
  "cache_creation_input_tokens": 18260,
  "cache_read_input_tokens": 25502,
  "output_tokens": 358,
  "output_tokens_details": { "thinking_tokens": 185 },
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "cache_creation": {
    "ephemeral_1h_input_tokens": 18260,
    "ephemeral_5m_input_tokens": 0
  },
  "service_tier": "standard",
  "speed": "standard"
}
```

## Live status file (`sessions/<pid>.json`)

```json
{
  "pid": 171045,
  "sessionId": "88043907-…",
  "cwd": "/home/me/repo",
  "kind": "interactive",
  "entrypoint": "cli",
  "version": "2.1.310",
  "name": "repo-fb",
  "status": "idle",
  "updatedAt": 1792836278902,
  "statusUpdatedAt": 1792836278902,
  "pidDomain": "linux:…:pid:[4026531836]",
  "tmux": "0:@3.%7"
}
```

`status` seen as `busy` and `idle`. `pidDomain` tells whether the PID belongs to the same PID namespace (matters inside Docker).

## `stats-cache.json`

Top-level keys: `dailyActivity`, `dailyModelTokens`, `firstSessionDate`, `hourCounts`, `lastComputedDate`, `longestSession`, `modelUsage`, `totalMessages`, `totalSessions`, `version`.

`modelUsage.<model>` has `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`, `costUSD` (was `0` on a subscription plan, so cost must be computed separately).

## File changes

**`toolUseResult` on the `user` record that carries an Edit or Write result:**

```json
{
  "type": "update",
  "filePath": "/path/to/file.ts",
  "originalFile": "…full file before the edit…",
  "structuredPatch": [
    {
      "oldStart": 10,
      "oldLines": 3,
      "newStart": 10,
      "newLines": 4,
      "lines": [" ctx", "-old", "+new", "+added"]
    }
  ],
  "userModified": false,
  "content": "…"
}
```

`type` is `create` or `update`. For other tools, `toolUseResult` may be a plain string.

**`~/.claude/file-history/<sessionId>/<hash>@v<N>`:** versioned backups of each file Claude touched in that session. `file-history-snapshot` records in the transcript map paths to backups:

```json
{
  "type": "file-history-snapshot",
  "messageId": "…",
  "isSnapshotUpdate": false,
  "snapshot": {
    "messageId": "…",
    "timestamp": "…",
    "trackedFileBackups": {
      "/path/to/file.ts": {
        "backupFileName": "<hash>@v3",
        "version": 3,
        "backupTime": "…",
        "realParentDir": "…"
      }
    }
  }
}
```

`file-history-delta` records carry `backup`, `messageId`, `snapshotMessageId`, `timestamp` and `trackingPath`.

Both `originalFile` and the backups hold whole files, so they need the same secret hiding and file-read rules as everything else.

## Hooks

Checked the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) on 2026-10-25. Common stdin fields include `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `permission_mode`, and optional `agent_id`/`agent_type`.

| Event installed      | Additional input fields                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `SessionStart`       | `source`, `model`                                                                               |
| `UserPromptSubmit`   | `prompt`                                                                                        |
| `PreToolUse`         | `tool_name`, `tool_input`, `tool_use_id`                                                        |
| `PostToolUse`        | `tool_name`, `tool_input`, `tool_response`, `tool_use_id`                                       |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `error`, `is_interrupt`, `tool_use_id`                               |
| `PermissionRequest`  | `tool_name`, `tool_input`, `permission_suggestions`                                             |
| `Notification`       | `notification_type`, `message`, optional `title`                                                |
| `Stop`               | `stop_hook_active`, `last_assistant_message`                                                    |
| `SubagentStart`      | `agent_id`, `agent_type`                                                                        |
| `PostToolBatch`      | `tool_calls` (discarded)                                                                        |
| `PermissionDenied`   | `tool_name`, `tool_use_id`, `reason` (payloads discarded)                                       |
| `StopFailure`        | API error metadata (discarded)                                                                  |
| `SubagentStop`       | `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `last_assistant_message` |
| `PreCompact`         | `trigger`, `custom_instructions`                                                                |
| `SessionEnd`         | `reason`                                                                                        |

`permission_prompt` means approval is needed; `idle_prompt` means waiting for input. Other current events exist; the table lists those c9view installs.

Installed hooks run the dependency-free `core/dist/hooks/hook-entry.js` directly with `--c9view-hook`, `async: true` and a five-second timeout; `c9view hook` calls the same function. Installs replace earlier marked CLI commands. Hooks silently append metadata-only v1 JSONL to `C9VIEW_STATE_DIR/events.jsonl`, defaulting to `~/.claude/c9view/events.jsonl`. Records contain `ts`, `event`, `sessionId`, `cwd`, and optional tool, notification type, permission mode, agent and parent PID metadata. Prompts, tool payloads, notification text and transcript content are discarded. The directory/file are created with modes 0700/0600. Symlinked or foreign-owned state directories and symlinked event files are skipped; owned directories are tightened to 0700. Appends use `O_NOFOLLOW`; rotation refuses symlinks. Concurrent rotations may lose one rotation of best-effort telemetry. Above 20 MB, rotation retains `events.1.jsonl`. In Docker, mount this state directory writable at `/data/claude/c9view` over the read-only Claude directory. All Claude data readers ignore `c9view/` and the configured state folder when it resolves inside the Claude directory, including aliases.

The node tails active and rotated files incrementally in both the new state folder and the legacy folder, merged by timestamp. The legacy folder is `C9VIEW_LEGACY_STATE_DIR` when set; otherwise it is `${XDG_STATE_HOME:-~/.local/state}/c9view` only when `C9VIEW_STATE_DIR` is unset. Legacy files are read-only: never written, moved or deleted. This compatibility read will be removed in a later release; remove the Docker legacy mount and `C9VIEW_LEGACY_STATE_DIR` together when old events no longer matter. The node polls each second, retains 200 events per session (at most 2,000 sessions), and falls back to live/transcript signals when events are absent. Hook history is bounded and held in memory. `hooks status` reports installation, the new and legacy event paths and sizes, latest merged event and last-hour event count. Node health keeps `eventsFile` and adds nullable `legacyEventsFile`. `hooks install/uninstall` are the only commands permitted to write Claude settings: they preview a diff, require confirmation or `--yes`, preserve unrelated hooks, and back up settings before atomic replacement. They must be run explicitly by the user.

Agent IDs are retained as metadata, without inferring subagent scope: the common agent fields can describe a session agent too. Only `SubagentStart`/`SubagentStop` prove lifecycle scope here; they keep a live parent in progress. `PostToolBatch` also means in progress; `PermissionDenied`/`StopFailure` end a turn in review. See the linked current hooks reference, especially common input fields and subagent events.

Fresh hook/live disagreement lowers confidence from high to medium and appears in evidence. Stale means deciding active/waiting evidence is older than ten minutes, or a recent active hook has no live process (30-second grace window); disagreement alone is normal hook lead time.

## How c9view counts tokens and cost

- **Within one transcript file**, Claude Code writes one `assistant` record per content block, repeating the same `message.id` and `usage`. Usage is deduplicated by `message.id`, keeping the latest record that has usage.
- **Subagents** (`<sessionId>/subagents/*.jsonl`) are real API calls. Their usage and cost roll up into the parent session, which also reports `ownTokens`, `ownCostUsd` and `subagentCostUsd`. Project and overview totals are the sum of the top-level session cards, so a project header always equals the sum of its cards.
- **Resumed or forked sessions** keep a copy of earlier history in their own file. Each file is counted on its own, so every card is independently additive, but a project total can count resumed history more than once. This differs from core's project-wide `usage_daily` deduplication, which the server totals no longer use.
- **Cost** is API-equivalent: list prices from the bundled table (see `packages/core/src/pricing/`), not what you were billed. On a subscription plan the real cost differs.
- The file-backed path (while the index builds) and the index-backed path produce the same numbers.
