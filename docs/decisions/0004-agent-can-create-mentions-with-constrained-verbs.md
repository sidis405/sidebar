# 0004 — Agent can create Mentions with a constrained verb set

The **Agent** is permitted to create **Mentions** via the MCP `add_mention` tool. Agent-origin mentions use a separate verb namespace from human-origin mentions. Only input-request verbs (`clarify`, `decide`, `confirm`, `review`) are allowed. The agent cannot use action verbs (`rephrase`, `expand`, etc.) or arbitrary freeform verbs when creating mentions. Sidebar enforces this at the MCP boundary.

We considered restricting the agent to **Annotations** only (notes and suggestions). The problem with annotation-only is that annotations are passive: they sit until the human notices them. There are real situations where the agent needs a human decision before it can proceed (a fork in the plan, an ambiguous instruction, a destructive operation that needs sign-off). For these, lifecycle pressure is the point: the mention shows up in the pending panel, the file-tree counter, the gutter. The human resolves it explicitly or it stays open.

The constraint on verb vocabulary is the safeguard against agent over-flagging. Action verbs let one party ask the other to do work; sidebar reserves "ask to do work" for the human direction only. The agent can only ask for input. This is asymmetry via vocabulary, the same pattern used in Q5 for human verb policy.

A configurable rate limit caps the number of open agent-origin mentions at any time. Rejected `add_mention` attempts increment a counter exposed in the status drawer so the user can see whether the agent is over-asking or whether the limit is undersized.

Resolution by the human creates a `note` **Annotation** at the same target anchor carrying the human's answer. The agent reads this via `list_recent_changes` on its next poll.
