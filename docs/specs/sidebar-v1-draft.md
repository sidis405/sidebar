---
date: 2026-05-14
topic: sidebar-v1-spec
status: draft
derived_from: docs/ideation/2026-05-13-sidebar-ideation.md
glossary: CONTEXT.md
---

# Sidebar V1 Specification (Draft)

This document captures the design of sidebar V1 as resolved by grilling the original ideation. Decisions through Question 12 are settled. Operational items 13 through 16 remain open and are listed at the bottom. The glossary in `CONTEXT.md` is the source of truth for terminology.

## Summary

Sidebar is a local-first markdown reading and co-authoring surface for a project's documentation. It exposes a local web-served editor UI and a local MCP server in the same Node process. The user runs sidebar in a project directory via `npx sidebar`. Sidebar prints an MCP configuration block; the user pastes it into the MCP config of their existing agent (Claude Code, Codex, Aider, etc.). The agent restarts, connects to sidebar's MCP server, and is now invited to the workspace for the duration of its session.

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

## Architecture

Sidebar is one Node.js process that hosts:

- A web-served editor UI (HTTP plus WebSocket on a local port, opened in the user's default browser on startup)
- A local MCP server (stdio or HTTP transport, depending on the agent's MCP client)
- A file watcher for the workspace glob
- An in-memory state layer for transient runtime state (in-progress mentions, dirty buffers, recent change events, agent-mention rate-limit counter)

The user runs `npx sidebar` from a project directory. Sidebar discovers the workspace (default glob `docs/**/*.md`), launches the editor, and emits an MCP server configuration block the user pastes into their agent. Persistent shared state lives in the markdown files themselves; sidebar's process memory is for transient state only. The `.sidebar/` directory at the project root holds configuration (specifics open in Q13).

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
- **Status drawer.** Collapsible side panel: agent connection state, pending mentions list with originator and verb, recent activity (last 50 events), agent-mention rate-limit counter, in-progress mention processing status.
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

Unknown verbs from either side default to annotation mode (safe default; never silently rewrites). Users extend the verb list via `.sidebar/verbs.json` (schema open in Q13).

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

## Open Questions

These operational items are not yet grilled and remain open:

1. **`.sidebar/` config directory.** What files live there. What is gitignored. What is team-shared. Schema for `verbs.json`. Schema for `config.json`. Behavior on first run.
2. **Identity of the agent.** How the agent is named in markers (configured name, model name, generic `agent`). How sidebar handles multiple agents connected to one workspace (multi-agent V1 yes or no).
3. **Failure modes.** Agent disconnect mid-mention. File deleted while in scope. Malformed marker (external edit broke the syntax). Port collision on startup. MCP server crash. Editor disconnect from server.
4. **Form factor specifics.** Port choice strategy (deterministic from project path, or random). Browser launch behavior. Where transient state lives within `.sidebar/`. Whether sidebar self-updates.

## Tracer-Bullet Readiness Note

This draft is intended to be decomposable via Matt Pocock's `to-issues` skill (vertical-slice tracer-bullet issues, each cutting through every layer end-to-end, tagged HITL or AFK). A rough first-pass sketch (the real decomposition should be produced by `to-issues` after the remaining grill items land):

- Slice 1: minimal editor plus file tree plus file open/save (no markers, no MCP)
- Slice 2: MCP server scaffolding, `list_docs` and `read_doc`, Invite block emission
- Slice 3: human-origin mention creation via Cmd-K, marker rendering as decoration (no agent loop yet)
- Slice 4: mention lifecycle and `resolve_mention` from the agent side
- Slice 5: annotations (notes and suggestions) end-to-end
- Slice 6: agent-origin mentions with rate limit and counter
- Slice 7: outline pane, mermaid rendering
- Slice 8: workspace-wide search (ripgrep)
- Slice 9: conflict UI (dirty buffer, optimistic concurrency)
