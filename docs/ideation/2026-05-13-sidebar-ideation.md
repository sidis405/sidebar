---
date: 2026-05-13
topic: sidebar-co-authoring-editor
tool: sidebar
mode: elsewhere-software
status: current
supersedes: docs/ideation/2026-05-13-agent-collaborative-markdown-workflow-ideation.md
---

# Sidebar: A Local Markdown Co-Authoring Surface Over MCP

> This document supersedes the earlier broader ideation in `2026-05-13-agent-collaborative-markdown-workflow-ideation.md`. That document's "Product B" scope (task decomposition, subagent orchestration, context isolation) is no longer part of this project. Solo covers that ground (https://soloterm.com/docs/workflows/agent-orchestration), and Matt Pocock's `to-prd` plus `to-issues` skills cover the PRD-to-slices convention (https://github.com/mattpocock/skills). Sidebar is Product A only.

## Summary

Sidebar is a local-first markdown reading and co-authoring surface for a project's `docs/` directory (or a configured glob). It provides a human-side editor with a file tree on the side, an MCP server that agents connect to in order to participate, in-file mention markers for tagging the agent on specific regions, and live diff and status surfaces for changes by either party.

The agent is "invited" by configuring its MCP client to connect to sidebar's MCP server. Once connected, the agent has persistent presence on the workspace for the duration of its session, similar to Proof's agent invites but built on MCP rather than a proprietary HTTP bridge.

## Constraints and Requirements

### Scope

* Single project, local first, filesystem native.
* Scoped to `docs/**` by default, expandable by glob.
* Solo developer or small team use case.
* No multi-actor real-time co-editing in V1.

### Requirements (user named)

* Direct filesystem access for the agent (no POST-per-edit pattern as in proof-sdk).
* Tagging the agent inside the editor on specific regions.
* "Pair programming for authoring" feel, not one-shot task hand-offs.
* Tool name is `sidebar`.
* Configured agent, not auto-detected.

### Anti-requirements

* Not a CRDT co-edit surface.
* Not an orchestrator for subagents.
* Not a task decomposer (use Solo, or Matt Pocock's `to-issues` skill).
* Not tied to any specific framework (Compound Engineering, Superpowers, etc.). Sidebar detects available frameworks and offers integration, but it does not depend on any.

## Architecture

### Two components

1. The editor UI. `npx sidebar-md` launches a local web UI in V1. Tauri later if usage justifies it.
2. The MCP server, exposed by the same sidebar process on a local socket.

### Data model

* Markdown files in the configured scope (default `docs/**`).
* HTML-comment markers for mentions, annotations, and status flags. All markers are valid markdown (rendered as comments by any other tool, invisible in normal rendering).
* Git for history and provenance.
* No separate database or sidecar files in V1.

### Mention marker shape

```markdown
<!-- @agent[verb]: instruction -->
target region
<!-- @end -->
```

Verbs are open ended but conventional: `rephrase`, `expand`, `factcheck`, `question`, `remove-if-redundant`. Freeform is allowed.

### MCP tools exposed

* `list_docs(glob?)` returns paths in scope.
* `read_doc(path)` returns content.
* `list_recent_changes(since?)` returns files the human has changed, with optional summaries.
* `list_pending_mentions()` returns open mentions with verb, instruction, target region, file path, priority.
* `mark_in_progress(mention_id)` signals sidebar's UI to render the mention as actively processing.
* `propose_edit(path, edit_or_diff, apply?)` writes a proposed edit. Default is a side-comment for human review. With `apply=true` it replaces inline.
* `add_comment(path, anchor, content)` adds a side annotation visible in the editor.
* `resolve_mention(mention_id, action)` marks done. The `action` field describes what the agent did.
* `report_error(mention_id, reason)` marks failed.

### Invitation flow

1. User runs `npx sidebar-md` in a project directory.
2. Sidebar scopes itself to `docs/**` or to a passed glob.
3. Sidebar prints (or copies to clipboard) an MCP server configuration block.
4. User pastes that into their agent's MCP config (`.claude/mcp.json`, Codex equivalent, etc.).
5. User starts or restarts their agent. The agent connects.
6. Agent has presence on the workspace for the duration of that session.

### Skill scaffolding (optional, on first run)

If sidebar detects a known framework (`.claude/skills/`, `.compound/skills/`, Solo's `solo.yml`, etc.), it offers to scaffold a `sidebar-co-author` skill into that framework. The skill primes the agent for the co-authoring role: watch for recent changes, leave comments on what you notice, process pending mentions, ask the human via `add_comment` when blocked. This is a convenience. Without the skill the user can write their own system prompt.

## Design Moves

### 1. Filesystem as content. MCP as the agent interface.

Sidebar exposes a local MCP server. Agents connect on invite. The filesystem is the canonical state. MCP is the channel for agent participation.

**Basis (external).** Solo and Claude Code both use MCP as the standard external integration channel. MCP is the agent-agnostic alternative to proof-sdk's proprietary HTTP bridge.

### 2. File tree scoped to a configurable glob, default `docs/**`

A literal sidebar with the file tree, scoped narrowly by default. Open-mention counts per file. Changed-since-last-view markers. Toggle to expand scope.

**Basis (reasoned).** This is the affordance for "what did the agent do" and "what is outstanding for me."

### 3. Per-file diff view for any change

When a file on disk changes while open, sidebar shows a diff against the last version the human read. Works the same for human-initiated and agent-initiated changes.

**Basis (reasoned).** Git already tracks history at line granularity. Sidebar surfaces it ergonomically in the editor moment, not after a commit.

### 4. In-file mention markers with verb, instruction, region

Cmd+K with a selection inserts the marker around it. Verb is from a configurable list (with freeform allowed). Mentions live as HTML comments in the markdown, so they persist across any tool that touches the file.

**Basis (reasoned).** Persistent content beats ephemeral chat for things the human wants to come back to. Mentions are also the natural place for the human to inject focused asks into the ongoing co-authoring session.

### 5. Inline annotations via MCP `add_comment`

The agent and the human can both leave annotations on specific regions. Renders in a side gutter. Same shape regardless of author.

**Basis (external).** Solo's scratchpad pattern uses revision-guarded markdown for shared context. Sidebar's annotations are a tighter version for inline use within a doc.

### 6. Configured agent, no auto-detection

Sidebar's config file names the agent and the MCP config block to paste. No CLI sniffing. No enum of supported agents. If the user changes their agent, they update the config.

**Basis (direct).** Explicitly requested. "I'd be happy to tell sidebar what the agent is."

### 7. Processing status as first-class UI

Gutter colors per mention (yellow pending, blue in-progress, green done, red failed). Status drawer with active mentions and recent history. Optional streaming agent-output pane, collapsible. Cancel button on a mention flags it as canceled in the marker; the agent picks that up on its next poll of `list_pending_mentions`.

**Basis (reasoned).** Without this surface the human is blind to the agent's work and has no way to intervene.

### 8. `npx sidebar-md` first. Tauri later if usage justifies.

The data model is the filesystem, so the form factor is a deferred decision. npx removes adoption friction. Tauri is a port if the project gets daily-use traction.

**Basis (reasoned).** Ship the cheaper shell first. Don't build both at once.

## Tension Worth Naming

A persistent co-authoring agent accumulates context across the session. That is in tension with the "context never gets conflated" line from the prior ideation. It is reconcilable because conflation was a many-subagents concern, and sidebar's scope has one agent on one doc set where full shared context is the point. If subagents are wired in later (out of scope for V1, to be handled in a separate avenue), the design has to switch modes: the co-authoring agent gets full context, dispatched subagents get sealed contexts.

## What's Deferred

Everything previously framed as Product B is out of scope for sidebar:

* Decomposing a planning doc into per-unit task files.
* Orchestrating subagents over those tasks.
* Context isolation between subagents.
* Per-task scratchpads with promotion.
* A frontmatter task schema.
* Build-graph-style orchestration.

Solo provides scratchpads, todos with blockers, and a lead-worker dispatch pattern over MCP (https://soloterm.com/docs/workflows/agent-orchestration, https://soloterm.com/docs/workflows/scratchpads-and-todos). Matt Pocock's `to-prd` plus `to-issues` skills provide a PRD-to-vertical-slices convention (https://github.com/mattpocock/skills/tree/main/skills/engineering). Sidebar will not duplicate either, and will be designed to compose with them.

## Prior Art and Corrections

### Solo (https://soloterm.com)

Not just a terminal multiplexer. Solo has first-class scratchpads (project-scoped markdown with revision guards, exposed via MCP), todos (objective, owner lane, status, priority, blockers, lock state), and an explicit lead-agent plus worker-agents orchestration pattern. The agent-side feature set Solo provides covers most of the "Product B" ground from the prior ideation.

### Proof and proof-sdk

Useful as a pattern reference for "agent is invited and persistent." The proprietary HTTP bridge and CRDT-for-real-time-co-edit make the implementation fragile. Sidebar takes the invite pattern and rebuilds it on MCP plus filesystem, dropping the CRDT and the real-time goals.

### Matt Pocock's skills

`to-prd` synthesizes the current conversation context into a fixed-template PRD published as a single issue on the project tracker. `to-issues` decomposes a PRD into tracer-bullet vertical slices, each cutting through every layer end-to-end, tagged HITL (needs human) or AFK (autonomous). Both publish to an issue tracker. Sidebar's substrate choice (filesystem) is the opposite of Pocock's (issue tracker), but the conceptual split (one synthesis pass, then a separate human-in-the-loop decomposition pass) is the right pattern.

### Compound Engineering

A framework sidebar can detect and surface but does not depend on. If `.compound/` or compound-engineering skills are present, sidebar offers to scaffold a co-authoring skill into that framework. Same for `.claude/skills/`, Solo, or any other detected workflow tool. Sidebar stays agent-agnostic and framework-agnostic.

## Open Questions

1. **Mention scope.** Region-scoped mentions are clear. Should sidebar also support file-level mentions (the whole file is the target, "split this into three") and directory-level mentions ("write an index.md summarizing everything in this folder")? If yes, the marker syntax has to extend, and the UX (where Cmd+K inserts) differs by scope.
2. **Annotation persistence.** Annotations as HTML comments are filesystem-native but can clutter a file. Alternative: a sidecar `.annotations` file per markdown file. Trade off: cleaner files vs. one more thing to track. Default in V1: in-file. Revisit if files get ugly.
3. **Cancellation semantics.** Should canceling a mention from the UI delete the marker or flag it so the agent skips it? Deletion is simpler. Flagging keeps history. Default to flagging.
4. **Multi-agent mode.** MCP allows multiple agents connected to one workspace simultaneously. The UX implication (who is processing what, conflicts on the same file) is non-trivial. V1: single agent. Revisit later.
5. **Identity of the agent in annotations.** When the agent leaves a comment via `add_comment`, who shows up as the author? "Agent" is generic. The agent's name (configured) is more useful but adds setup friction. Default to the configured name with a generic fallback.
