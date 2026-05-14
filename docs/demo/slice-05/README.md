# Slice 05 demo evidence

Annotations end-to-end (notes + suggestions). Transcripts here demonstrate
every acceptance criterion from issue #5 over the actual MCP and WebSocket
surfaces. The editor's visual layer (the annotation side card rendered
through the same CodeMirror live-preview pipeline as the doc body, the
Accept/Reject/Remove buttons, the Cmd-K mode toggle) is exercised by the
manual checklist in [`docs/qa/README.md`](../../qa/README.md) and the unit
tests under [`test/`](../../../test/).

| File | What it shows |
|------|---------------|
| [`note-roundtrip-transcript.txt`](note-roundtrip-transcript.txt) | Human creates a `note` via Cmd-K (driven through the WebSocket the same way the SPA does). The marker on disk uses the `<!-- @sidebar note ... -->` shape with the resolved human author. An MCP-speaking agent reads the note via `list_annotations` and sees the full record (id, file, type, author, target_content, content, target_anchor, created_at). |
| [`suggestion-accept-transcript.txt`](suggestion-accept-transcript.txt) | Agent posts a `suggestion` via `add_annotation(type='suggestion')`. The marker on disk uses the `<!-- @sidebar suggestion ... -->` shape with `author="claude-code"`. The human accepts via the side card. The target prose is swapped verbatim with the proposed text; the annotation pair disappears. `list_recent_changes` carries `annotation-created` and `suggestion-accepted` events. |
| [`suggestion-reject-transcript.txt`](suggestion-reject-transcript.txt) | Agent posts a `suggestion`; human rejects via the side card. The annotation pair disappears; the target prose stays unchanged. `list_annotations` returns `[]`; `list_recent_changes` carries `annotation-created` then `suggestion-rejected`. |

Regenerate the transcripts:

```sh
cd /tmp && rm -rf sidebar-slice-05-note && mkdir sidebar-slice-05-note && cd sidebar-slice-05-note
node /path/to/sidebar/docs/demo/slice-05/_capture-note-roundtrip.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-05/note-roundtrip-transcript.txt

cd /tmp && rm -rf sidebar-slice-05-accept && mkdir sidebar-slice-05-accept && cd sidebar-slice-05-accept
node /path/to/sidebar/docs/demo/slice-05/_capture-suggestion-accept.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-05/suggestion-accept-transcript.txt

cd /tmp && rm -rf sidebar-slice-05-reject && mkdir sidebar-slice-05-reject && cd sidebar-slice-05-reject
node /path/to/sidebar/docs/demo/slice-05/_capture-suggestion-reject.mjs /path/to/sidebar \
  > /path/to/sidebar/docs/demo/slice-05/suggestion-reject-transcript.txt
```

## Manual editor checks (side card + Cmd-K mode toggle)

These are the parts that need eyeballs.

1. Run `npm run build && npm run dev` from a project that has a `docs/`
   folder. Open `http://127.0.0.1:5180`.
2. Open a markdown file. Select a paragraph. Press `Cmd-K` (or `Ctrl-K`).
   The popover's top row shows three tabs: `mention` (slice-4 default),
   `note`, `suggestion`.
3. Switch to `note`. Type a markdown body. Cmd-Enter inserts a
   `<!-- @sidebar note ... -->` pair around the selection and a side card
   appears on the right with the rendered markdown.
4. Switch to `suggestion`. Type the proposed replacement text. Cmd-Enter
   inserts a `<!-- @sidebar suggestion ... -->` pair. The side card shows
   Accept and Reject buttons; the content panel renders the proposed
   markdown through the same CodeMirror live-preview pipeline as the main
   editor.
5. Click Accept. The target prose is swapped with the proposed text and
   the annotation card disappears. Click Reject on a different suggestion.
   The annotation disappears; the original prose stays.
6. Connect an MCP-speaking agent (Claude Code or any other) via
   `npx sidebar init claude-code`, then restart the agent. In the agent
   call `add_annotation(path=..., target_anchor={start, end}, type='suggestion', content='...')`.
   The new card shows up in the editor with the agent's name as author.
7. Status drawer's Recent activity shows the four new event kinds:
   `annotation-created`, `annotation-removed`, `suggestion-accepted`,
   `suggestion-rejected`.
