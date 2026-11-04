# Feature Specification: Components and Multiple Machines

**Feature Branch**: `docs/speckit-multi-machine`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Convert the earlier design draft `multi-machine.md` to a Spec Kit feature: split c9view into web UI, hub and node with no behaviour change (6.0a), make the API and web machine-scoped with refresh rules (6.0b), add response budgets (6.0c), then one hub dashboard for several machines: merged endpoints, a node connection with pairing, a node registry and a web UI for many machines (Step 7)."

Source: an earlier design draft, `multi-machine.md`, written before the project adopted Spec Kit. Requirement IDs keep the draft's numbers: **FR-0NN (was RNN)**. Implementation detail from the source (envelopes, frame list, byte budgets, file ownership per PR, data shapes) is in [design-notes.md](design-notes.md) for `/speckit-plan`.

## Context

c9view shows the Claude Code sessions of one machine. An owner who works on a laptop, a desktop and a remote server has to open one dashboard per machine and cannot see on one board which session anywhere needs them.

This feature has two phases:

1. **Components (6.0a–6.0c, before session control):** split c9view into three components with clear boundaries — the **web UI** (the browser app), the **hub** (everything that faces the browser) and the **node** (everything that touches Claude data, project folders and processes) — and make the API and web machine-aware with a single machine, `local`. Session control ([002-session-control](../002-session-control/spec.md)) is then written once, in its final place.
2. **Multiple machines (Step 7):** one hub dashboard for several machines, each running a node that connects out to the hub. One Overview, board and usage view across every machine; session pages, files and diffs of any machine read on demand; session control on any node that enables it.

It is for the single owner of all the machines. Claude Code always runs on the machine that holds the code and its Claude data; the hub only shows and relays. Two design reviews before any code moved machine identity, retry-safe commands, refresh rules and response budgets ahead of session control so that Step 7 only adds code.

In this spec, "Claude data" means the Claude data directory (`~/.claude` or `C9VIEW_CLAUDE_DIR`) **excluding** c9view's own state folder `~/.claude/c9view/` (FR-031).

## Clarifications

### Session 2026-11-04

- Q: How should remote nodes reach the hub — by dialling out to it, or by the hub calling each node? → A: Nodes dial out to the hub over one WebSocket each; the hub never calls a node.
- Q: How do the Host and Origin checks apply to the node connection path, which is not a browser and sends no Origin? → A: Check Host only on that path; the signed key challenge is the authentication. The constitution's Principle III matches.
- Q: Should the design notes' budgets and timeouts be accepted now or measured first? → A: Accept the design notes' values now, make every one configurable by environment, and re-measure them in 6.0c before Step 7.
- Q: Where does c9view keep the state it writes (node identity, node state store, hook events), and may the service install write outside the Claude data directory? → A: All c9view state lives in `~/.claude/c9view/` (`C9VIEW_STATE_DIR` defaults there): node identity, the node state store (trust, labels) and the hook events file, which moves from `${XDG_STATE_HOME:-~/.local/state}/c9view/`. The watcher, indexer, scanner and project discovery ignore that folder; Docker mounts it writable over the read-only Claude data mount; the folder stays 0700 and its files 0600 with the existing symlink and ownership checks; existing installs keep working through a migration chosen in the plan. Only the service file goes elsewhere, to the OS service folder, shown first and run by the owner like hooks install.
- Q: How is the node's private key stored? → A: A 0600 file in the 0700 node state folder, now `~/.claude/c9view/node/`; no OS keychain.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Nothing changes when c9view is split into components (Priority: P1)

The owner upgrades c9view and keeps running `c9view start` on one machine. Every page, URL, response and setting behaves exactly as before, even though internally the browser-facing part (hub) and the data part (node) are now separate components that talk only through one defined channel.

**Why this priority**: Every later story, and session control, builds on this split. It must land first and must not regress anything.

**Independent Test**: Run the existing test suite and an end-to-end comparison of every API response for the fixture data before and after the split.

**Acceptance Scenarios**:

1. **Given** the fixture Claude data, **When** the owner runs `c9view start` after the split, **Then** every existing API response, including health, is identical to before.
2. **Given** the split code, **When** a module of the browser-facing component tries to read Claude data directly, or the node tries to handle browser login, **Then** the boundary lint rules fail the build.
3. **Given** a request whose body exceeds the request limit, **When** it reaches the node channel, **Then** it is refused with "too large" and never reaches the node.
4. **Given** a node operation that exceeds its deadline, **When** the deadline passes, **Then** the hub answers "timed out" and the node's work is aborted.
5. **Given** the index finishes a batch, **When** it emits an event, **Then** the live-update stream in the browser receives it and node health reports the same index state the pages use.

---

### User Story 2 - Every page and link names its machine (Priority: P1)

The owner opens c9view and every URL, cached result and live update is tied to a machine (today only `local`). Old bookmarks still work by redirecting to the `local` machine. Live updates never leave stale or out-of-order data on screen.

**Why this priority**: Machine identity in every key is what lets Step 7 and session control add machines without rewrites; the refresh rules fix real stale-data bugs found in review.

**Independent Test**: With one machine, check machine-scoped URLs return the same data as the old ones, old URLs redirect, and the refresh rules hold under reconnects and overlapping events.

**Acceptance Scenarios**:

1. **Given** one machine `local`, **When** the owner requests a machine-scoped URL, **Then** it returns the same data as the unscoped URL; an unknown machine returns "not found".
2. **Given** a hub started without its own machine, **When** the owner requests an unscoped data URL, **Then** it returns "not found" rather than another machine's data.
3. **Given** an old bookmark, **When** the owner opens it, **Then** the browser lands on the same page under `/m/local/…`.
4. **Given** the live-update connection drops and reopens, **When** it reconnects, **Then** every open view of that machine refreshes, including files, git status and changes.
5. **Given** two refreshes of one session overlap, **When** both complete, **Then** the screen shows the newer data; an event arriving during a refresh causes exactly one more refresh.
6. **Given** a node sends its own machine identity in a payload, **When** the hub forwards it, **Then** the hub's identity for that machine replaces it.

---

### User Story 3 - Large sessions and files never stall the page (Priority: P2)

The owner opens a session with huge tool output, a very large file, or a large diff. The page loads in bounded pieces, shows a clear "partial content" notice with a way to load more, and never cuts content mid-structure.

**Why this priority**: Required before responses cross a network link between machines; also helps one machine today (Principle VI).

**Independent Test**: Load fixture sessions and files above the size limits and follow continuation links until all content has been read in order.

**Acceptance Scenarios**:

1. **Given** a session page whose content exceeds the page budget, **When** the owner opens it, **Then** the first page stops under the budget and offers a continuation; following continuations yields every message in order.
2. **Given** a file above the file ceiling, **When** the owner opens it, **Then** the viewer shows its metadata and a notice instead of the content.
3. **Given** one message larger than a page, **When** it is shown, **Then** it is truncated with a visible marker and its full content can be paged.

---

### User Story 4 - Pair a remote machine and see it on one board (Priority: P2)

The owner runs the hub on a home server or VPS, pairs a laptop and a desktop with a one-time code, and sees every machine's sessions on one Overview, board and usage view, each card marked with its machine. Opening a session, file or diff of any machine reads it live from that machine.

**Why this priority**: This is the main user value of Step 7.

**Independent Test**: In one process, run a hub and two nodes over a real loopback connection with two fixture data folders; pair both and check the merged views.

**Acceptance Scenarios**:

1. **Given** a running hub, **When** the owner creates a pairing code and enters it on a node within 10 minutes, **Then** the node is paired and appears on the Machines page; the same code cannot be used twice or after it expires.
2. **Given** two paired machines with a project of the same name, **When** the owner opens the Overview or board, **Then** the projects stay separate, each labelled with its machine.
3. **Given** one machine does not answer within the merge timeout, **When** the owner opens the Overview, **Then** it shows the other machines and names the missing one as partial.
4. **Given** a hub with a paired remote node, **When** the hub is started with no login, **Then** it refuses to start, even with the insecure no-auth override.
5. **Given** more than one machine, **When** the owner views the shell, **Then** a machine switcher and machine chips appear; with one machine they are hidden.

---

### User Story 5 - Offline, revoked and outdated machines are handled honestly (Priority: P2)

A laptop sleeps, a server restarts, or the owner revokes a lost machine. The board keeps the last known cards for an offline machine, greyed out with "offline · last seen …", and disables its detail pages and controls. A revoked machine is disconnected at once. A machine running an old c9view is refused or marked outdated with what to upgrade.

**Why this priority**: Without honest offline and revocation handling, a multi-machine board would mislead (Principle VII) or stay exposed (Principle III).

**Independent Test**: Drop, restart and revoke fixture nodes and check board state, detail pages, control refusal and version reporting.

**Acceptance Scenarios**:

1. **Given** a connected node, **When** its connection drops, **Then** its cards stay, marked offline with last-seen time in text, and its detail pages answer "unavailable: offline".
2. **Given** an offline node reconnects, **When** it does, **Then** a fresh snapshot is installed without losing an event sent during the install.
3. **Given** a paired node, **When** the owner revokes it, **Then** its open connection closes at once, its next connection fails, and the node logs that it must be paired again.
4. **Given** a node speaking an unsupported protocol version, **When** it connects, **Then** it is refused and logs the version to install; an old but supported node is shown as outdated with its versions.
5. **Given** a node restarts, **When** a command is retried across the restart, **Then** the owner sees "unknown outcome" instead of the command running twice.

---

### User Story 6 - Run each machine as a background service (Priority: P3)

The owner installs the node as a user service on Linux or macOS so it starts at login and reconnects to the hub on its own. The installer shows exactly what it will write before writing.

**Why this priority**: Convenience on top of a working multi-machine setup.

**Independent Test**: Run install, status and uninstall against a temporary home folder.

**Acceptance Scenarios**:

1. **Given** no service installed, **When** the owner runs install-service, **Then** it prints the file and its contents and writes nothing without confirmation.
2. **Given** an installed service, **When** the owner runs uninstall-service, **Then** only the file it wrote is removed.
3. **Given** an installed service, **When** the owner runs service status, **Then** it reports installed, running and connected to the hub.

---

### User Story 7 - c9view keeps everything it writes in one folder (Priority: P1)

The owner finds every file c9view itself writes — hook events, the node's identity, the node's state store — in one place, `~/.claude/c9view/`, next to the Claude data it describes. Nothing in that folder shows up on the dashboard as Claude data, and an install from before the move keeps working.

**Why this priority**: The node identity (Step 7) and the node state store (002) are written there, so the folder and its rules must exist first. It also replaces the hook events default.

**Independent Test**: With a temporary home, write hook events, a fake identity and a fake state store; check paths, modes, refusal of symlinks, that no reader lists the folder, and that events at the old default path still appear.

**Acceptance Scenarios**:

1. **Given** no `C9VIEW_STATE_DIR`, **When** a hook fires, **Then** its event is appended under `~/.claude/c9view/` with folder mode 0700 and file mode 0600.
2. **Given** files under `~/.claude/c9view/`, **When** the watcher, indexer, scanner, config pages and project discovery run, **Then** none of those files appear.
3. **Given** an existing install whose hook events are at the old default path, **When** the owner upgrades, **Then** the dashboard still shows those events and nothing moves or deletes the old file.
4. **Given** the state folder is a symlink or owned by another user, **When** c9view would write there, **Then** it refuses and writes nothing.
5. **Given** Docker with the default compose file, **When** the container starts, **Then** the state folder is writable and every other Claude data mount is read-only.

---

### Edge Cases

- Two machines have projects with the same ID (IDs come from folder paths): the pair (machine, project) is the key everywhere.
- A second connection for the same machine replaces the first.
- A connection claims another machine's identity in its greeting: the identity from the verified key wins.
- The browser is slow: it is disconnected rather than stalling the node.
- More open requests than the per-node cap: the hub answers "unavailable" for the extra ones.
- The hub gives up waiting (deadline): "timed out" means the hub stopped waiting, not that the operation was cancelled; commands recover through receipts (002 FR-021).
- A node is behind Cloudflare Access: the node sends a service token; a failed upgrade names the likely cause (no route, TLS, Access login page, refused pairing).
- The node's identity folder or key has wider permissions than allowed: the node refuses to start and names the `chmod` to run.
- A container sets the in-container marker: the node refuses control and bypass and points to a native install.
- The hub runs without its own machine: it creates no index, hooks reader or watcher and never reads Claude data.
- A file appears under `~/.claude/c9view/` (identity, state store, hook events): no page, search, project list or index ever shows it.
- An install from before the state-folder move still has hook events at the old path: the dashboard keeps showing them.
- The state folder is a symlink or owned by someone else: c9view refuses to use it.
- A node connection arrives with a foreign or missing Origin: accepted if Host is allowed and the key challenge passes; any other hub path with that Origin is refused.
- A node snapshot is invalidated while being built: it is rebuilt before being returned as current.

## Requirements _(mandatory)_

### Functional Requirements

**Components**

- **FR-001 (was R1)** Boundaries: only the node reads Claude data or project folders, runs git, or starts processes. Only the hub accepts browser connections, checks login, Host and Origin, and serves the web UI. The web UI talks only to the hub, from the same origin. A hub run without its own machine creates no index, hooks reader or watcher and never reads Claude data.
- **FR-002 (was R2)** One node channel: the hub reaches nodes only through one defined channel with explicit request and response envelopes. No browser header (cookie, Origin, Host, Authorization) reaches a node. Request bodies, response chunks and request durations are bounded (the design notes' values, each configurable by environment; see notes); a deadline answers "timed out" and aborts the node's work. Every channel implementation enforces the same limits and passes the same contract tests.
- **FR-003 (was R3)** Ways to run: `c9view start` runs the hub with one in-process node `local`, with today's flags, defaults and behaviour apart from FR-006's new URLs. `c9view hub` runs the hub and, by default, its own machine as `local` (an option turns that off). `c9view node --hub <url>` runs a node with no listening port; an optional local listener for when the hub is down follows every existing listener rule.
- **FR-004 (was R4)** One node runtime: each node creates its store, live-event hub, hook events, index and watcher once, and every part of the node uses that one runtime. Node health (index progress, hooks installation and files) is computed on the node; the hub never computes it.
- **FR-005 (was R5)** Machine identity: only the hub assigns a machine's identity, from the channel a response or event came through; node payloads omit it and the hub overwrites any identity a node sends. The hub adds it only in defined envelopes, never by rewriting nested data. The browser keys everything machine-scoped by machine: URLs, cached queries, runs, requests and receipts.
- **FR-006 (was R6)** Machine-scoped API: machine-scoped paths are relayed to that machine; an unknown machine answers "not found", an offline one "unavailable: offline". Unscoped data paths are an alias for `local` only, never "the first connected machine", and answer "not found" when the hub has no own machine. Hub-owned paths (health, machines, events, node connection, login, logout, pairing) match before the alias. Guards and login apply through the alias exactly as through the scoped path. The machines list gives each machine's name, connection state, last seen, version, boot identity and capabilities (each capability with a state `off`/`ready`/`unavailable` and a reason, refreshed on every greeting and reconnect); the node rechecks its own flags on every call, so a stale capability in the browser authorizes nothing. Hub health describes the hub only; node health is per machine.
- **FR-007 (was R7)** Refresh rules: events are hints; no handler applies event content to the cache, each one only triggers a refetch, and reads are the source of truth. After any gap (the browser's live connection reopens, or the hub announces a machine reconnect) the web refetches every active query of that machine, including files, git status and changes. At most one refresh runs per query; an event during a refresh sets a dirty flag and causes exactly one more refresh; a newer response is never discarded for an older one. A node snapshot invalidated while being built is rebuilt before being returned. The hub reads online nodes live and keeps the last snapshot only for offline machines; on connect it subscribes to events first, then reads the snapshot, then refreshes if an event arrived in between. Snapshots are transferred in pieces.
- **FR-008 (was R8)** Response budgets, measured after secret hiding and encoding: session pages, search results, directory listings, git status and changes, and diffs stop before a per-page budget and return a continuation; output is never cut mid-structure. A file above the file ceiling returns metadata and an explicit notice. A single item larger than a page is truncated with a marker and its full content is pageable. The web follows continuations in order and shows a partial-content notice with a way to continue. (Budget values in notes; each is configurable by environment and re-measured on real sessions in 6.0c before Step 7.)
- **FR-009 (was R9)** The component split (6.0a) changes no behaviour: every existing test passes after moving with its code, and every existing API response is unchanged.

**Pairing and identity**

- **FR-010 (was R10)** The hub requires login whenever it has a paired remote node or a node with control. Auth mode `none` refuses to start then, and the insecure no-auth override does not override it. The same holds at runtime: while auth mode is `none`, the hub refuses to create pairing codes ("enable login first") and rejects every pairing and connection attempt from a node; and a node with control refuses to run against a hub that reports it has no login.
- **FR-011 (was R11)** Pairing: the owner creates a one-time pairing code on the hub (command or Machines page) valid for 10 minutes. Pairing a node with the code gives it its own key pair (the private key never leaves the node) and a random machine identity assigned by the hub. The node keeps its identity, key and hub address in its node state folder `~/.claude/c9view/node/` (FR-031), as a 0600 file in a 0700 folder; no OS keychain. The hub stores only the machine's public key, name and pairing time.
- **FR-012 (was R12)** Connecting: nodes connect over an encrypted channel; an unencrypted one is allowed only to a loopback hub. The hub challenges and the node proves possession of its key; an unknown key, a revoked machine or a bad proof closes the connection with no detail. A second connection for the same machine replaces the first. Before a node is authenticated, the hub limits it: the handshake must finish within 10 seconds, the number of unauthenticated connections is capped, and repeated failed pairing or connection attempts from one address are slowed down and then refused as "too many", like failed logins.
- **FR-013 (was R13)** Revoking: the owner revokes a machine (command or Machines page); its key is deleted and its connection closed at once. Its next connection fails, and the node logs "This machine was removed from the hub; pair it again."

**Protocol**

- **FR-014 (was R14)** Hub–node messages are validated on both ends; unknown message types are ignored; message size is bounded. The node greets with its name, version, protocol version, boot identity and capabilities; the hub refuses an unsupported protocol (the node logs the version to install) and takes the machine identity from the verified key, never from the greeting. After every connect the node sends a snapshot (projects, session summaries with status, control runs) in pieces. The node sends event hints; the hub sends requests with per-connection IDs and cancellations; responses stream back in bounded chunks; a heartbeat closes a silent connection. (Message list in notes.)
- **FR-015 (was R15)** The node answers relayed requests only for an allowlist: every read route of the node, and the control routes only when its control flag is on; anything else answers "not found". The hub forwards a request only to the node named in its path.
- **FR-016 (was R16)** Limits: open requests per node are capped (extra ones answer "unavailable" on the hub); each connection has bounded queues; a slow browser is disconnected rather than allowed to stall a node; a node that misses three heartbeats, or sends a message above the size limit, is disconnected; unauthenticated connections are capped and time-limited (FR-012).

**Hub behaviour**

- **FR-017 (was R17)** Merged views: the unscoped Overview, projects and usage merge every machine's answer; each item carries its machine. A machine that does not answer within 5 seconds is left out and named as partial. Search stays per machine in v1.
- **FR-018 (was R18)** Live events: the hub's event stream merges every node's hints, each wrapped with its machine, and adds machine events when a node connects (with its boot identity) or drops. The hub owns stream framing, heartbeats and slow-client handling; a node never waits on a browser.
- **FR-019 (was R19)** Offline machines: after a connection closes the hub keeps the last snapshot in memory and marks the machine offline. The board shows its cards greyed out with "offline · last seen <time>" in text; detail pages and controls for it are disabled with the same text. Nothing about it is persisted on the hub except its last-seen time.
- **FR-020 (was R20)** Nothing from a node's data is written to disk on the hub: no transcripts, file contents or summaries. The hub stores only machines (identity, name, public key, paired and last-seen times) and pairing codes. The local node's index belongs to the node.

**Control through the hub**

- **FR-021 (was R21)** The browser-facing control guard (Origin, control header, JSON, login) runs only on the hub. The node treats its channel as its caller and still applies every other control rule (IDs from its own store, no paths from the request, node-held tool input, answer checks, run caps, receipts).
- **FR-022 (was R22)** Each node's own flags decide whether control and bypass are on (002 FR-001, FR-025); they are reported in the greeting and no hub message can change them. The hub shows "Control off" or a "Bypass" badge per machine.
- **FR-023 (was R23)** Pending requests on a node that goes offline stay on the node and time out there as usual. The hub shows them as unreachable and refuses decisions as "unavailable". The node never retries; the browser recovers through receipts once the node is back, or sees "unknown outcome" if the node restarted.

**Security**

- **FR-024 (was R24)** Accepted risk: a compromised hub can read every node's data and, on nodes with control on, run Claude there. The spec accepts this for a single owner and limits it: control and bypass are per node and off by default; each node has its own revocable key; nodes open no listening port and their identity comes from their verified key; prompts, tool input and answers are never logged on hub or node, and errors pass through secret hiding.
- **FR-030 (new, from the constitution check)** The node connection path is served on the hub's normal listener and checked for Host like every other request, but not for Origin: nodes are not browsers. The signed key challenge (FR-012) is its authentication; browser login and cookies don't apply to it. Every other hub path keeps the Host and Origin checks (constitution Principle III).
- **FR-031 (new, from clarification)** c9view's own state folder: everything c9view itself writes on a machine lives under `~/.claude/c9view/` (`C9VIEW_STATE_DIR` overrides it): the node identity (`node/`), the node state store (trust and labels, 002), the hub's machines store when the hub runs natively, and the hook events file, whose default moves there from `${XDG_STATE_HOME:-~/.local/state}/c9view/`. The index stays a rebuildable cache outside the Claude data directory, as today.
  - The watcher, indexer, scanner, config readers and project discovery ignore `~/.claude/c9view/`, and also the configured state folder when it sits inside the Claude data directory under another name; nothing in it ever shows as Claude data.
  - Hooks run in Claude Code's environment, not c9view's, so `hooks install` writes a non-default state folder into the installed hook command itself.
  - The folder and every subfolder are 0700 and every file 0600; symlinked or foreign-owned folders and symlinked files are refused, as the hook events writer does today.
  - Existing installs keep receiving and showing hook events after the default moves: c9view also reads the old hook events file, read-only, from its default path or from an explicitly configured legacy folder (`C9VIEW_LEGACY_STATE_DIR`, used by Docker); it never moves or deletes the old file.
  - In Docker the state folder is mounted writable over the read-only Claude data mount; a hub-only container sets the state folder to its own volume.

**Deployment**

- **FR-025 (was R25)** Reaching the hub: nodes connect to one hub path on the hub's normal listener, with no extra port. The node optionally sends a Cloudflare Access service token on its connection; the token values are never logged and are stored only in the service environment, never in the identity file. A failed connection names the likely cause (no route, TLS, Access login page, refused pairing).
- **FR-026 (was R26)** Node as a user service: `c9view node install-service` writes a user service definition (systemd user unit on Linux, launchd agent on macOS) that runs the node at login and restarts it on failure. It prints the exact file and contents first and writes only after confirmation or `--yes`. The service file is the only thing c9view writes outside its state folder apart from hooks install (constitution Principle I). The service carries the hub address and node flags (control, bypass) as given at install; changing a flag means reinstalling. `uninstall-service` removes only the file it wrote; `service status` reports installed, running and connected. Logs go to the platform's user log, with secret hiding.
- **FR-027 (was R27)** Containers: the image's default command runs the hub without its own machine (from 7b); `c9view start` in the image stays read-only. The image marks itself as a container, and with that marker the node refuses control and bypass with a message pointing to the native install. The compose file has a hub profile with only the hub's state volume and no Claude data or workspace mounts. For `c9view start` in the image, the c9view state folder is mounted writable over the read-only Claude data mount (FR-031); every other Claude data mount stays read-only.
- **FR-028 (was R28)** Versions: the greeting and machines list carry each node's c9view version, protocol version and Claude Code version (from the binary the node runs, 002 open question 2). The hub refuses an unsupported protocol and marks an old but supported node as outdated; the Machines page says what to upgrade on which machine.
- **FR-029 (was R29)** Node state: the node's state folder `~/.claude/c9view/node/` (holding the identity key) keeps mode 0700, and the key 0600; the node refuses to start if they are wider and names the `chmod` to run. Upgrading c9view never moves or rewrites it; the deploy docs say to back it up, and losing it means pairing again.

### Key Entities _(include if feature involves data)_

- **Machine**: a computer running a c9view node. Identity assigned by the hub (`local` for the hub's own in-process node, a random identity for paired nodes); name; connection state (online, offline); last seen; versions; boot identity; capabilities (control state and reason, bypass).
- **Node greeting**: what a node announces on connect — name, versions, protocol, boot identity, capabilities. Never carries the machine identity.
- **Node snapshot**: a node's projects, session summaries with status, and control runs; held in memory on the hub only to show offline machines.
- **Machine event**: a node's event hint wrapped with its machine by the hub; plus connect and drop events.
- **Pairing code**: one-time, 10-minute code stored only as a hash on the hub.
- **Node identity**: the node's machine identity, hub address and private key, in `~/.claude/c9view/node/` (0700 folder, 0600 file).
- **c9view state folder**: `~/.claude/c9view/` (or `C9VIEW_STATE_DIR`): node identity, node state store, native hub store, hook events. Ignored by every Claude data reader.
- **Continuation cursor**: opaque, issued by a node, valid only on that machine.
- **Project key**: project IDs come from folder paths and collide across machines; the pair (machine, project) is the key on the hub and in the web.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After the component split, 100% of existing tests pass and 100% of existing API responses for the fixture data are unchanged.
- **SC-002**: With two machines whose projects share an ID, 0 items are mixed between machines on the merged Overview and board.
- **SC-003**: When one of several machines is unreachable, the Overview still appears within about 5 seconds and names the missing machine.
- **SC-004**: After any reconnect, every open view of the affected machine shows current data with no manual reload, and no screen ever shows older data after newer data.
- **SC-005**: No session page, listing or diff response exceeds its page budget; reading a session through continuations returns 100% of its messages in order.
- **SC-006**: The owner can pair a new machine in under 2 minutes using one code, and a revoked machine loses access immediately.
- **SC-007**: After running the full test suite, the hub's stored state contains only the machines and pairing-code records; no transcript, file content or summary is stored on the hub.
- **SC-008**: An offline machine is identifiable on every view by text (not colour alone), and every control for it is disabled.
- **SC-009**: 100% of files c9view itself writes on a machine (other than an installed service file and Claude settings written by hooks install) are inside its state folder, and 0 of them appear anywhere on the dashboard.

## Assumptions

- Single owner of all machines; no multi-user access (non-goal).
- Transport: nodes dial out to the hub over one WebSocket each ([design-notes.md](design-notes.md) open question 1; confirmed 2026-11-04). Calling nodes over Tailscale was rejected: every node would need a listening port and sleeping or NAT'd laptops drop out.
- The hub serves its own machine as `local` by default, with an option to turn it off (open question 2, proposed).
- Search is per machine in v1 (open question 3, proposed).
- Merged-view timeout is 5 seconds per node, then partial (open question 4, proposed; may need tuning for slow servers).
- Node identity is a 0600 file in `~/.claude/c9view/node/`; OS keychain was not chosen because it adds a native dependency (open question 5; confirmed 2026-11-04 with the new folder).
- A node may also listen locally for when the hub is down, with all usual login rules (open question 6, proposed).
- The server app is renamed to say it is the hub, in the split PR (open question 7, proposed).
- Budget values are the design notes', configurable by environment, and re-measured on real sessions in 6.0c before Step 7 (open question 8; confirmed 2026-11-04).
- `install-service` writing to the OS service folder is allowed because the owner runs it explicitly and sees the file first, like `hooks install`; the constitution and `AGENTS.md` list it next to the hooks exception (open question 9, replaced by the 2026-11-04 answer: all other c9view state goes to `~/.claude/c9view/`).
- Windows is supported through WSL only in v1 (open question 10, proposed).
- Docker suits the hub but not a node with control: Claude runs its tools where the node runs, so a node with control is a native install (see notes, Deployment).
- Rejected: syncing Claude data to one box; hub calling nodes; a separate web UI server (breaks the same-origin cookie and the missing-Origin refusal the control guard relies on); event IDs and replay (events are only hints).
- Non-goals: separate web UI server or CDN UI; event replay; optimistic approval cards in events; a separate smaller node package; multiple owners; cross-machine search; moving sessions between machines; caching transcripts on the hub; a hosted hub; Docker for nodes with control; a devcontainer node (design separately); a native Windows node.
- Dependency: session control (002) depends on 6.0a and 6.0b; 6.0c may run in parallel with 002's first PR and merges before its second. Step 7 starts after 002's first PR.
