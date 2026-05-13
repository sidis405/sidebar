# 0005 — Manual save with dirty-buffer signal to the agent

Sidebar's editor saves files only when the user explicitly invokes save (Cmd-S). There is no autosave on focus loss, on tab close, on timer, or on every keystroke. The editor displays a dirty-buffer indicator (asterisk on the filename) when the in-memory buffer has unsaved changes.

We considered autosave on focus loss as the V1 default. The user objected: blur saves silently commit edits that may have been experimental. The intent of "type something, then click away to abandon it" is destroyed.

We considered autosave on every keystroke (debounced). The disk always reflects the editor, which is desirable for agent coordination, but it shifts the "abandon experimental edits" workflow onto the editor's undo stack, which is fragile across sessions and harder to recover.

We chose manual save because it preserves the user's control over what reaches disk. This introduces a coordination problem: the **Agent** reads files from disk via MCP, not from the editor's buffer. With manual save, the agent can read a stale version while the user has unsaved edits.

The mitigation is an MCP-level signal: `read_doc(path)` returns the disk content plus `is_draft: bool` and `draft_age_seconds: int` reflecting whether the editor has an unsaved buffer for that file and how long it has been dirty. The scaffolded co-author skill instructs the agent's behavior: when `is_draft=true`, the agent should either skip the file or create an agent-origin **Mention** with verb `clarify` asking the human whether to wait. The agent's exact response is up to its system prompt; sidebar's responsibility ends with exposing the signal.

Conflict case: when the user has a dirty buffer and the agent writes the same file via `resolve_mention`, the agent's write reaches disk. The editor detects the change-with-dirty-buffer state and presents a conflict modal: keep yours, take the agent's, or merge view. The same conflict UI handles any external write (other tool, git operation) racing the editor.
