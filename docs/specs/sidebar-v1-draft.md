---
date: 2026-05-14
topic: sidebar-v1-spec
status: ready-for-decomposition
derived_from: docs/ideation/2026-05-13-sidebar-ideation.md
glossary: CONTEXT.md
---

# Sidebar V1 Specification

This document captures the design of sidebar V1 as resolved by grilling the original ideation. All decisions (Q1 through Q17) are settled. The glossary in `CONTEXT.md` is the source of truth for terminology. The next step is tracer-bullet decomposition via the `to-issues` skill.

## Summary

Sidebar is a local-first markdown reading and co-authoring surface for a project's documentation. It exposes a local web-served editor UI and a local MCP server in the same Node process. The user runs `npx sidebar init` once per project, which writes a project-local `.mcp.json` pointing the agent's MCP client at `npx sidebar --stdio`. From then on, starting the agent in the project (e.g. `claude`) automatically spawns sidebar as a stdio subprocess and opens its browser UI. The agent is connected on first boot, no copy-paste, no restart loop. Sidebar can also be launched standalone via `npx sidebar` for read-only or no-agent use; the standalone mode runs over HTTP and additional agents can attach via the printed URL. See [ADR-0007](../adr/0007-stdio-first-invite-with-http-standalone.md) for the transport rationale.

The agent's lifecycle is owned by the user, not sidebar. The agent runs in the user's terminal. Sidebar provides the human-facing visual surface (editor, file tree, diffs, mention queue, status drawer) and the MCP tools the agent uses to read, observe, and act on the workspace within a permission boundary defined by mentions and annotations.

## Decisions Resolved

| # | Decision | Reference |
|---|----------|-----------|
| Q1 | Agent runs in user's terminal, not embedded in sidebar | [ADR-0001](../adr/0001-agent-runs-in-user-terminal-not-embedded.md) |
| Q2 | Agent connection is optional; sidebar runs without one | This document |
| Q3 | Annotated middle permission model: agent leaves notes anywhere, but only edits prose via a mention | This document |
| Q4 | Mention markers disappear on resolution; response replaces inline or becomes an annotation by verb | [ADR-0002](../adr/0002-mention-marker-disappears-on-resolution.md) |
| Q5 | Hybrid verb policy: built-in verb set with target-mode mappings, extensible via config, unknown verbs default to annotation mode | This document |
| Q6 | User edits during open mentions do not cancel them; agent works on latest content; optimistic concurrency on resolve via `base_hash` | This document |
| Q7 | Agent can suggest prose edits via `type=suggestion` annotations with human accept/reject | This document |
| Q8 | One workspace per sidebar instance | This document |
| Q9 | Default scope is `docs/**/*.md` strict; prompt on missing `docs/` | This document |
| Q10 | Marker shape is HTML comment begin/end pair with explicit sidebar-generated id | [ADR-0003](../adr/0003-marker-shape-begin-end-pair-with-id.md) |
| Q11 | MCP tool surface settled (full list below) | This document |
| Q11+ | Agent can create mentions with a constrained agent-verb set; rate-limited; counter exposed | [ADR-0004](../adr/0004-agent-can-create-mentions-with-constrained-verbs.md) |
| Q12 | V1 editor capabilities settled (full list below); CodeMirror 6 foundation; manual save with dirty-buffer MCP signal | [ADR-0005](../adr/0005-manual-save-with-dirty-buffer-mcp-signal.md) |
| Q13 | `.sidebar/` config shape: two files (`config.json` committed, `local.json` gitignored), lazy creation on first persistent write, no global config, strict validation | This document |
| Q14 | Agent identity from MCP `clientInfo.name` with collision suffix; human author from git user.name with fallback chain; multi-agent permitted in V1 with minimal UX | [ADR-0006](../adr/0006-multi-agent-permitted-in-v1.md) |
| Q15 | Operational failure modes: disconnect releases claims after 30s grace, no soft-delete, tolerant marker parse with red gutter, port collision refuses to start, MCP crash kills process, editor auto-reconnects | This document |
| Q15.5 | Invite and transport: stdio-first via `init`-written project `.mcp.json`, HTTP standalone preserved, `.mcp.json` committed by default | [ADR-0007](../adr/0007-stdio-first-invite-with-http-standalone.md) |
| Q16 | Form factor: linear port fallback 5180-5189, default-browser auto-open with `"none"` override, no self-update in V1, Node 20+, no daemon, stderr logs, no telemetry | This document |
| Q17 | Two-tier co-author skill: MCP server description floor plus `scaffold-skill` file ceiling; default target `.claude/skills/sidebar-collaboration/SKILL.md`; idempotent overwrite | This document |

## Architecture

Sidebar is one Node.js process that hosts:

- A web-served editor UI (HTTP plus WebSocket on a local port, opened in the user's default browser on startup)
- A local MCP server, exposed over both stdio (for the agent-spawned common case) and HTTP (for standalone use and additional agent connections), built on the official `@modelcontextprotocol/sdk` package
- A file watcher for the workspace glob
- An in-memory state layer for transient runtime state (in-progress mentions, dirty buffers, recent change events, agent-mention rate-limit counter, set of connected agents)

Persistent shared state lives in the markdown files themselves; sidebar's process memory is for transient state only. The `.sidebar/` directory at the project root holds configuration (see Configuration).

### Invocation modes

| Command | Role |
|---------|------|
| `npx sidebar init [agent]` | One-time per project. Writes a project-local `.mcp.json` with an entry that spawns `npx sidebar --stdio`. With no arg, detects installed MCP-speaking agents and offers to wire up all of them; with an explicit agent (`init claude-code`), writes just that one. Merges with any existing `.mcp.json` rather than overwriting unrelated entries. Idempotent: re-running updates the existing sidebar entry rather than duplicating. Committed to git by default. V1 supports Claude Code and Compound's shared `.mcp.json` layout; Cursor, Codex, and Aider variants land in V1.1. |
| `npx sidebar` | Standalone HTTP mode. Starts the HTTP server, file watcher, editor; opens the browser. No agent required (Q2). Prints the HTTP MCP URL for any agent that wants to attach. |
| `npx sidebar --stdio` | Not user-facing. Invoked by an agent's MCP client (via the `.mcp.json` entry written by `init`). On first invocation per project, becomes the primary instance (same components as standalone mode, plus stdio transport for the spawning agent). On subsequent invocations while a primary is already running for the project, acts as a thin proxy: forwards stdio traffic to the primary's HTTP endpoint and does not start a second editor, file watcher, or browser tab. |

The primary instance writes `.sidebar/connection.json` (gitignored, contains the HTTP URL and PID) on boot and removes it on shutdown. Subsequent `--stdio` invocations consult this file to decide whether to become primary or proxy. Standalone `npx sidebar` refuses to start if a primary is already live for the project and prints a clear error.

## Data Model

### Mention

A marker placed in a markdown file inviting the other party to act on or respond about a specific region. Has an `origin` (`human` or `agent`) determining verb vocabulary and resolution semantics. Has a lifecycle: open (marker present on disk) → in-progress (transient sidebar state) → resolved (marker removed).

**Human-origin mentions.** The agent receives. Verbs are action (rephrase, expand, shorten, remove-if-redundant) or query (factcheck, question, review, explain). Resolution by the agent replaces the target region inline (action verbs) or leaves a note annotation on the region (query verbs).

**Agent-origin mentions.** The human receives. Verbs are input-request only (clarify, decide, confirm, review). The agent cannot ask the human to do work, only to give input. Resolution by the human creates a note annotation at the target carrying the answer, which the agent reads via `list_recent_changes` on its next poll. Agent-origin mentions are subject to a configurable rate limit; rejected attempts are tracked in a counter exposed in the status drawer.

### Annotation

A persistent side marker left by either the human or the agent on a region of a markdown file. Two flavors:

- **note**: pure information. Stays until manually removed. No lifecycle.
- **suggestion**: contains proposed replacement text for the region. Binary lifecycle: accepted (proposed text replaces the target prose inline, then the annotation is removed) or rejected (annotation is removed, target prose unchanged). Only the human can accept or reject a suggestion.

Annotations do not authorize the agent to edit prose unilaterally. A suggestion is a proposal awaiting human consent, not an edit.

Annotation `content` is markdown, rendered in the editor's side card by the same pipeline as the doc body (CodeMirror 6 with live preview). Suggestion `content` is markdown source; on accept, it replaces the target prose verbatim with no further transformation.

### Marker Shape on Disk

Both mentions and annotations use the same begin/end pair structure:

```
<!-- @sidebar {type} id="{id}" {key=value}*: {instruction} -->
target region
<!-- @sidebar end id="{id}" -->
```

Where:

- `{type}` is one of: `mention`, `note`, `suggestion`
- `{id}` is generated by sidebar at insertion time (short hash like `m-a3f9`, `n-x7q2`, `s-q9k2`), stable across content edits within the region
- `{key=value}` slots carry typed metadata (`verb`, `origin`, `author`, ...)
- `{instruction}` is freeform text after the colon

Markers are filesystem-native HTML comments, invisible in any standard markdown renderer. The sidebar editor hides the marker syntax via CodeMirror decorations and renders the markers as gutter bars, side cards, and verb pills.

## MCP Tool Surface

### Read

| Tool | Returns / behavior |
|------|--------------------|
| `list_docs()` | Every file path in the workspace's glob scope |
| `read_doc(path)` | Full content of a doc; markers are NOT stripped; payload includes `is_draft: bool` and `draft_age_seconds: int` reflecting the editor's dirty-buffer state |
| `list_pending_mentions()` | Every open mention with `id, file, origin, verb, instruction, target_content, base_hash, created_at` |
| `get_mention(id)` | Same shape for a single mention; used to refresh `base_hash` before `resolve_mention` |
| `list_annotations(path?)` | Every annotation with `id, file, type, author, target_content, content, target_anchor, created_at` |
| `list_recent_changes(since?)` | Recent activity in the workspace with author info: file edits by human, new and removed annotations, accepted and rejected suggestions, mention resolutions; `since` is a cursor (timestamp or event id); default returns the last 50 events |

### Mention Lifecycle

| Tool | Behavior |
|------|----------|
| `mark_in_progress(mention_id)` | Claims a mention; triggers transient sidebar UI state |
| `resolve_mention(mention_id, action, base_hash)` | Completes a mention; `action` is `{type: "replace", content: ...}` or `{type: "annotation", annotation_type: "note"|"suggestion", text: ...}`; rejected with conflict error if `base_hash` does not match current content |
| `report_error(mention_id, reason)` | Agent failed to complete; marker stays in place for human to retry or cancel |
| `add_mention(path, target_anchor, verb, instruction)` | Agent only; creates an agent-origin mention; verb must be from the agent-verb whitelist; subject to rate limit |

### Annotation Write

| Tool | Behavior |
|------|----------|
| `add_annotation(path, target_anchor, type, content)` | Creates a new annotation; `type` is `note` or `suggestion` |
| `update_annotation(id, content)` | Modifies an annotation's content; agent can only update its own annotations |
| `remove_annotation(id)` | Removes an annotation; agent can only remove its own annotations |

### Explicit Non-Decisions

- No `edit_doc` or `propose_edit_anywhere` tool. The only paths to modifying prose are `resolve_mention` (within a human-initiated mention) and `add_annotation(type=suggestion)` (which the human must accept).
- No push notifications in V1. Sidebar's MCP server is pull-only. Agents poll on their own cadence.
- No search tool. Agents use their own grep/search capability.

## Editor (V1)

Built on **CodeMirror 6** with custom decoration plugins for sidebar markers. CodeMirror 6 is the renderer Obsidian, Logseq, JupyterLab, and Hypothesis (among others) use; its decoration model is exactly what sidebar's source-with-decorations rendering needs.

### Capabilities

- **Live preview markdown editor.** Markdown syntax (headings, bold, lists, links) rendered as formatted text. Syntax characters visible when cursor is on the line, hidden otherwise. Marker syntax (HTML comments) hidden by decoration and rendered as gutter bars, side cards, and verb pills.
- **Mermaid rendering.** Fenced ```` ```mermaid ```` blocks render as diagrams inline.
- **Outline pane.** Right side panel. Document heading tree. Click to scroll. Drag to reorder, which rewrites the doc's heading order.
- **Code block syntax highlighting.** Standard. Languages from fence info strings.
- **Cmd-K mention/annotation creation.** Inline popover anchored to the selection. Verb autocomplete from the configured set. Sidebar inserts the begin/end pair with a generated id and renders the decoration immediately.
- **File tree on the left.** Built with [`react-arborist`](https://github.com/brimdata/react-arborist) (MIT). Per-file: filename, open-mention count badge with origin breakdown, changed-since-last-view dot, file icon. Right-click context menu: new file, new folder, rename, delete. Drag-and-drop to move files between folders. Icons from [`vscode-icons`](https://github.com/vscode-icons/vscode-icons) (MIT).
- **Cmd-P filename fuzzy jump.** Built with [`cmdk`](https://github.com/pacocoursey/cmdk) plus [`fuse.js`](https://github.com/krisk/Fuse). Workspace-wide.
- **Cmd-Shift-F workspace-wide full-text search.** Backend shells out to bundled ripgrep via [`@vscode/ripgrep`](https://github.com/microsoft/vscode-ripgrep) (about 5 MB postinstall, no user setup). Results panel on the right, grouped by file.
- **Cmd-F in-file find.** CodeMirror built-in.
- **Status drawer.** Collapsible side panel: list of connected agents (name with collision suffix, connect time), pending mentions list with originator and verb, recent activity (last 50 events), agent-mention rate-limit counter, in-progress mention processing status. Right-click on a pending mention exposes a "cancel mention" action that removes the begin/end pair from the file. Right-click on an in-progress mention exposes "release stuck claim" as an escape hatch for wedged agents.
- **Suggestion accept/reject UI.** `type=suggestion` annotations render with Accept and Reject buttons. Accept swaps target with proposed text and removes the annotation. Reject removes the annotation only.
- **Live file refresh.** File watcher triggers editor refresh on external changes (agent edits, git operations, other tools). When buffer is dirty and disk changes, a conflict modal offers keep-yours, take-theirs, or merge view.
- **Manual save (Cmd-S).** No autosave anywhere. Dirty-buffer indicator on the filename. Sidebar tracks dirty state per file and exposes it to the agent via `read_doc`'s `is_draft` and `draft_age_seconds` fields.

### Deferred from V1

- WYSIWYG mode
- Multi-file tabs (one file open at a time in V1)
- Workspace-wide search-and-replace (search yes, replace later)
- Math rendering
- Markdown extensions beyond mermaid
- Theming
- Workspace-wide outline / symbol search across files
- Drag-and-drop import of external files
- Collaborative cursors (single-actor-per-file by Q8)
- In-app version history beyond what the file watcher reflects

## Verbs (V1 Defaults)

### Human-origin verbs

| Verb | Target mode | Notes |
|------|-------------|-------|
| `rephrase` | replace inline | action |
| `expand` | replace inline | action |
| `shorten` | replace inline | action |
| `remove-if-redundant` | replace inline (possibly to empty) | action |
| `factcheck` | annotation (note) | query |
| `question` | annotation (note) | query |
| `review` | annotation (note) | query |
| `explain` | annotation (note) | query |

### Agent-origin verbs

| Verb | Notes |
|------|-------|
| `clarify` | agent needs disambiguation of intent |
| `decide` | agent identified a fork where the human picks |
| `confirm` | agent did something, needs sign-off |
| `review` | agent is flagging a region as worth a closer look before building on it |

Unknown verbs from either side default to annotation mode (safe default; never silently rewrites). Users extend the verb list via the `verbs` key in `.sidebar/config.json` (see Configuration).

## Conflict and Concurrency

### User Edits Open Mention's Target Region

User edits do not cancel the mention. The mention persists. When the agent processes, it reads current content. The agent's `resolve_mention` call includes a `base_hash` of the content it claimed against. If the file has changed since (optimistic concurrency), sidebar rejects with a conflict and the agent retries on the new content.

### Orphaned Mentions

If the user deletes the entire target region while a mention is open, the marker becomes orphaned (no content between begin and end). Sidebar surfaces this visually (red gutter) so the user can cancel or restore.

### Dirty Buffer During Agent Action

When the user has unsaved edits in the editor and the agent reads the file via MCP, `read_doc` returns the disk content plus `is_draft=true, draft_age_seconds=N`. The scaffolded agent skill instructs the agent to either skip the file or add an agent-origin mention with verb `clarify` asking if it is safe to proceed. The agent's exact response is up to its system prompt; sidebar's job ends with exposing the signal.

### Agent Write to Dirty Buffer's File

When the user has unsaved edits and the agent calls `resolve_mention` against the same file, the agent's write hits disk. The editor detects the disk change while the buffer is dirty and surfaces a conflict modal: keep yours, take the agent's, or merge view.

## Workspace

Default glob: `docs/**/*.md` strict. Override via `npx sidebar --scope "<glob>"` at boot or via persistent override in `.sidebar/config.json` (specifics open in Q13).

On startup, if `docs/` does not exist, sidebar prompts the user: create `docs/`, specify a different scope, or quit. No silent fallback to project root.

Files outside the glob are invisible to both the editor and the agent. The agent cannot read or write outside the workspace via sidebar's MCP tools.

## Configuration

All sidebar configuration is project-scoped. There is no global config in `~/.sidebar/` or `~/.config/sidebar/` in V1. Cross-project verb or rate-limit reuse is by copying `.sidebar/config.json`. Revisit if real demand surfaces.

Two files live at `.sidebar/` relative to the project root. Neither is created automatically. The directory and files appear lazily the first time the user performs an action that needs persistence (changes scope from the UI, registers a custom verb, sets a non-default port, runs `npx sidebar --init` explicitly). Until then, sidebar boots on built-in defaults held in memory.

### `.sidebar/config.json` (committed, team-shared)

```json
{
  "version": 1,
  "scope": "docs/**/*.md",
  "rateLimit": { "agentMentions": { "maxOpen": 5 } },
  "verbs": {
    "human": { "<verb>": { "mode": "replace" | "annotation" } },
    "agent": { "<verb>": {} }
  }
}
```

- `scope` overrides the default workspace glob (Q9). Sidebar honors `--scope` on the CLI as a per-boot override; the file value is the persistent default.
- `rateLimit.agentMentions.maxOpen` caps concurrent agent-origin mentions (ADR-0004).
- `verbs` extends the built-in verb set. Redefining a built-in verb is a load error. Verb names must match `[a-z][a-z0-9-]*`. Unknown verbs at runtime still fall through to annotation mode.

### `.sidebar/local.json` (gitignored, per-machine)

```json
{ "version": 1, "port": 5180, "browser": "default" }
```

- `port` overrides the default port. CLI flag `--port` takes precedence per boot.
- `browser` is the launch target on startup: `default` (open the user's default browser), `none` (do not open, just print the URL), or a system-specific identifier (`chrome`, `firefox`, etc.) passed through to the underlying `open` package. See Form Factor.

No session state (last-opened file, panel collapse states) is persisted in V1. Sidebar boots cold every time.

### Gitignore behavior

On creation of `.sidebar/local.json`, sidebar checks for a `.git/` directory in the project root. If present and `.sidebar/local.json` is not already ignored, sidebar offers to append the line to `.gitignore`. It proceeds either way. At each subsequent boot, sidebar emits a single-line warning to stdout if `local.json` exists and is still unignored. There is no persistent dismissal flag; the warning is cheap and committing per-machine state is worse than the nag.

### Validation

Both files are validated at load time. Invalid JSON, unknown top-level keys, schema mismatches, or out-of-range values cause sidebar to refuse to start with a clear error pointing at the offending file and field. Consistent with the Q9 "no silent fallback" stance.

The `version` field on both files exists so a future V2 can detect older schemas and offer migration. In V1, anything other than `1` is a load error.

### Out of scope for Q13

- Skill scaffolding target. Handled via `npx sidebar scaffold-skill --into <path>` as an explicit one-time action. Sidebar does not persist a scaffold target in config.
- Agent identity defaults (what name is written into marker `author` fields). Resolved in Q14.

## Identity and Multi-Agent

### Agent identity in markers

The `author` field on agent-authored markers (mentions, annotations) is derived from the connecting MCP client's self-declared identity, not from sidebar config.

Resolution order on connect:

1. The `clientInfo.name` field from the MCP `initialize` handshake (e.g. `claude-code`, `codex`, `aider`).
2. Literal `agent` if the value is empty, generic (e.g. `mcp-client`, `unknown`), or otherwise unusable.

Users who want a different name configure it at their MCP client layer (the same place sidebar's `init` writes the project `.mcp.json` entry, which the user can edit manually). Sidebar does not maintain a separate identity configuration.

### Collision suffix

When two MCP clients with the same `clientInfo.name` are connected simultaneously, sidebar appends a counter suffix at marker-write time. First connection writes `author="claude-code"`. While that connection is live, a second connection from another `claude-code` writes `author="claude-code-2"`. If a third connects, `claude-code-3`. The suffix is computed each time a marker is written, based on the current set of live connections; it is not stored per-connection and does not survive a reconnect (if `claude-code` disconnects, the existing `claude-code-2` does not get renumbered to `claude-code`; new markers from it just keep writing `claude-code-2` until it too disconnects).

Markers already on disk are never rewritten when connections change. Identity in history is what was true at write time.

### Multi-agent semantics

Sidebar permits multiple MCP clients to connect to the same workspace simultaneously (see [ADR-0006](../adr/0006-multi-agent-permitted-in-v1.md)). The V1 stance is: support the architecture, do not invest in per-agent UX.

- **Mention claim.** `mark_in_progress(mention_id)` is exclusive. First caller wins. Subsequent callers receive a conflict error including the winning client's name. Resolving or reporting an error on a claimed mention releases the claim; another agent may then claim it.
- **Rate limit.** The agent-mention rate limit (ADR-0004) is per-workspace, not per-agent. All connected agents share the same `maxOpen` budget. Simpler; the limit is a noise floor on collective agent chatter, not a fairness mechanism.
- **Status drawer.** Connected agents are listed flat, with name (including collision suffix) and connect time. No per-agent breakdown of mentions, annotations, or rate-limit usage.
- **No agent-to-agent direct messaging.** Sidebar mediates human-to-agent and agent-to-human only. An agent's annotation is visible to other agents via `list_annotations` and `list_recent_changes`, the same way human-authored markers are; that is the entire surface.

### Human identity in markers

For human-authored markers (mentions the user creates via Cmd-K, annotations the user writes), `author` is resolved from local environment on each write:

1. `git config user.name` if a `.git/` directory exists in the workspace and the value is non-empty.
2. The `$USER` environment variable.
3. Literal `human` as last fallback.

The resolved value is written verbatim into the marker after stripping control characters and replacing `"` with `'` to avoid breaking the HTML comment quoting. If sanitization yields an empty string, fall back to `human`.

The value is resolved at write time, not at boot, so changes to `git config user.name` mid-session take effect on the next marker.

## Failure Modes

### Agent disconnect mid-mention

When an MCP client drops connection while holding one or more in-progress mention claims (`mark_in_progress` called, `resolve_mention` or `report_error` not yet called), sidebar starts a 30-second grace period. If the client reconnects within the grace period and references the same claims, they remain held. If the grace expires, the claims auto-release back to `open` and a `release` event with reason `client-disconnected` is emitted to `list_recent_changes`. Reconnecting clients can re-claim via fresh `mark_in_progress` calls.

The grace period is hardcoded in V1; configurable later if real cases surface. A right-click "release stuck claim" action in the status drawer is available as a manual escape hatch.

### File deleted while in scope

For external deletes (e.g. `rm`, git checkout, another tool): the file watcher emits a remove event. The editor closes the file, with an unsaved-changes confirmation only if the buffer is dirty. Mentions and annotations defined inside the file are gone with it; they do not become "orphans." Any in-progress agent claim against a now-deleted file resolves to a not-found error on the next agent action against that mention. A `file-removed` event is emitted to `list_recent_changes`.

For sidebar-initiated deletes via the file tree: confirmation modal if the file has open mentions or an unsaved buffer. No soft-delete or trash directory in V1.

### Malformed markers

Tolerant parse. Markers with mismatched begin/end pairs, duplicate ids, or otherwise broken syntax are skipped during parse: they do not appear in `list_pending_mentions`, `list_annotations`, or `list_recent_changes`. The editor decorates the broken marker with a red gutter and a hover tooltip identifying the specific defect (missing end marker, duplicate id, etc.). The file is still loaded, still editable, still readable by the agent via `read_doc`. Sidebar logs one warning per affected file on parse. No auto-repair in V1.

### Port collision on startup

Port handling for primary instance startup:

- **No explicit port set.** Sidebar tries 5180 first, then linearly through 5181-5189. The first free port wins. The chosen port is printed at boot and written to `connection.json`. If all ten are occupied, sidebar refuses to start with a clear error directing the user to `--port <N>` or `--port 0`.
- **Explicit port set** (either `--port <N>` on the CLI or a `port` value in `.sidebar/local.json`). Sidebar tries that specific port only. On collision, it refuses to start with a clear error. No fallback. This preserves the user's intent when they have a bookmark or external dependency on a specific port.
- **`--port 0`.** Sidebar binds an OS-assigned free port and prints the actual port.

This makes parallel projects work without configuration: project A binds 5180, project B (started after) binds 5181, and so on. Each project has its own `.sidebar/connection.json` with the actual port, so the per-project discovery for stdio proxying and additional-agent attachment is unambiguous. The original Q15 rationale for refusing silent fallback (the agent reads a fixed port from MCP config) no longer applies after Q15.5: the agent attaches via stdio, which has no port, so the bound port matters only to the browser tab and to additional agents reached via the per-project discovery file.

### MCP server crash

Any unhandled error in MCP server code crashes the whole sidebar process. The browser tab observes the WebSocket drop and shows a disconnected state. The user restarts `npx sidebar` (or restarts their agent, which respawns sidebar via stdio). Individual MCP tool handlers catch their own errors and return MCP error responses, so a bad agent call does not crash the process; only structural or unexpected errors do. Isolated MCP-only restart is rejected because the editor and MCP server share in-memory state and partial recovery invites half-consistent states.

### Editor disconnect from server

The browser tab auto-reconnects with exponential backoff (1s, 2s, 5s, 10s, capped at 30s) and shows a "reconnecting..." indicator. On reconnect, the editor re-fetches workspace state (file list, current file content, pending mentions, annotations). The dirty buffer survives in browser memory; if disk content still matches the last-saved snapshot, the buffer stays. If disk changed during the disconnect (another tool wrote, sidebar restarted), the existing conflict modal from [ADR-0005](../adr/0005-manual-save-with-dirty-buffer-mcp-signal.md) fires (keep yours, take theirs, or merge view).

## Form Factor

### Browser launch

On primary instance startup, sidebar opens the bound HTTP URL in the user's chosen browser. The `browser` key in `.sidebar/local.json` controls behavior:

- `"default"` (default): hand the URL to the system default browser via the `open` package (uses `open` on macOS, `xdg-open` on Linux, `start` on Windows).
- `"none"`: skip launch entirely. The URL is always printed at boot regardless of setting.
- platform-specific identifier (`"chrome"`, `"firefox"`, etc.): pass through to the `open` package's app selector. If the named browser is not installed, fall back to default and log a single warning.

If browser launch fails for any reason (headless environment, missing `xdg-open`, WSL without an X server, etc.), sidebar logs one warning and continues running. The URL is printed at boot so the user can navigate manually.

Only the primary instance opens a browser. `--stdio` proxy invocations do not, because the primary's browser tab is already attached to the shared instance.

For repeat boots, sidebar opens the URL again; modern browsers focus an existing tab on the same URL rather than spawning a duplicate. Imperfect, but cheap.

### Self-update

None in V1. Sidebar prints its version at boot. The user updates via `npx sidebar@latest` or `npm i -g sidebar`. No background version check, no nag banner, no `sidebar update` subcommand. If "I'm always on stale sidebar" emerges as a real problem, a single-line "newer version available" hint at boot can be added later without breaking anything.

### `.sidebar/connection.json` (the discovery file)

Written by the primary instance on boot, removed on graceful shutdown. Gitignored.

```json
{
  "version": 1,
  "url": "http://127.0.0.1:5180",
  "pid": 84512,
  "started_at": "2026-05-14T18:22:00Z"
}
```

A subsequent `npx sidebar --stdio` invocation reads the file and:

1. If the file is missing or malformed: become primary.
2. If the file is present and `pid` is alive (cross-platform `process-exists` check): become a proxy, forward stdio traffic to the primary's HTTP transport at `url`.
3. If the file is present but `pid` is dead (process exited without removing the file, e.g. SIGKILL): treat as stale, remove the file, become primary.

`npx sidebar` (standalone) performs the same check and refuses to start if a primary is alive: "primary already running at <url>; attach via that URL or stop the running primary first."

The "is the PID alive" check is fast and racy in principle. If two primaries race, whichever wins the HTTP port bind becomes primary; the loser sees `EADDRINUSE` and either falls through to proxy (if the winner's `connection.json` is now visible) or refuses to start.

### Runtime baseline

- **Node version.** Sidebar targets Node 20 LTS or later. Older versions are rejected at boot with a clear error.
- **No daemon mode.** Sidebar runs in the foreground. Ctrl-C cleanly shuts down and removes `connection.json`. No `--daemon`, no supervision.
- **Logs.** Sidebar logs to stderr at INFO level by default. `--verbose` raises to DEBUG. `--quiet` lowers to WARN. No file logging in V1.
- **Telemetry.** None. No phone-home, no crash reporter, no analytics.

## Skill (Agent Co-Author Instructions)

Sidebar's coordination model (mention lifecycle, `base_hash` refresh-and-retry, dirty-buffer signal, verb semantics, rate-limit etiquette, multi-agent claim exclusivity) requires the connected **Agent** to know how to behave. Without per-agent instructions, the agent improvises and the improvisation is wrong in interesting ways. Sidebar provides this guidance in two tiers.

### Tier 1: MCP server description (the floor)

The MCP `initialize` response includes a server description string. Sidebar packs a 200-400 token preamble there, visible to every connecting agent regardless of filesystem setup. Contents:

1. One sentence on what sidebar is.
2. The permission model: prose edits only via `resolve_mention` or accepted `suggestion` annotations.
3. The `base_hash` protocol: refresh via `get_mention` and retry on conflict.
4. The `is_draft` signal: when true, prefer to skip the file or create an agent-origin mention with `clarify` asking if it is safe to proceed.
5. Pointer to the richer skill file: "for full guidance, run `npx sidebar scaffold-skill`."

This tier is always present. It is the protocol baseline; the user does not opt out.

### Tier 2: `scaffold-skill` (the ceiling)

`npx sidebar scaffold-skill [--into <path>]` writes a richer skill document (1500-2500 tokens) into the user's chosen skill directory.

Default target: `.claude/skills/sidebar-collaboration/SKILL.md`. Claude Code and Compound both discover skills at this path. Override via `--into <path>` for other agents or non-default locations.

Frontmatter (Claude Code / Compound):

```yaml
---
name: sidebar-collaboration
description: How to collaborate via sidebar's MCP server. Activates when an MCP tool from the sidebar server is called.
---
```

Body sections, in order:

1. **What sidebar is.** Two-sentence framing.
2. **Permission model.** Prose edits only via `resolve_mention` or `add_annotation(type=suggestion)`. The agent can write `note` annotations freely and `suggestion` annotations expecting human accept/reject.
3. **Mention round-trip.** List pending, claim with `mark_in_progress`, read with `base_hash`, do the work, resolve with `base_hash`. On conflict: refresh via `get_mention` and retry against the new content.
4. **Verb table.** Action verbs replace inline; query verbs add an annotation. Unknown verbs default to annotation.
5. **Dirty buffer.** When `read_doc` returns `is_draft=true`, prefer to skip or create an agent-origin mention with `clarify`. Do not blindly proceed against draft content.
6. **Agent-origin mentions.** Use sparingly. `clarify` for disambiguation, `decide` for forks, `confirm` for sign-off, `review` to flag concerns. Subject to a per-workspace rate limit.
7. **Annotations.** `note` for information, `suggestion` to propose edits outside an open mention. The agent can only update or remove its own annotations.
8. **Multi-agent etiquette.** Other agents may be connected. Do not claim mentions you cannot complete; release with `report_error` if you fail. Do not duplicate an annotation another agent already made.
9. **What sidebar does not let you do.** No file delete, no out-of-glob writes, no search tool (use your own grep).
10. **Examples.** Full mention round-trip, a conflict-and-retry, a `clarify` flow, a `suggestion` proposal.

### Update semantics

`scaffold-skill` is idempotent: re-running overwrites the existing file with the latest content. No version tracking in V1. If a user customizes the skill and re-runs scaffold, they lose customizations; this is acceptable because the skill is documentation, not configuration. If preservation matters later, `--no-overwrite` is a one-line addition.

### V1 vs V1.1

V1 ships the Claude Code / Compound skill format (one frontmatter shape, one default path). Cursor's `.cursor/rules/sidebar.md` and Aider's instruction-file conventions land in V1.1 as `scaffold-skill` learns more formats. The Tier 1 floor (MCP description) is agent-agnostic and works in every case.

## Tracer-Bullet Readiness Note

This spec is ready for vertical-slice decomposition via Matt Pocock's `to-issues` skill (each issue cuts through every layer end-to-end, tagged HITL or AFK). The rough first-pass sketch below is illustrative; the real decomposition should come from `to-issues`:

- Slice 1: minimal editor plus file tree plus file open/save (no markers, no MCP)
- Slice 2: MCP server scaffolding (stdio and HTTP transports, `list_docs` and `read_doc`), `init` subcommand writing `.mcp.json`, MCP description floor
- Slice 3: human-origin mention creation via Cmd-K, marker rendering as decoration (no agent loop yet)
- Slice 4: mention lifecycle and `resolve_mention` from the agent side, `base_hash` optimistic concurrency
- Slice 5: annotations (notes and suggestions) end-to-end, including agent self-modify rules
- Slice 6: agent-origin mentions with rate limit and counter
- Slice 7: outline pane, mermaid rendering
- Slice 8: workspace-wide search (ripgrep)
- Slice 9: conflict UI (dirty buffer, optimistic concurrency on resolve)
- Slice 10: multi-agent (primary/proxy routing via `connection.json`, collision suffix, status drawer agent list)
- Slice 11: `scaffold-skill` subcommand with default Claude Code / Compound target
- Slice 12: failure-mode polish (disconnect grace, port fallback, malformed-marker decoration, editor auto-reconnect)
