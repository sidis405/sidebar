## What this slice ships

The first MCP cut: sidebar is now reachable as an MCP server, and an Agent
can be Invited to a project with one non-interactive command. Running
`npx sidebar init` (or `init claude-code`) writes a project-local
`.mcp.json` that points the Agent at `npx sidebar --stdio`. When the Agent
starts in the project, it spawns sidebar as a stdio subprocess; the
subprocess either becomes the primary (boots the editor, file watcher,
browser, plus stdio MCP transport) or a proxy that forwards MCP traffic to
the already-running primary's HTTP transport. Standalone `npx sidebar`
still works for human-only use and exposes the same MCP server over HTTP.
The MCP tool surface is read-only in this slice: `list_docs` and
`read_doc`, plus a Tier-1 server description that every connecting Agent
sees on `initialize`. Marker semantics, mention lifecycle, annotations,
and write tools land in slices 3 through 11.

## Setup

```
git fetch origin slice/02-mcp-init-readonly
git checkout slice/02-mcp-init-readonly
npm install
npm run build
```

Per-slice scratch Workspace (one markdown file at the root, one in a
subfolder, with a mention marker so the reviewer can see markers are NOT
stripped by `read_doc`):

```
mkdir -p /tmp/sidebar-qa-slice-02/docs
cat > /tmp/sidebar-qa-slice-02/docs/welcome.md <<'EOF'
# Welcome to sidebar (slice 02)

This file is read by both the editor (CodeMirror in the browser) and any
agent connected over MCP.

<!-- @sidebar mention id="m-welcome" verb="rephrase": tighten this paragraph -->
Sidebar is a local-first markdown editor with a co-author seat. The agent
joins on `npx sidebar init claude-code`. After that, starting Claude in
this project spawns sidebar as a subprocess.
<!-- @sidebar end id="m-welcome" -->

## Slice 02 ships

- An MCP server over stdio and HTTP.
- The `init` subcommand that writes `.mcp.json`.
- `list_docs` and `read_doc` read-only tools.
EOF
echo "# scratch notes" > /tmp/sidebar-qa-slice-02/docs/scratch.md
cd /tmp/sidebar-qa-slice-02
```

Replace `/path/to/sidebar/` with the absolute path to your checkout in the
manual checks below.

## Automated coverage

```
npm run test         # 52 tests across cli/server-protocol/unit/mcp suites
npm run typecheck    # tsconfig.server.json + tsconfig.editor.json
```

The mcp suite (`test/mcp.test.ts`) pins every acceptance criterion in
issue #2. Mapping (criterion text in quotes so a reviewer can grep):

- "`npx sidebar init` with no args detects supported MCP-speaking agents
  in the project and offers to wire them up; `init <agent>` wires up a
  specific one (V1: `claude-code` and the Compound shared `.mcp.json`
  layout)" -- `test/mcp.test.ts > CLI: init subcommand > init claude-code
  writes a .mcp.json with a sidebar entry that spawns --stdio` and
  `init --yes with no agent arg still writes a sidebar entry for
  claude-code`.
- "`init` writes/merges `.mcp.json` idempotently (re-running updates
  rather than duplicates the sidebar entry; existing unrelated entries
  are preserved)" -- `init is idempotent and preserves unrelated
  mcpServers entries`.
- "`init`-written entry spawns `npx sidebar --stdio`; the file is
  committed to git by default" -- `init claude-code writes a .mcp.json
  with a sidebar entry that spawns --stdio` (the spawn shape) plus
  `.gitignore` not listing `.mcp.json` (verified by inspection; the file
  is committed by default per ADR-0007).
- "`npx sidebar --stdio` becomes the primary instance if
  `.sidebar/connection.json` is missing or its `pid` is dead; otherwise
  it acts as a thin proxy forwarding stdio traffic to the primary's HTTP
  transport" -- `--stdio primary/proxy routing > becomes primary when
  connection.json exists but the recorded pid is dead` and
  `second --stdio while a primary lives joins as a proxy and shares MCP
  state`.
- "Primary `--stdio` invocation starts the same components as standalone
  mode (editor, file watcher, browser) plus stdio transport for the
  spawning agent" -- `--stdio primary: connection.json + side components
  > primary --stdio binds the HTTP listener so the editor is reachable`.
- "`.sidebar/connection.json` is written on primary boot with
  `{version, url, pid, started_at}` and removed on graceful shutdown;
  gitignored" -- `writes .sidebar/connection.json with
  version/url/pid/started_at on boot` and `removes .sidebar/connection.json
  on graceful shutdown`. The gitignored half is in slice 01's
  `.gitignore`.
- "Standalone `npx sidebar` refuses to start when a primary is already
  alive for the project, with a clear error pointing to the existing
  URL" -- `standalone: refuses while a primary is alive > npx sidebar
  refuses to start if .sidebar/connection.json points at a live primary`.
- "MCP server runs over stdio (primary `--stdio`) and HTTP (standalone and
  additional agent attach), built on `@modelcontextprotocol/sdk`" --
  the stdio side is covered by the `MCP server: stdio primary` suite;
  the HTTP side by `MCP server: HTTP transport (standalone) > exposes
  the same read tool surface over the Streamable HTTP endpoint`.
- "MCP tool `list_docs()` returns every file path in the workspace glob"
  -- `MCP server: stdio primary > list_docs returns every workspace path`.
- "MCP tool `read_doc(path)` returns full file content with markers NOT
  stripped, plus `is_draft: bool` and `draft_age_seconds: int` reflecting
  dirty-buffer state from the editor" -- `read_doc returns full content
  with markers intact and is_draft=false on clean buffer` plus
  `read_doc: is_draft reflects editor dirty buffer > is_draft=true and
  draft_age_seconds>0 after editor signals a dirty buffer`.
- "MCP `initialize` response includes a Tier-1 server description
  (200-400 tokens) covering: what sidebar is, the prose-edit permission
  model, the `base_hash` protocol, the `is_draft` signal, and a pointer
  to `npx sidebar scaffold-skill`" -- `initialize returns a 200-400
  token description covering the Tier-1 floor`.
- "Individual MCP tool handler errors return MCP error responses; only
  structural/unexpected errors crash the process" -- `read_doc on a
  non-existent path returns an MCP error response, not a crash` and
  `read_doc on a path outside the workspace glob returns an error
  response`.

## Manual checks

Run after the Setup section above. Each item names the acceptance
criterion in parentheses, the action, and the expected observation. Use
the absolute path to your checkout in place of `/path/to/sidebar/`.

1. **[ ] init writes `.mcp.json` (AC1, AC3).** From the scratch
   Workspace: `node /path/to/sidebar/dist/server/cli.js init claude-code`.
   Expect stdout `sidebar init: wrote new .../.mcp.json`. Inspect
   `.mcp.json`: under `mcpServers.sidebar` you should see
   `{"command": "npx", "args": ["sidebar", "--stdio"]}`. Compare against
   `docs/demo/slice-02/example-mcp.json`.
2. **[ ] init is idempotent and preserves unrelated entries (AC2).**
   Replace `.mcp.json` with a file that already has a different entry
   (e.g. an `other-thing` key under `mcpServers`). Re-run
   `init claude-code`. Expect `sidebar init: updated ...`, the
   `other-thing` block unchanged, and `sidebar` added next to it.
   Run init a third time: expect `sidebar init: left unchanged ...`.
   See `docs/demo/slice-02/init-transcript.txt` for the exact textual
   output.
3. **[ ] init with no args defaults to claude-code via `--yes` (AC1).**
   Remove `.mcp.json`. Run
   `node /path/to/sidebar/dist/server/cli.js init --yes`. Expect a
   single `sidebar` entry with the same shape as check 1.
4. **[ ] init prompts interactively when no agent is named and TTY is
   present (AC1).** Run `init` (no args) in a regular terminal. Expect
   the prompt "Which MCP-speaking agent should sidebar wire up?" with
   `[1] claude-code` and a default. Press Enter; expect the same file as
   in check 1. (Tests cover the non-TTY path; this exercises the prompt
   branch automated tests cannot drive.)
5. **[ ] Stdio + Tier-1 description (AC8, AC11).** Run the included MCP
   capture script (see "Demo replay" below) and read the recorded
   `initialize` response. The `instructions` text must be 200-400 tokens
   (the recorded transcript is 1280 chars / ~310 tokens) and mention all
   five required pieces: sidebar, the prose-edit permission model,
   `base_hash`, `is_draft`, and `npx sidebar scaffold-skill`. Diff
   against `docs/demo/slice-02/mcp-transcript.txt` to confirm shape.
6. **[ ] list_docs + read_doc over stdio (AC9, AC10).** In the same
   transcript, confirm `list_docs` returns both `welcome.md` and
   `scratch.md`, and `read_doc` returns the full body of `welcome.md`
   with the `<!-- @sidebar mention id="m-welcome" ... -->` and `<!-- @sidebar
   end id="m-welcome" -->` markers intact. `is_draft` should be `false`
   and `draft_age_seconds` should be `0` because no editor was open.
7. **[ ] read_doc handler error is an MCP error result, not a crash
   (AC12).** The same transcript also includes a deliberate
   `read_doc(no-such-file.md)` call. Expect a `CallToolResult` with
   `isError: true` and a human-readable text body. The connection is
   reused for the next call (or in the test harness, for a final
   `list_docs`) so a single error does not kill the server.
8. **[ ] Primary writes and removes `connection.json` (AC6).** Start
   the primary via `node /path/to/sidebar/dist/server/cli.js --stdio` in
   the scratch Workspace (you can drive it manually with the same
   capture script). Inspect `.sidebar/connection.json` while the process
   is alive; it should contain `version: 1`, the HTTP URL, the process
   PID, and an ISO timestamp. Send `SIGINT` to the primary (or close
   stdio from the client). The file should be removed within ~1 second.
9. **[ ] Standalone refuses while a primary is alive (AC7).** With a
   primary running (from check 8 or from `--stdio`), run
   `node /path/to/sidebar/dist/server/cli.js --browser none` in a second
   shell from the same Workspace. Expect stderr
   `primary sidebar already running at http://127.0.0.1:<port> (pid N).`
   and exit code `7`. (The PID-alive check is what gates this; if the
   primary was SIGKILLed without removing the file, the standalone will
   treat the file as stale, remove it, and start normally instead.)
10. **[ ] Browser auto-opens on primary boot, not on proxy (AC5).** Run
    `--stdio` directly (not via the capture script) with
    `SIDEBAR_OPEN=default` -- expect the default browser to open the
    primary URL. Then, while it is still running, run a second `--stdio`
    invocation from the same shell. The second invocation must not open
    a second browser tab; the spec says only the primary opens.
11. **[ ] `is_draft` flips with editor dirty state (AC10).** Open the
    editor in a browser tab against the primary's HTTP URL. Pick
    `welcome.md`. Type any character (do not save). Then, from a second
    MCP client (you can re-run the capture script with one extra
    `read_doc` call), call `read_doc(welcome.md)`. Expect `is_draft:
    true` and `draft_age_seconds` > 0. Press Cmd-S in the editor; call
    `read_doc` again. Expect `is_draft: false` and `draft_age_seconds:
    0`.

## Demo replay

Recreating each asset in `docs/demo/slice-02/`. The point is to let a
future reviewer regenerate the artifacts after a code change so the demo
never goes stale.

1. **`example-mcp.json`.** Run the Setup block above, then
   `node /path/to/sidebar/dist/server/cli.js init claude-code` and copy
   the resulting `/tmp/sidebar-qa-slice-02/.mcp.json` into
   `docs/demo/slice-02/example-mcp.json`.
2. **`init-transcript.txt`.** Reproduce the sequence shown in the file:
   pre-seed `.mcp.json` with an unrelated entry, run `init claude-code`
   to merge, re-run to see `left unchanged`, then exercise the
   standalone-refuse path by writing a `connection.json` with a live PID
   and running `npx sidebar` (the in-repo
   `node dist/server/cli.js --browser none` works). The slice tests
   exercise the same paths; this transcript is the human-readable
   companion.
3. **`mcp-transcript.txt`.** From the scratch Workspace, run the helper
   script committed alongside the demo:
   ```
   cd /tmp/sidebar-qa-slice-02
   cp -r /path/to/sidebar/node_modules ./node_modules
   cat > _capture-mcp.mjs <<'EOF'
   import { Client } from "@modelcontextprotocol/sdk/client/index.js";
   import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
   const transport = new StdioClientTransport({
     command: "node",
     args: [process.argv[2], "--stdio"],
     cwd: process.cwd(),
     env: { ...process.env, SIDEBAR_OPEN: "noop" },
     stderr: "ignore",
   });
   const client = new Client({ name: "demo-client", version: "0.1.0" }, { capabilities: {} });
   await client.connect(transport);
   const log = (label, value) => console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);
   log("initialize: serverInfo", client.getServerVersion());
   log("initialize: instructions (Tier-1)", client.getInstructions());
   log("tools/list", await client.listTools());
   log("tools/call list_docs", await client.callTool({ name: "list_docs", arguments: {} }));
   log("tools/call read_doc (welcome.md)", await client.callTool({ name: "read_doc", arguments: { path: "welcome.md" } }));
   log("tools/call read_doc (no-such-file.md) -> MCP error result", await client.callTool({ name: "read_doc", arguments: { path: "no-such-file.md" } }));
   await client.close();
   EOF
   node _capture-mcp.mjs /path/to/sidebar/dist/server/cli.js \
     > /path/to/sidebar/docs/demo/slice-02/mcp-transcript.txt
   ```
   The transcript captures every transition the slice promises:
   `initialize` (serverInfo + Tier-1 instructions), `tools/list`,
   `list_docs` success, `read_doc` success with markers intact, and a
   `read_doc` error result that does not kill the connection.

## Known gaps

Intentionally out of scope for slice 02, all covered by later slices:

- Marker decoration in the editor (gutter bars, side cards, verb pills)
  -- #3.
- Mention lifecycle and `base_hash` optimistic concurrency over MCP --
  #4.
- Annotations (`add_annotation`, `update_annotation`, `remove_annotation`)
  and suggestion accept/reject -- #5.
- Agent-origin mentions, rate limit, counter -- #6.
- Cursor, Codex, and Aider variants of `init` (this slice ships only the
  Claude Code / Compound shared `.mcp.json` layout) -- V1.1, tracked by
  ADR-0007.
- `scaffold-skill` subcommand (the Tier-2 ceiling). The Tier-1 floor
  this slice ships is the protocol baseline; users get the richer file
  via `npx sidebar scaffold-skill` in slice 11.
- Multi-agent UX, status drawer agent list -- #10. Slice 02 already
  supports two agents simultaneously via the primary/proxy fan-out, but
  the editor's visible agent list is a later slice.
- Disconnect-grace, malformed-marker decoration, port-fallback polish --
  #12.

Anything else flagged as "missing" but not listed here is a missing
decision; per AGENTS.md, file an issue rather than absorb it into this
slice.
