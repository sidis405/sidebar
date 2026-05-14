# QA

What you can do with Sidebar today. A living capabilities catalogue,
organized by feature, written from a user's perspective. Entries change
in place as features change; new features land as new sections. There
is no per-release log here, and there is no test-replay script — the
automated test suite and the PR description cover those.

## Open the editor on a project

In any project that has a `docs/` folder:

```
npx sidebar
```

A browser tab opens at `http://127.0.0.1:5180` (or the next free port
up through `5189`). The file tree on the left lists every markdown file
under `docs/`. Click any file to open it in the editor.

If `docs/` does not exist, sidebar offers three options interactively:
create `docs/` for you, accept a different glob, or quit. It does not
silently scan the whole project.

## Edit a markdown file

The editor renders headings, bold, lists, links, and code as you type.
Markdown syntax characters (`#`, `*`, fenced backticks) are visible
only on the line your cursor is on, hidden elsewhere. Code blocks get
syntax highlighting from the fence language tag (` ```ts `,
` ```python `, etc.).

Cmd-S saves. Nothing reaches disk until you save, so you can type
freely and dismiss without consequence. A blue ● next to the filename
(in the editor header and the file tree) means "unsaved".

## Manage files from the tree

Right-click any file or folder in the tree for:

- new file
- new folder
- rename
- delete (with a confirmation when the buffer is dirty)

Files outside the workspace glob stay invisible in the tree and in any
agent's view.

## Recover from a conflict

If something else writes the file you have open (another tool, an
agent, a `git checkout`), sidebar shows a side-by-side conflict modal:

- **keep yours** — discard the disk change and rebase your buffer
- **take theirs** — discard your buffer
- **merge view** — eyeball the diff, then decide

External changes to a file you do not have open just refresh the
tree.

## Survive a server drop

If the sidebar process restarts or the network blips, the editor tab
reconnects automatically with backoff (1 s, 2 s, 5 s, 10 s, then 30 s).
A small status indicator in the top right shows the current state.

Your dirty buffer survives the reconnect. If the disk content still
matches what you last saved, the buffer stays as-is; if disk has
changed in the meantime, the conflict modal fires on reconnect.

## Invite Claude Code (or another MCP-speaking agent)

In your project, once:

```
npx sidebar init claude-code
```

That writes a project-local `.mcp.json` that points Claude Code's MCP
client at sidebar. The next time you run Claude in this project, it
spawns sidebar automatically and joins the workspace — no copy-paste,
no MCP-config hunt.

`init` is idempotent: re-running updates the sidebar entry and leaves
any other entries in `.mcp.json` alone. The file is committed to git by
default.

V1 supports Claude Code and Compound's shared `.mcp.json` layout. Cursor,
Codex, and Aider variants land in V1.1.

## Attach an extra agent on the fly

If sidebar is already running (either standalone via `npx sidebar` or
spawned by an `init`-wired client), the URL it prints can be used to
attach additional MCP-speaking clients:

```
sidebar listening at http://127.0.0.1:5180
```

Point any MCP client at `http://127.0.0.1:5180/mcp` to read the
workspace through `list_docs` and `read_doc`.

## Tell sidebar where your docs live

Drop a `.sidebar/config.json` at the project root to override the
default `docs/**/*.md` glob:

```json
{
  "version": 1,
  "scope": "notes/**/*.md"
}
```

`.sidebar/config.json` is committed: it's how a project tells
contributors "this is where the docs live."

Pass `--scope "<glob>"` on the CLI to override the persisted scope for
a single boot.

## Add custom verbs

Same `.sidebar/config.json` extends the verb vocabulary used by
Mentions. Verb names must be lowercase with optional dashes
(`[a-z][a-z0-9-]*`). Redefining a built-in verb is refused on boot.

```json
{
  "version": 1,
  "verbs": {
    "human": {
      "tighten": { "mode": "replace" },
      "audit":   { "mode": "annotation" }
    },
    "agent": {
      "estimate": {}
    }
  }
}
```

Human verbs use `mode: "replace"` (the agent's response replaces the
target region inline) or `mode: "annotation"` (the agent's response
becomes a note next to the target). Agent verbs extend the whitelist of
verbs agents can use when they originate a Mention.

The built-in verb tables: see
[the spec](../specs/sidebar-v1-draft.md#verbs-v1-defaults).

## Pin a port or pick a browser (per-machine)

Drop a `.sidebar/local.json`:

```json
{
  "version": 1,
  "port": 5180,
  "browser": "default"
}
```

- `port` pins the HTTP port. Pass `--port <N>` to override for a
  single boot.
- `browser` accepts `"default"` (system default), `"none"` (do not
  launch a browser, just print the URL), or any name the
  [`open`](https://www.npmjs.com/package/open) package understands
  (`"chrome"`, `"firefox"`, ...).

`.sidebar/local.json` is per-machine. On first creation, sidebar
offers to add the file to `.gitignore`. On every subsequent boot it
emits a single-line stderr warning if the file is still committed.

## What sidebar refuses to do

These are deliberate guardrails. Sidebar refuses to start, with a
one-line error pointing at the offending file or flag, rather than
silently working around the problem:

- Invalid JSON or unknown top-level keys in `.sidebar/config.json`
  or `.sidebar/local.json`.
- A `version` other than `1` in either file (V2 migration hook).
- A type or out-of-range value (port outside `0`-`65535`,
  `maxOpen` below `0`, an unknown verb mode, an illegal verb name).
- A port you explicitly asked for (CLI or `local.json`) that is
  already in use — sidebar will not pick a different one.
- A `docs/` folder that does not exist when stdin is not a TTY and
  no `--scope` was provided.
- A second `npx sidebar` started in a project where one is already
  alive (the PID-alive check uses the `.sidebar/connection.json`
  discovery file).
- A Node version older than 20 LTS.

## Looking for...

- The reasoning behind any of the above: [`docs/decisions/`](../decisions/README.md).
- The full V1 spec: [`docs/specs/sidebar-v1-draft.md`](../specs/sidebar-v1-draft.md).
- Per-slice screenshots and CLI transcripts: the `docs/demo/` tree in the [GitHub repo](https://github.com/sidis405/sidebar/tree/main/docs/demo).
