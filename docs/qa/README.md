# QA

What you can do with Sidebar today. A living capabilities catalogue,
organized by feature, written from a user's perspective. Entries change
in place as features change; new features land as new sections. There
is no per-release log here, and there is no test-replay script — the
automated test suite and the PR description cover those.

## Open the editor on a project

In any project that has a `docs/` folder:

```
npx sidebar-md
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

Mentions and annotations inside the file appear as dimmed begin/end
marker lines with a colored verb pill on the begin line. The file's raw
HTML comments are still on disk (any other markdown tool sees them as
comments), but the editor treats them as the lifecycle handles for
agent collaboration described below.

## Ask an agent to act on a region (Cmd-K)

Select the text you want the agent to look at, then press Cmd-K
(Ctrl-K on Linux/Windows). A small popover anchored to the selection
pops up. A top row offers three modes: `mention`, `note`, and
`suggestion`. The default mode is `mention`, which preserves the slice
4 verb flow.

In `mention` mode:

- start typing a verb to filter the built-in list (`rephrase`, `expand`,
  `shorten`, `remove-if-redundant` are action verbs that replace the
  region inline; `factcheck`, `question`, `review`, `explain` are query
  verbs that leave a note next to the region instead);
- arrow keys navigate the list, Enter inserts the marker;
- the optional second field carries a freeform instruction (sent verbatim
  inside the begin marker so the agent reads your intent);
- a verb you typed that is not in the list is accepted with a warning.
  At resolve time it falls back to annotation mode rather than silently
  rewriting prose.

In `note` and `suggestion` modes the verb autocomplete disappears. A
single textarea collects the annotation's body, which is markdown.
Cmd-Enter submits. See "Leave a note on a region (Cmd-K)" and "Propose
an edit as a suggestion (Cmd-K)" below for the per-mode details.

Submitting `mention` writes a
`<!-- @sidebar mention ... -->target<!-- @sidebar end -->`
pair to disk with a short id (`m-a3f9`-style), `origin="human"`, and your
author name (from `git config user.name` if a `.git/` is present, else
`$USER`, else the literal `human`). The begin line dims, a verb pill
appears in the gutter, and the mention shows up in the status drawer on
the right. Custom verbs from `.sidebar/config.json` show up in the
autocomplete the same way built-ins do.

If you select an empty region and press Cmd-K, the marker still wraps an
empty region. The editor flags it as **orphaned** with a red gutter and
the status drawer shows an "orphan" tag so you can right-click and
cancel it.

You need the file saved (Cmd-S) before Cmd-K writes anything. The
popover refuses while a buffer is dirty so the marker is never inserted
into a stale on-disk version.

## Leave a note on a region (Cmd-K, note mode)

Pick the `note` mode in the Cmd-K popover and type the note body. The
body is markdown; line breaks and formatting are preserved through to
the side card. Submitting writes a
`<!-- @sidebar note ... -->target<!-- @sidebar end -->`
pair to disk with a short id (`n-x7q2`-style), `author=` your resolved
name, and the body packed into the begin marker.

The note shows up as a side card on the right of the editor, anchored to
the region. The card body renders the markdown through the same
CodeMirror live-preview pipeline as the doc body, so what you see in
the card is what you would see if the content were inline. A note has
no lifecycle: it stays until you click Remove on the card (or the
agent that authored it calls `remove_annotation`).

An invited agent reads notes the same way the editor does, via the MCP
`list_annotations` tool. Notes are information only. They do not
authorize the agent to change prose.

## Propose an edit as a suggestion (Cmd-K, suggestion mode)

Pick the `suggestion` mode in the Cmd-K popover and type the proposed
replacement text. The body is markdown source; on accept it replaces
the target region verbatim with no further transformation. Submitting
writes a `<!-- @sidebar suggestion ... -->target<!-- @sidebar end -->`
pair on disk with an `s-q9k2`-style id.

The side card for a suggestion shows two buttons:

- **Accept** swaps the target prose for the proposed text (verbatim) and
  removes the annotation pair.
- **Reject** removes the annotation pair only; the target prose stays.

An invited agent can also originate suggestions via the MCP
`add_annotation(type='suggestion')` tool. The accept/reject UI is the
same: only the human can accept or reject. The agent never accepts its
own suggestion. (Asking the agent to accept its own suggestion via
`resolve_mention` is refused with a clear error pointing at
`add_annotation`.)

## Watch agent annotations land

Connected agents read and write annotations through MCP:

- `list_annotations(path?)` returns every annotation in the workspace
  with id, file, type, author, target_content, content, target_anchor,
  created_at.
- `add_annotation(path, target_anchor, type, content)` creates a note or
  suggestion. The agent's identity (from `clientInfo.name`) becomes the
  annotation's author.
- `update_annotation(id, content)` rewrites an annotation's body. The
  agent can only update annotations it authored.
- `remove_annotation(id)` strips an annotation pair. The agent can only
  remove annotations it authored. The target prose stays.

Annotations the agent creates show up live as side cards in the editor.
You see the agent's name as the card's author. The status drawer's
Recent activity logs `annotation-created`, `annotation-removed`,
`suggestion-accepted`, and `suggestion-rejected` events as they
happen.

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
npx sidebar-md init claude-code
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

## Watch an agent work a mention (status drawer)

The right side of the editor hosts a collapsible **status drawer**. It
shows everything you need to follow a collaboration without leaving the
file you're reading:

- **Pending mentions**. Every open mention across the workspace, with
  id, verb, author, and the file it lives in. Click a row to jump to the
  file. Right-click to **cancel mention**, which strips the begin/end
  pair from disk and leaves the target prose alone.
- **In progress**. Mentions currently claimed by an agent
  (`mark_in_progress`). Each row shows the claiming agent's name.
  Right-click any in-progress entry for **release stuck claim**, which
  drops the claim so another agent (or you) can move on. The marker
  stays in place.
- **Connected agents**. Every MCP client connected to this sidebar, with
  the name they self-declared in their `clientInfo` (Claude Code shows
  up as `claude-code`, etc.) and when they connected. Multi-agent
  collision suffixes (`claude-code-2`, ...) show up here when two
  agents share a name.
- **Recent activity**. The last 50 lifecycle events, newest first. Every
  mention create, claim, resolve, release, and cancel is in this log.
  Agents also poll this view (over MCP, via `list_recent_changes`) so
  they can react to your edits between turns.

The drawer refreshes live. There's nothing to poll manually.

## How an agent finishes the work

You don't drive this part; the agent does, over MCP. But the surface is
worth knowing about so you can debug a wedged collaboration:

- `list_pending_mentions` returns every open mention with target content
  and a short `base_hash` (16 hex chars, derived from sha256 of the
  target region).
- `mark_in_progress` claims a mention exclusively. A second agent that
  tries to claim the same mention gets a conflict error naming the
  winner.
- `resolve_mention` echoes the `base_hash` and an action: either
  `{ type: "replace", content }` (action verbs only; overwrites the
  begin/end pair plus the target region) or
  `{ type: "annotation", annotation_type: "note", text }` (works for any
  verb; turns the mention into a note alongside the original prose).
  A stale `base_hash` is refused so the agent re-reads via `get_mention`
  and tries again on the fresh content.
- `report_error` releases the claim without resolving; the marker stays
  open for you to retry or cancel.

You can edit the file while a mention is open. The mention persists, and
the agent works against whatever content the file holds at resolution
time. If the agent's claim is stale by the time it tries to write, the
`base_hash` mismatch refuses the write and the agent retries.

## Attach an extra agent on the fly

If sidebar is already running (either standalone via `npx sidebar-md` or
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

Custom human verbs land in the Cmd-K autocomplete alongside the built-ins
the next time the editor connects. A custom verb in the catalog is
respected at resolve time too: a `replace`-mode custom verb authorizes
the agent's inline rewrite; an `annotation`-mode one downgrades a replace
request the agent attempts.

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
- A second `npx sidebar-md` started in a project where one is already
  alive (the PID-alive check uses the `.sidebar/connection.json`
  discovery file).
- A Node version older than 20 LTS.

## Looking for...

- The reasoning behind any of the above: [`docs/decisions/`](../decisions/README.md).
- The full V1 spec: [`docs/specs/sidebar-v1-draft.md`](../specs/sidebar-v1-draft.md).
- Per-slice screenshots and CLI transcripts: the `docs/demo/` tree in the [GitHub repo](https://github.com/sidis405/sidebar/tree/main/docs/demo).
