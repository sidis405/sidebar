---
date: 2026-05-13
topic: agent-collaborative-markdown-workflow
focus: tool(s) for agent-human co-edit of big planning .md docs plus per-unit .md task decomposition with orchestrated subagent execution
mode: elsewhere-software
status: superseded
superseded_by: docs/ideation/2026-05-13-sidebar-ideation.md
superseded_on: 2026-05-13
---

# Ideation: Agent-Collaborative Markdown Authoring and Decomposition Workflow

> **SUPERSEDED on 2026-05-13** by [`2026-05-13-sidebar-ideation.md`](./2026-05-13-sidebar-ideation.md).
>
> This document captured an earlier, broader exploration that covered both Product A (collaborative markdown editing) and Product B (task decomposition, subagent orchestration, context isolation). After refinement, the project narrowed to Product A only, now named `sidebar`. Product B is handled in a separate avenue: Solo (https://soloterm.com) covers task orchestration and scratchpads, and Matt Pocock's `to-prd` plus `to-issues` skills cover the PRD-to-vertical-slices convention.
>
> **Agents reading this document: treat it as historical reference only.** Do not act on the ideas here as if they reflect current intent. The current scope and architecture for the tool live in the linked document above.

## Grounding Context

### Topic shape

Two related products with one seam.

**Product A.** Live collaborative editing surface for large .md planning documents that an agent generated. Two actors (human and agent) work on one document.

**Product B.** Decomposition pipeline that converts a stabilized planning .md into a directory of task-oriented .md files (one per actionable unit). Subagents consume these tasks under an orchestrator that prevents context conflation.

**The seam.** Product A's output (a settled planning document) becomes Product B's input (source for task extraction and per-unit .md generation).

### Stated constraints

* Proof-SDK (EveryInc/GitHub) is unstable and unsuitable as a foundation. Reference only as an anti-pattern.
* soloterm.com is prior art for the runtime surface, not for the todo format. It is a process manager and terminal multiplexer, not a task tool.
* "Context never gets conflated" is a hard requirement for orchestrator and subagent design.
* Files live on the filesystem as .md, not in a hosted database.
* The agent produces the planning document first. Workflow engagement follows.

### User-named pain points

* Large planning documents are generated but lack a collaborative editing surface.
* No structured handoff exists from "big plan doc" to "actionable unit of work."
* When one agent handles too much scope, context conflation occurs.
* Existing tooling (proof-sdk) is too unstable to depend on.

### Opportunity hooks

* Live co-editing UX for the planning document.
* Automated or manual doc-to-tasks extraction step.
* Per-task .md file format and storage strategy.
* Orchestrator pattern: task selection, state tracking, subagent dispatch.
* Context isolation mechanism between parallel subagents.
* Terminal and scratchpad surfaces for per-agent working memory.

### Notable prior art and analogies

* **Proof / proof-sdk (Every, March 2026).** Character-level provenance, agent HTTP bridge, CRDT sync, accept/reject. Pre-release, no stable build.
* **Manus planner-executor split.** Originally one shared `todo.md`. Found that 1/3 of agent actions were wasted on list updates. Now splits planner (no execution tools) from executors (no planning).
* **Claude Code `.claude/agents/` and Gemini CLI `.gemini/agents/`.** Both converged independently on .md plus YAML frontmatter as the canonical subagent definition format.
* **MindStudio shared task list.** Atomic writes and file locking to claim tasks. File is the communication layer.
* **BMAD-METHOD.** Sharded `step-*.md` micro-files with HALT commands, `_memory/` sidecars, orient-first pattern.
* **Anthropic multi-agent research.** Orchestrator (Opus) with subagents (Sonnet) returning 1 to 2K token summaries. 90.2% gain over single-agent.
* **GitHub Agentic Workflows.** Markdown compiles to Actions YAML. Markdown-as-workflow is normalizing at platform level.
* **Cross-domain analogies.** Driver/navigator pair programming, editorial pipeline (writer + editor + fact-checker), CI/CD stages with declared artifacts, ROS actor model with typed topics.

## Topic Axes

1. Doc co-authoring surface (live edit UX for the big planning doc).
2. Decomposition seam (how a stabilized doc becomes per-unit task files).
3. Task file format (schema, status, lifecycle of a single .md task).
4. Orchestrator and dispatch (selection, routing, completion signaling).
5. Context isolation and per-agent memory (preventing conflation, scratchpads).

## Ranked Ideas

### 1. Frontmatter fragment graph is canonical; doc.md is a regenerated projection

**Description:** The big planning .md is not the source of truth. The canonical artifact is a directory of small typed YAML fragments (goal, constraints/, decisions/, tasks/) with declared relations in frontmatter (`derives_from`, `depends_on`). A regeneration step renders the long-form doc humans read. Edits to the doc round-trip back into the fragment graph, or get rejected as ambiguous. Agents only ever read and write fragments.
**Axis:** Doc co-authoring surface.
**Basis:** `external:` GitHub Agentic Workflows (Feb 2026) compiles markdown to Actions YAML rather than maintaining both, demonstrating "markdown as source, machine format as projection" at platform scale. `reasoned:` Most "context conflation" cases are two agents touching the same blob. Eliminating the blob eliminates the class.
**Rationale:** The doc-co-editing problem dissolves. Subagents read only the fragments declared in their `inputs:`, so isolation is structural rather than disciplinary. The doc the human reads is throwaway and re-renderable. There is nothing for two agents to fight over.
**Downsides:** Two-way sync (doc edits to fragments) is genuinely hard. Ambiguous edits must be rejected, or the model breaks. Net cost: a robust round-trip parser.
**Confidence:** 70%
**Complexity:** High
**Status:** Unexplored

### 2. Co-editing as turn-taking with explicit lockfile handoff (not CRDT real-time)

**Description:** Reject real-time concurrent editing. The doc has a `.lock` file naming the current owner. The human types `/agent` to hand the lock. The agent writes a section, ends with "HUMAN" and a 1 to 2K token status summary, then drops the lock. No presence indicator, no cursor sync, no CRDT.
**Axis:** Doc co-authoring surface.
**Basis:** `external:` MindStudio's atomic-write and file-lock pattern. Anthropic multi-agent research uses 1 to 2K token summary handback as the agent-to-orchestrator contract. `reasoned:` Proof-SDK's instability suggests real-time CRDT co-edit is overengineered when the human writes about 5% and the agent writes about 95% of the bytes.
**Rationale:** Removes the entire Proof-SDK dependency surface. Pair-programming research (driver / navigator) shows turn-taking outperforms simultaneous editing for cognitively heavy work. The handoff is also the natural moment for a structured summary, doubling as a context-isolation primitive.
**Downsides:** Feels primitive compared to real-time co-edit. "Who has the lock" becomes a hot question if multiple humans are involved (out of scope for this user, but may re-enter later).
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 3. Decomposition as parser side-effect of writing (no separate decompose step)

**Description:** Eliminate the "now decompose this" phase. When the agent writes fenced ` ```task ` blocks (or any section matching the task schema) into the planning doc, a deterministic post-write hook parses them and materializes `tasks/NNN.md` files with derived `depends_on` from textual references. The user never invokes decomposition. It is a side effect of saving the doc.
**Axis:** Decomposition seam.
**Basis:** `reasoned:` Current workflows treat decomposition as a discrete human-triggered phase. This is a friction point and a place where the human's mental model can diverge from the agent's. Making it deterministic (parser, not LLM) removes both. BMAD's `step-*.md` micro-files require an explicit HALT. Inline emission removes the halt.
**Rationale:** Collapses "produce doc, decompose, execute" into "produce doc; execution units exist." Phase boundaries are where state desyncs, so removing one removes a whole class of drift.
**Downsides:** Requires a stable schema for in-doc task blocks. Agents need to emit them faithfully. False positives (a code example that happens to match the task pattern) need a clear escape.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 4. Frontmatter-first task schema as the load-bearing interface

**Description:** A minimal, versioned YAML schema for `tasks/*.md`: `id`, `status`, `depends_on`, `owner_agent`, `inputs` (file paths and char ranges), `outputs` (artifact paths and acceptance), `subagent` (name@version), `provenance`. Optionally no prose body. If something cannot be expressed in the schema, the schema grows a field. Orchestrators, dispatchers, dashboards, kickoff prompts, and CI hooks all read this contract. Implementations behind it churn freely.
**Axis:** Task file format.
**Basis:** `external:` Claude Code's `.claude/agents/` and Gemini CLI's `.gemini/agents/` independently converged on .md plus frontmatter for subagent definitions. ROS typed topics succeeded because schemas were versioned and decoupled from node implementations.
**Rationale:** Once the schema stabilizes, every future tool becomes a parser of the same shape. Adding a new orchestrator, linter, viewer, status board, or dashboard costs hours, not weeks. The schema is the moat.
**Downsides:** Early schema choices have outsized cost. Versioning discipline (semver style) becomes load-bearing the moment downstream consumers exist. Rolling out v2 is non-trivial.
**Confidence:** 90%
**Complexity:** Low to Medium
**Status:** Unexplored

### 5. Sealed-context subagents via declared input contracts

**Description:** Subagents never see the parent plan, the global state, or each other. Each receives only its task file plus the files declared in its `inputs:` frontmatter, mounted into a fresh context. Returns a single `result.md` artifact and dies. If a task genuinely needs prior context, the file paths must be declared explicitly. Implicit context is unreachable. "Isolation" stops being a discipline problem and becomes a system property.
**Axis:** Context isolation and per-agent memory.
**Basis:** `external:` Anthropic multi-agent research reports a 90.2% gain over single-agent. The CI/CD stages analogy is structurally identical: each stage gets a clean environment, declared inputs, declared outputs. `reasoned:` You cannot violate what you cannot access.
**Rationale:** Directly satisfies the user's hard constraint ("context never gets conflated") at the architecture level rather than the prompt level. Matches the editorial pipeline and ROS actor analogies surfaced in grounding.
**Downsides:** Forces task authors to declare inputs explicitly. More upfront work than "just dump the plan in." Subagents that need ad-hoc exploration must declare an exploration phase.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 6. Per-task `.scratch.md` plus `.result.md` promotion; results seed a learnings corpus

**Description:** Every task gets two sidecar files. The subagent owns `task-NNN.scratch.md` exclusively for raw reasoning, dead ends, intermediates. Nobody else reads it. To complete, the subagent must write `task-NNN.result.md` in a fixed shape (decisions, artifacts produced, surprises, follow-ups). Only `.result.md` crosses the orchestrator boundary. A second projection step appends each `.result.md` to a `learnings/` corpus indexed by frontmatter tags. Future task kickoffs retrieve relevant entries.
**Axis:** Context isolation and per-agent memory.
**Basis:** `external:` Anthropic multi-agent research's 1 to 2K token summary handback pattern, externalized as a public file. `direct:` The user explicitly named "scratchpad ideas" as in-scope. `reasoned:` The promotion step is the discipline. It forces the subagent to compress signal vs. noise at the cheapest moment.
**Rationale:** Provides per-agent working memory without leaking it. The learnings corpus is a compounding asset: every completed task makes the next similar task cheaper, with zero manual upkeep. Survives session resets and model upgrades.
**Downsides:** File-naming convention becomes load-bearing once subagents coordinate through the filesystem. The retrieval step (learnings to kickoff prompt) needs a working index, which is a small but real piece.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 7. Deterministic orchestration: build-graph DAG over filesystem-as-protocol

**Description:** The orchestrator is not an agent. It is a deterministic walker over a DAG built from task frontmatter (`make`, `just`, or a small Python equivalent). Coordination signals are filesystem operations: `mkdir`-atomic locks, `rename(2)`-atomic claims (`task-007.todo.md` to `task-007.claimed.AGENT-ID.md` to `task-007.done.md`), `mtime` for presence, git for durability. Parallelism is `make -j`. Resuming after a crash is `make`. No server, no daemon, no CRDT, no LLM in the orchestration loop.
**Axis:** Orchestrator and dispatch.
**Basis:** `external:` MindStudio's atomic-write and file-locking precedent. Anthropic's 90.2% gain came from orchestrator plus subagent isolation, not from the orchestrator being LLM-driven. `reasoned:` POSIX `rename(2)` is atomic on the same filesystem. `mkdir` as mutex is a 50-year-old pattern. An LLM orchestrator adds nondeterminism, token cost, and compaction risk for zero scheduling benefit.
**Rationale:** Removes a whole class of orchestrator failures (hallucination, compaction loss in the orchestrator's own context). Workflow runs offline, in CI, on a server, on a plane. Survives vendor death and Proof-SDK-style instability. Free incremental rebuild, free DAG visualization, free dry-run from `make`.
**Downsides:** Less "magical." It does not make decisions, it just runs the graph. Smart routing (which subagent fits which task best) needs to be expressed declaratively in the schema, not inferred. Some users will want a smarter dispatcher.
**Confidence:** 85%
**Complexity:** Low to Medium
**Status:** Unexplored

## Cross-cutting observation

The seven survivors cluster into two natural product surfaces with one shared spine.

* **Product A (the doc)** is mostly #1 and #2. Fragment-graph-as-source plus turn-taking lockfile. Together these make Product A's claim on the user's workflow without depending on Proof-SDK at all.
* **Product B (decomp then orchestration)** is #3, #4, #5, #6, and #7. Automatic decomposition, the schema that makes it possible, sealed-context execution, scratchpad and result discipline, and a deterministic orchestrator over the filesystem.
* **The shared spine is #4 (frontmatter schema).** Every other survivor either reads or writes this format. Get the schema right and everything else is parser code.

One reframe worth carrying into brainstorming: #1 and #7 almost dissolve the original "two products" framing. If the doc is just a projection of the fragment graph, and the orchestrator just walks task frontmatter, Product A and Product B become one artifact with two views.

## Rejection Summary

| # | Idea | Reason rejected |
|---|------|-----------------|
| F1.1 | Pre-flight schema gate (50-line contract before body) | Subsumed by #4. Doc-level interface contract is a brainstorm variant of the schema idea, not a separate ideation candidate. |
| F1.2 | Stale-section detector with rewrite quarantine | High implementation cost (needs assumption-tracking) for moderate value. Better as a future feature once #1 lands. |
| F1.3 | Dependency-aware dispatch with blocked-task surfacing | Subsumed by #7. Dependency walk is what a build graph does for free. |
| F1.5 | Plan-doc heatmap of where review actually happened | Telemetry burden plus likely user pushback. Addresses a real but secondary failure mode. |
| F1.6 | Re-orient checkpoint (200-word orient block per task) | Subsumed by #5. The declared `inputs:` contract serves the orient role. |
| F1.8 | Failed-decomposition undo as first-class operation | Subsumed by #1. If the doc is a projection, "undo decomp" is just re-render. |
| F2.1 | Sketch-first, agent-fills (inverted authorship) | Strong but a brainstorm variant of #1, not a separate candidate. |
| F2.3 | Self-pulling tasks (no orchestrator) | Merged into #7. Filesystem-as-protocol covers the claim mechanism. |
| F2.6 | Agent self-review loop, human spot-checks only | Adjacent but a separate workflow stage (review). Better explored after #5 lands. |
| F3.1 | The plan is a git repo, not a document | Strong but overlaps with #1 plus #7. Git is one implementation of source/projection split. Bigger architectural bet than the user needs at ideation time. |
| F4.4 | Agent-bridge as open protocol, not editor feature | Ambitious leverage but premature. Protocols stabilize after one good implementation exists. Revisit post-V1. |
| F4.5 | Reusable named subagent library with versioned defs | Compounding asset, but downstream of #4. The schema has to stabilize first. Revisit after #4 lands. |
| F4.6 | Provenance and reversibility as frontmatter invariants | Partially absorbed into #4 (provenance field is in the schema). Change-log layer is separable as a follow-on. |
| F4.8 | Status as static HTML regenerated on every event | Subsumed by #1. status.html is one of the projections off the fragment graph. |
| F5.1 | ATC sector handoff for subagent scope | Strong analogy but overlaps with #5. The handoff ritual is implicit in the `inputs:` contract. |
| F5.2 | Surgical time-out ritual before decomposition commits | Subsumed by #3. If decomp is a parser side-effect, there is no "commit moment" to ritualize. |
| F5.5 | Submarine watch turnover log at session boundary | Adjacent to #6 at a different scope. Useful at multi-session scale but not in V1. |
| F5.8 | Open source patch series with maintainer dispatch | Strong protocol analogy, but #4 plus #7 cover the same ground with less ritual. |
| F6.2 | Haiku plans: 100-word planning doc as hard cap | The principle (plan = index, not container) is captured by #1. The 100-word ceiling is a brainstorm variant. |
| F6.3 | One task, infinite depth | Counter-position. Useful for discussion, not a candidate. "When do we earn the right to split?" is a brainstorm question. |
| F6.5 | Days-long marinade: latency as async forever | Reasonable cadence preference. Does not change the architecture, so not an ideation candidate. Compatible with all 7 survivors. |
| F6.7 | 100% reliability, every action replayable | Worthwhile, but the simpler git-based provenance in #4 covers V1 needs. Full event sourcing is a future bet. |
| F6.8 | Zero trust, mandatory human gate per bullet | Specific stance, not a workflow primitive. Orthogonal to the survivors and a brainstorm-time choice. |
