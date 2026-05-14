# 0006 — Multi-agent connections permitted in V1

Sidebar's MCP server accepts multiple simultaneous client connections to the same workspace. V1 does not restrict the server to a single agent.

We considered the simpler stance of single-agent V1: the second MCP client to connect is rejected with an error, the user resolves at the MCP-client config layer. This collapses several edge-case categories (concurrent mention claims, per-agent rate-limit fairness, identity collisions, multi-agent status UX) and is the default many tools take.

We chose multi-agent permitted because the architectural cost is low and the use case is real. The MCP server is already a multi-client surface; rejecting the second connection is an explicit gate, not the absence of a feature. Real flows that justify multi-agent in V1: running Claude Code and Codex side-by-side on the same workspace to compare suggestions, handing off from a specialised research **Agent** to a writing **Agent** without restarting sidebar, and team setups where two humans each have their own agent attached to a shared local workspace during pairing.

The V1 invariant is "support the architecture, do not invest in per-agent UX." Concretely:

- `mark_in_progress(mention_id)` is exclusive. First caller wins; the loser gets a conflict error naming the winning client. This matches the optimistic-concurrency model on `resolve_mention` (Q6) and keeps the per-**Mention** semantics simple.
- The agent-mention rate limit (ADR-0004) is per-workspace, not per-agent. The limit is a noise floor on collective agent chatter, not a fairness mechanism between agents. Per-agent fairness can be added later without breaking history.
- The status drawer lists connected clients flat. No per-agent mention counts, no per-agent rate-limit gauges. Adding richer per-agent UX is reversible.
- Marker `author` carries the connecting client's `clientInfo.name`, with a counter suffix when two clients share a name simultaneously (`claude-code`, `claude-code-2`). Suffixes are computed at write time against the current set of live connections and do not survive reconnects.

The reason this is recorded as an **ADR** rather than left to the spec is reversibility. Once users build workflows that depend on more than one agent being connected at once, retreating to single-agent V2 is a breaking change. The decision is mildly hard to undo, the trade-off against the simpler single-agent stance is real, and the architectural commitment (multi-client MCP server, per-connection identity, exclusive mention claim) is load-bearing for several other V1 details. A future ADR may revisit if multi-agent flows surface real coordination pain that the V1 minimal stance cannot absorb.
