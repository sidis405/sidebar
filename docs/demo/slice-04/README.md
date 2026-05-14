# Slice 04 demo evidence

Human-origin mentions end-to-end. Transcripts here demonstrate every
acceptance criterion from issue #4 over the actual MCP and WebSocket
surfaces. The editor's visual layer (verb pill, status drawer right-click,
red-gutter decorations on malformed/orphan markers) is exercised by the
manual checklist in [`docs/qa/README.md`](../../qa/README.md) and the unit
tests under [`test/`](../../../test/).

| File | What it shows |
|------|---------------|
| [`cmdk-transcript.txt`](cmdk-transcript.txt) | Cmd-K editor flow. Editor pulls the verb catalog (built-ins), opens a file, selects "paragraph one\n", and asks the server to create a mention. Server resolves the human author (from git or `$USER`), generates an `m-XXXX` id, and writes a begin/end pair around the selection. |
| [`roundtrip-transcript.txt`](roundtrip-transcript.txt) | Full round trip. Human seeds a mention. An MCP-speaking agent calls `list_pending_mentions`, claims via `mark_in_progress`, resolves via `resolve_mention(replace, base_hash)`. Marker disappears on resolve (ADR-0002). `list_recent_changes` shows the claim and resolve events the status drawer renders. |
| [`malformed-transcript.txt`](malformed-transcript.txt) | Tolerant parse. A file with a missing end marker is skipped from `list_pending_mentions`, still readable via `read_doc`, and the server emits one stderr warning per affected file. |

Regenerate the transcripts:

```sh
cd /tmp && rm -rf sidebar-slice-04-{demo,cmdk,malformed}
mkdir sidebar-slice-04-demo && cd sidebar-slice-04-demo
node /path/to/sidebar/docs/demo/slice-04/_capture-roundtrip.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-04/roundtrip-transcript.txt

cd /tmp && mkdir sidebar-slice-04-cmdk && cd sidebar-slice-04-cmdk
node /path/to/sidebar/docs/demo/slice-04/_capture-cmdk.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-04/cmdk-transcript.txt

cd /tmp && mkdir sidebar-slice-04-malformed && cd sidebar-slice-04-malformed
node /path/to/sidebar/docs/demo/slice-04/_capture-malformed.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-04/malformed-transcript.txt 2>&1
```

## Manual editor checks (status drawer + decorations)

These are the parts that need eyeballs.

1. Run `npm run build && npm run dev` from a project that has a `docs/`
   folder. Open `http://127.0.0.1:5180`.
2. Open a markdown file. Select a paragraph. Press `Cmd-K` (or `Ctrl-K`).
3. The popover shows the built-in verb list. Type "tig" to filter, then
   press Enter. The file gains a `<!-- @sidebar mention ... -->` begin/end
   pair, and the editor renders the begin line dimmed with a verb pill.
4. Connect Claude Code (or any MCP-speaking agent) via
   `npx sidebar-md init claude-code`, then restart the agent. In the agent,
   call `list_pending_mentions`, `mark_in_progress`, `resolve_mention`.
5. The status drawer on the right reflects each step. The mention moves
   from "Pending" to "In progress" (with the agent's name) and disappears
   on resolve. Recent activity logs the events.
6. Right-click a pending mention in the drawer to see "cancel mention".
   Right-click an in-progress mention to see "release stuck claim".
7. Manually break a marker (delete its end line) and reopen the file. The
   gutter line goes red, `list_pending_mentions` no longer surfaces it,
   and one stderr warning fires.
