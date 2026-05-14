# Slice 01 QA

## What this slice ships

The standalone sidebar editor surface: a single Node process that serves a CodeMirror 6 markdown editor over local HTTP plus a WebSocket, scoped to a configurable Workspace glob (default `docs/**/*.md`). The user runs `npx sidebar` in a project, the default browser opens to a bound port in 5180-5189, the file tree on the left lists every file matching the Workspace, and a click opens one file at a time. Files save manually with Cmd-S, the watcher refreshes the tree on external add/remove and the open buffer on external write, and a conflict modal offers keep-yours, take-theirs, or merge view when the buffer is dirty and disk content changes. No MCP, no markers, no Mentions or Annotations in this slice; those land in #2 through #11.

## Setup

```
git fetch origin slice/01-editor-shell
git checkout slice/01-editor-shell
npm install
npm run build
```

A scratch Workspace for manual checks (one markdown file in the root, one in a subfolder):

```
mkdir -p /tmp/sidebar-qa-slice-01/docs/notes
cat > /tmp/sidebar-qa-slice-01/docs/welcome.md <<'EOF'
# Welcome to sidebar

This is a **live preview** markdown editor. Move the cursor onto each
line to see the syntax characters appear and disappear.

## Features in slice 01

- File tree on the left
- Manual save with Cmd-S
- File watcher refreshes the tree on external changes
- Conflict modal when disk content races your buffer

### A code fence

```ts
function greet(name: string): string {
  return `hello, ${name}`;
}
```
EOF
echo "# scratch" > /tmp/sidebar-qa-slice-01/docs/notes/scratch.md
cd /tmp/sidebar-qa-slice-01 && node /path/to/sidebar/dist/server/cli.js
```

Replace `/path/to/sidebar/` with the absolute path to your checkout.

## Automated coverage

```
npm run test         # 36 tests across cli.test.ts, server-protocol.test.ts, unit.test.ts
npm run typecheck    # tsconfig.server.json + tsconfig.editor.json
```

Mapping from acceptance criterion to the test that pins it:

- "linear fallback through 5180-5189" — `test/cli.test.ts` *falls back through 5180-5189 when the first ports are taken*
- "prints the URL on stderr" — `test/cli.test.ts` *prints the bound URL on stderr*
- "`--port <N>` binds the requested port" — `test/cli.test.ts` *--port <N> binds the requested port*
- "`--port 0` OS-assigned" — `test/cli.test.ts` *--port 0 binds an OS-assigned port*
- "explicit port collision refuses with a clear error" — `test/cli.test.ts` *--port <N> refuses with a clear error when the port is taken*
- "`--browser none` skips browser launch; URL still prints" — `test/cli.test.ts` *--browser none skips launch but still prints URL*
- "docs/ missing -> prompt or refuse on non-TTY" — `test/cli.test.ts` *refuses to silently start when docs/ is missing and stdin is not a TTY*
- "`--scope <glob>` overrides default" — `test/cli.test.ts` *--scope overrides the default glob for the boot*
- "Ctrl-C releases the port" — `test/cli.test.ts` *releases the bound port on SIGINT* + *releases the port even with an open WebSocket client*
- "tree lists every file matching workspace glob" — `test/server-protocol.test.ts` *sends a tree containing every markdown file under docs/*
- "tree refreshes on external add/remove" — `test/server-protocol.test.ts` *emits treeChanged when a new file appears on disk* + *emits treeChanged when a file disappears*
- "open buffer refreshes on external write" — `test/server-protocol.test.ts` *emits diskChanged when an opened file is written externally*
- "Cmd-S saves; base-hash optimistic concurrency" — `test/server-protocol.test.ts` *save persists content and acks with the new disk hash* + *returns saveConflict when baseHash is stale*
- "tree CRUD" — `test/server-protocol.test.ts` *creates a new file*, *creates a new folder*, *renames a file*, *deletes a file*
- "files outside the glob are invisible" — `test/server-protocol.test.ts` *does not expose files outside the workspace glob* + *refuses to open files that do not match the workspace glob*
- "reconnect ladder 1/2/5/10/30s" — `test/unit.test.ts` *follows the 1s, 2s, 5s, 10s ladder* + *caps at 30 seconds*
- "Node 20+ baseline" — `test/unit.test.ts` *Node version baseline*
- Hardening from PR #12 review: backslash rejection, Origin check, rename non-clobber, strict `--port` parsing — `test/server-protocol.test.ts` and `test/unit.test.ts` *--port strict parsing*

## Manual checks

Run after the Setup section above. Each item names the acceptance criterion in parentheses, the action, and the expected observation. Compare against the corresponding image in `docs/demo/slice-01/` where listed.

1. **[ ] Browser auto-opens (AC1).** Run `node dist/server/cli.js` in `/tmp/sidebar-qa-slice-01`. Expect the user's default browser to open a new tab pointing at the bound URL within ~1 second. Confirm the URL is also printed on stderr.
2. **[ ] Live preview, cursor-on-line (AC6).** Open `welcome.md`. Place the cursor on the first line. Expect `# Welcome to sidebar` to show with the `#` visible AND the heading rendered larger/bolder than body text. Click into line 6. Expect `## Features in slice 01` on line 6 to show the `##` characters AND lines without the cursor (lines 3-5, 8-11) to show their markdown formatted without the raw `**`, `-`, `###`, etc. characters. Compare against `docs/demo/slice-01/02-editor-open.png`.
3. **[ ] Fence-language highlighting (AC6).** In the same file, the code block on lines 15-18 should show `function`, `string`, `return` in distinct colors (TypeScript grammar via `@codemirror/language-data` lazy load). Triple-backtick fence markers are hidden on non-cursor lines.
4. **[ ] File tree icons (AC7).** Confirm the file tree on the left shows a markdown icon (blue M) next to each `.md` file and a folder icon next to `notes/`. Click on `notes/` to expand; the folder icon opens. Compare against `docs/demo/slice-01/01-initial.png`.
5. **[ ] Context menu (AC8).** Right-click on `welcome.md` in the tree. Expect a menu with `new file`, `new folder`, `rename`, `delete`. Click `new file`. The browser prompt asks for a name; enter `extra.md`. Expect `extra.md` to appear in the tree at the root. Repeat for `new folder` with name `more`. Compare against `docs/demo/slice-01/05-context-menu.png`.
6. **[ ] Delete-with-confirm (AC8).** With `welcome.md` open and the cursor in the editor, type any character so the buffer is dirty. Right-click `welcome.md` in the tree, choose `delete`. Expect a `window.confirm` modal "welcome.md has unsaved edits. Delete anyway?". Cancel; the file remains. (Repeat with confirm accepted; the file should be removed.)
7. **[ ] Dirty indicator (AC10).** Open `welcome.md`, type any character. Expect a blue `●` next to `welcome.md` in the header AND next to the row in the tree. Press Cmd-S. Expect both dots to disappear. Compare against `docs/demo/slice-01/03-dirty-buffer.png`.
8. **[ ] Conflict modal (AC11).** Open `welcome.md`, type any character (do not save). From another shell, run `echo "tampered" >> /tmp/sidebar-qa-slice-01/docs/welcome.md`. Within a second the conflict modal appears with side-by-side YOURS (BUFFER) and THEIRS (DISK), plus buttons `merge view`, `take theirs`, `keep yours`, `close`. Verify each button: `keep yours` rebases on the new disk hash so the next save succeeds; `take theirs` discards your buffer and shows the disk content. Compare against `docs/demo/slice-01/04-conflict-modal.png`.
9. **[ ] Reconnect indicator (AC12).** With the editor tab open, find the sidebar process and send `SIGINT` (e.g. `pkill -INT -f 'dist/server/cli.js'`). Within 1-2 seconds the top-right indicator changes from green `connected` to amber `reconnecting (attempt N)...`. Restart sidebar; the indicator returns to `connected` and the editor re-fetches state without a manual reload. Compare against `docs/demo/slice-01/06-reconnecting.png`.

## Demo replay

Recreating each asset in `docs/demo/slice-01/`. The point is to let a future reviewer regenerate the screenshots after a code change so the demo never goes stale.

1. **CLI transcript (`cli-transcript.txt`).** The script that produced it lives only in the original session transcript; re-running by hand against the binary is fast. Boot sidebar with each flag combination (`--port 5277`, `--port 0`, `--port 5283` against a python-held blocker, `--browser none`, missing `docs/` with stdin closed, `--scope notes/**/*.md`), capture stderr, paste into the file. Each block in the transcript names the acceptance criterion it exercises.
2. **`01-initial.png`** — sidebar running against `/tmp/sidebar-qa-slice-01/`, no file open. Browser viewport 1400x900.
3. **`02-editor-open.png`** — open `welcome.md`, click on line 1 so the `#` shows but every other line is in live-preview mode.
4. **`03-dirty-buffer.png`** — same view, type a single character somewhere; capture before saving.
5. **`04-conflict-modal.png`** — with the dirty buffer from #4, append a line to the file from another shell. The conflict modal appears; capture immediately.
6. **`05-context-menu.png`** — close the modal, dispatch a synthetic `contextmenu` event on the welcome.md tree row (or right-click in a real session). Capture with the menu visible.
7. **`06-reconnecting.png`** — SIGINT sidebar, wait ~1s, capture the editor with the amber `reconnecting (attempt N)...` indicator in the top right.

The `agent-browser` skill was used to drive steps 2-7 in the original session. A real human session uses the actual right mouse button and OS shells; the artifacts are equivalent.

## Known gaps

Intentionally out of scope for slice 01, all covered by later slices:

- MCP server (transports, tools, `init`, description floor) — #2.
- Cmd-K mention creation, marker decoration as gutter bars / side cards / verb pills — #3.
- Mention lifecycle, `base_hash` optimistic concurrency from the agent side — #4.
- Annotations (notes and suggestions), accept/reject UI — #5.
- Agent-origin mentions, rate limit, counter — #6.
- Outline pane, mermaid rendering — #7.
- Workspace-wide ripgrep search — #8.
- Conflict UI polish beyond the V1 modal — already shipped in this slice; refinement lives in #9.
- Multi-agent UX, status drawer agent list, `connection.json` primary/proxy routing — #10.
- `scaffold-skill` subcommand — #11.
- Failure-mode polish (disconnect grace, malformed-marker decoration, port-fallback UX) — #12.

Anything else a reviewer flags as "missing" but does not appear in the slice's acceptance criteria nor in this list should be opened as an issue rather than absorbed into the slice; AGENTS.md scope discipline rules.
