# Sidebar

Sidebar is a local-first markdown reading and co-authoring surface for a project's docs. It pairs a human-side editor with a local MCP server that the user's own agent connects to on invite.

## Language

**Sidebar**:
The tool itself. One process that exposes a local web-served editor UI and a local MCP server.

**Agent**:
The user's existing agent (Claude Code, Codex, Aider, or another MCP-speaking client) running in the user's own terminal. Sidebar does not spawn, embed, own, or drive the agent's lifecycle.
_Avoid_: assistant, copilot, LLM

**Invite**:
The setup act where sidebar prints an MCP server configuration block and the user pastes it into their agent's MCP config. After the agent restarts, it connects to sidebar's MCP server and can use sidebar's tools.
_Avoid_: connect, attach, integrate, hook up

**Workspace**:
The set of markdown files that sidebar exposes to the human (via the editor UI) and to invited agents (via MCP tools). Bounded by a configurable glob, default `docs/**/*.md` strict. Files outside the glob are invisible to both the editor and the agent. When `docs/` does not exist on startup, sidebar prompts the user to create it or pass `--scope` with a different glob; it never silently falls back.
_Avoid_: project, scope, vault, doc set

**Mention**:
A marker placed in a markdown file inviting the other party to act on or respond about a specific region. Has an `origin` (`human` or `agent`) that determines verb vocabulary and resolution semantics.
- _Human-origin_: the **Agent** receives. Verbs are action (rephrase, expand) or query (factcheck, question). Resolution by the agent replaces the target inline (action verbs) or leaves an **Annotation** on the region (query verbs). Authorizes the agent to edit the target region while open.
- _Agent-origin_: the human receives. Verbs are input-request only (clarify, decide, confirm, review). The agent cannot ask the human to do work, only to give input. Resolution by the human creates a `note` **Annotation** at the target carrying the answer, which the agent reads on its next `list_recent_changes` poll.

Lifecycle in both cases: open (marker on disk) → in-progress (transient sidebar state) → resolved (marker removed).
_Avoid_: comment (HTML comment is the implementation, not the concept), request, ask, todo, task

**Annotation**:
A persistent side marker left by either the human or the **Agent** on a region of a markdown file. Two flavors:
- _note_: pure information. Stays until manually removed. No lifecycle.
- _suggestion_: contains proposed replacement text for the region. Binary lifecycle: accepted (the proposed text replaces the target prose inline, then the annotation is removed) or rejected (annotation is removed, target prose unchanged). Only the human can accept or reject a suggestion.

Annotations do NOT authorize the **Agent** to edit prose unilaterally. A suggestion is a proposal awaiting human consent, not an edit.
_Avoid_: comment, remark, draft

## Relationships

- A **Sidebar** instance hosts exactly one **Workspace**.
- A **Workspace** is observable and writable by zero or more **Agents** that have been joined via **Invite**.
- An **Agent**'s lifecycle is owned by the user, not by **Sidebar**. Sidebar sees only the MCP connection.
- An **Agent** connection is optional. A **Workspace** is fully usable (read, edit, mention) without any **Agent** connected. The **Agent** adds capability when present.
- A **Mention** authorizes an **Agent** to edit its target region for the duration of the mention's lifecycle. Authorization expires on resolution.
- An **Annotation** is information only. It does not grant edit rights to either side.
- The **Agent** reads **Annotations** as context (via `read_doc` and `list_recent_changes`). There is no event that triggers the agent to "process" an annotation; the agent decides what to do with the information based on its own behavior.
- When the human edits the target region of an open **Mention**, the mention persists and the agent works on the current content at processing time. If the user removes the target region entirely, the **Mention** becomes orphaned and is surfaced visually as a problem to resolve.
- Both **Mentions** and **Annotations** are implemented as HTML comments in the markdown, so they are filesystem-native and survive any markdown-aware tool.

## Example dialogue

> **Dev:** "If I want to use sidebar with Codex instead of Claude, what changes?"
> **Domain expert:** "Sidebar is the same. You start Codex in your terminal as you normally would, paste sidebar's **Invite** block into Codex's MCP config, restart Codex, and it's joined to the **Workspace**. Sidebar doesn't know or care which agent it is, only that one is connected over MCP."

## Flagged ambiguities

- "comment" was used loosely in early drafts to mean both human-to-agent asks and agent-to-human notes. Resolved: comment is overloaded (HTML comments are also the implementation substrate). Use **Mention** for human-to-agent action requests with lifecycle, **Annotation** for persistent side notes from either party.
