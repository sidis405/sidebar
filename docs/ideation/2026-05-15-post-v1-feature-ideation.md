---
date: 2026-05-15
topic: post-v1-feature-ideation
tool: sidebar
mode: ideation
status: draft
---

# Post-V1 Feature Ideation

A scan of where Sidebar's V1 leaves gaps, what other markdown editors and
agent collaboration tools have figured out, and which directions are worth
pursuing first. This is exploratory, not a roadmap.

## What V1 already covers

For grounding, the remaining V1 slices cover:

- Slice 6: Agent originates mentions back at the human (rate-limited).
- Slice 7: Multiple agents at once (claim exclusivity, name collision, proxy routing).
- Slice 8: Outline pane and Mermaid rendering.
- Slice 9: Search (Cmd-P jump, Cmd-Shift-F across workspace, Cmd-F in file).
- Slice 10: `scaffold-skill` (the rich agent skill file).
- Slice 11 plus issue #14: Failure-mode polish and aesthetics.

V1 finishes the mention and annotation primitive in both directions,
multi-agent, and basic editor navigation. It does NOT cover provenance,
batched review, locks, presence, cross-doc operations, anything social or
shared, or any agent-proactive behavior. That is the canvas this document
explores.

## Theme 1: extend the existing primitive

These reuse mention, annotation, and marker without inventing new on-disk
shapes.

### 1. Ghost mentions (agent-proactive suggestions)

Every change-the-prose path today starts with the human typing Cmd-K. Cursor
and Continue have trained everyone to expect the agent to volunteer. The
agent reads `list_recent_changes`, notices something (typo, contradicting
claim, dead link), and creates a `type=suggestion` annotation without being
asked. The human dismisses or accepts.

Tradeoff: rate-limit harder than Slice 6's input-request mentions, or it
becomes Clippy.

Prior art: Grammarly, Cursor's Composer, Copilot's inline nudges.

### 2. Review session UI

After an agent resolves a chain of mentions, a doc can end up with eight to
twelve unresolved annotations. A "review mode" with `j` and `k` to walk
between them, `a` and `r` for accept and reject, and a unified diff at the
top. PR-thread ergonomics, on the filesystem.

Tradeoff: another mode to maintain in the editor.

Prior art: GitHub PR review, Cursor's pending-changes panel.

### 3. Locks

A new marker `<!-- @sidebar lock id="..." reason="legal-reviewed": -->target<!-- @sidebar end ... -->`.
The agent refuses to write inside, even if a mention is open in the region.
Inverts the current trust model (today: agent allowed only inside mentions;
with locks: agent forbidden inside locks). Useful for compliance copy or
accepted RFC decisions.

Tradeoff: a third marker type and the cognitive cost it imposes.

Prior art: Notion page locks, Google Docs suggestion-only mode.

## Theme 2: provenance and history

Sidebar already has the filesystem as the source of truth and
`list_recent_changes` for short-term state, but no long-term lens.

### 4. Per-paragraph provenance

Cmd-Click any paragraph and a side card shows "rewritten by `claude-code` on
2026-05-14, resolving mention `m-a3f9`, with verb `rephrase`, after you wrote
`<original snippet>`." It is git blame plus Sidebar's lifecycle log, joined.
Lets the human trust agent edits without auditing every diff.

Tradeoff: requires persisting more than the in-memory `list_recent_changes`
ring buffer.

Prior art: Notion edit history, Linear's activity timeline.

### 5. Sessions as first-class

A "session" opens when the editor opens and closes when it closes (or after
N minutes of inactivity). Every event in `list_recent_changes` belongs to a
session. UI: "show me what happened in yesterday's session," timeline of
agent edits with one-click revert.

Tradeoff: session boundaries are fuzzy and the persistence story (sqlite,
jsonl) is a real decision.

Prior art: Cursor chat history, Claude Code's `/resume`.

## Theme 3: cross-doc operations

Sidebar currently treats each file as an island. Most "thinking" projects
span multiple docs.

### 6. Backlinks pane

For the open file, show every doc in the workspace that links to it
(markdown `[text](path.md)` or wikilinks `[[path]]`). Free signal, cheap to
compute, makes a `docs/` folder feel like a knowledge graph.

Tradeoff: feature creep toward Obsidian if pursued too far.

Prior art: Obsidian, Bear, Logseq, Foam.

### 7. Multi-file mentions

A Cmd-K variant where the selection becomes a "starting point" and the agent
is asked to rephrase that paragraph and the equivalent paragraph in two
other files. Resolves as N coordinated edits, accepted or rejected together.
Useful for: changelog plus README plus spec all describing the same change.

Tradeoff: the lifecycle protocol (`base_hash`, claim exclusivity) gets
complicated across files.

Prior art: nothing maps cleanly. Aider can edit multiple files but without
Sidebar's review semantics.

### 8. Outline-driven moves

Drag a heading in the outline pane to move that whole section (including its
child markers). Inserts and removes happen through the file watcher, no
special MCP plumbing needed.

Tradeoff: needs a stable id on each heading, otherwise it becomes a
structural-diff nightmare.

Prior art: Notion, Workflowy, Logseq.

## Theme 4: change the surface (more experimental)

### 9. PR ingestion

A new command: `npx sidebar-md ingest-pr 42` pulls a GitHub PR's review
comments on `.md` files into the workspace as agent-origin mentions on those
files. Resolve them in Sidebar, Sidebar pushes back to GitHub. Turns Sidebar
into the editor for "respond to my reviewer."

Tradeoff: GitHub API surface, auth, drift when GitHub state changes
mid-flight.

Prior art: ReviewPad, CodeStream, some Cursor experiments. Closest mental
model: GitHub PR review embedded in your local editor.

### 10. Skill marketplace

The scaffolded skill is just a markdown file. Make them shareable:
`npx sidebar-md install-skill rails-rfcs` grabs a community skill optimized
for a specific domain (RFC docs for Rails, ADRs for distributed systems,
blog drafts for technical bloggers).

Tradeoff: a marketplace is real infrastructure, not a side project. Start
with `--from <git-url>` and grow.

Prior art: VS Code extensions, npm itself, Continue's prompt library.

### 11. Agent-vs-agent on the same mention

Open a mention, choose "run with claude-code AND codex." Both write to a
temp annotation; the human picks. Comparative output for verbs where quality
varies by agent.

Tradeoff: needs the multi-agent slice 7 first, plus a tournament UI.

Prior art: chatbot arena, manual A/B in any agent tool.

### 12. Voice to mention

Hold a key, speak "rephrase this for less jargon, please keep the example."
Whisper transcribes, marker is inserted. Removes the typing tax for the most
common Cmd-K action.

Tradeoff: introduces a non-local dependency (or ships Whisper.cpp locally
and pays the disk cost).

Prior art: Wispr Flow, Talon, every voice memo app pretending to be a
productivity tool.

## Top three picks if betting on the next slice

In order of bang per buck:

1. **Ghost mentions**. Closest to where agent tooling has converged. Reuses
   existing primitives. The bar is rate-limiting and good defaults.
2. **Per-paragraph provenance**. Builds trust, which is the actual long-term
   blocker for "let the agent touch my docs." Needs a persistence layer
   needed anyway for sessions.
3. **PR ingestion**. The unfair-advantage feature given that the dogfood
   user writes RFCs and ships PRs all day. The one thing on this list that
   competitors are not already racing toward.

## Push back

The wild card to push back on is the **skill marketplace**. Cool, but
premature. Sidebar does not have users yet, so there is no community to seed
it; the right first step is "share via git URL" and let the marketplace
emerge if usage shows up.
