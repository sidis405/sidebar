# sidebar-md

A local-first markdown editor with a co-author seat for your MCP-speaking agent.

`sidebar-md` runs as a single local process. It opens a CodeMirror-based editor in your browser and exposes a local [Model Context Protocol](https://modelcontextprotocol.io) server in the same process. Any MCP-speaking agent (Claude Code, Codex, Aider, Compound, anything that speaks MCP) can join your workspace on invite and collaborate on the markdown files you're reading.

Files stay on your disk. The agent stays in your terminal. Sidebar is the connective tissue between them.

```
npx sidebar-md
```

## What this gives you

A browser-based markdown editor scoped to your project's `docs/` folder (configurable). Live preview, syntax highlighting, manual save. Standard editor things.

A right-side **status drawer** that shows everything happening in your workspace: pending mentions, in-progress agent claims, connected agents, and the last 50 lifecycle events.

A **Cmd-K** popover on any text selection that lets you write three kinds of co-authoring markers directly into the file:

1. **Mentions**. A scoped, lifecycle-tracked ask aimed at an invited agent. Verbs like `rephrase`, `expand`, `factcheck`, `question`. The agent picks them up via MCP, claims them, and either replaces the text inline (action verbs) or leaves a note alongside it (query verbs).
2. **Notes**. A persistent side annotation. Pure information, no lifecycle. Either you or an agent can leave them.
3. **Suggestions**. A proposed replacement for a region. The agent or you can propose; only the human can accept or reject. Accept replaces the prose verbatim.

All three are HTML comments on disk. Any other markdown tool sees them as comments. Sidebar renders them as gutter pills, side cards, and verb bubbles.

An MCP tool surface the agent uses to participate: `list_docs`, `read_doc`, `list_pending_mentions`, `mark_in_progress`, `resolve_mention`, `list_annotations`, `add_annotation`, `update_annotation`, `remove_annotation`, `list_recent_changes`. The full surface is documented in [docs/qa/README.md](docs/qa/README.md) and [docs/specs/sidebar-v1-draft.md](docs/specs/sidebar-v1-draft.md).

A skill scaffolder (`npx sidebar-md scaffold-skill`) that drops an agent-facing instruction file into `.claude/skills/sidebar-collaboration/SKILL.md` (or any path you point it at). The skill teaches the agent how to behave around mention lifecycle, optimistic concurrency, and the dirty-buffer signal.

## Why this exists

Co-authoring with an agent on a long document is friction-heavy. You either babysit a chat (and lose context with every restart) or you let the agent rewrite blindly (and chase regressions). Sidebar puts the human and the agent on the same surface, with the file as the source of truth and HTML-comment markers as the lifecycle handles.

The permission model is deliberate. The agent reads freely. The agent edits prose only in two places: inside a **mention** you placed authorizing the edit, or via a **suggestion** that you accept. Anywhere else, the agent can only leave notes. No silent rewrites.

## Quick start

You need Node 20 or later.

### Standalone editor

In any project with a `docs/` folder:

```
npx sidebar-md
```

A browser tab opens at `http://127.0.0.1:5180`. The file tree on the left lists every markdown file under `docs/`. Click a file to open it.

If `docs/` does not exist, sidebar offers three options: create it for you, accept a different glob, or quit. It does not silently scan your whole project.

### Invite an MCP agent (one-time per project)

```
npx sidebar-md init claude-code
```

That writes a project-local `.mcp.json` entry pointing your agent's MCP client at sidebar over stdio. The next time you start your agent in the project, it spawns sidebar automatically and joins the workspace. No copy-paste, no MCP-config hunting.

`init` is idempotent. Re-running updates the sidebar entry and leaves unrelated entries in `.mcp.json` alone. V1 supports the Claude Code and Compound shared `.mcp.json` layout. Cursor, Codex, and Aider variants land in V1.1.

### Scaffold the agent skill (optional but recommended)

```
npx sidebar-md scaffold-skill
```

Writes `.claude/skills/sidebar-collaboration/SKILL.md` with the full mention round-trip protocol, verb tables, multi-agent etiquette, and conflict-handling rules. Claude Code and Compound auto-discover the skill on next start. For other agents, pass `--into <path>` to target a different location.

## How co-authoring works in 90 seconds

1. You open a markdown file and select a paragraph you want help with.
2. You press **Cmd-K** (or Ctrl-K on Linux/Windows). A small popover appears anchored to the selection.
3. You pick a mode: `mention`, `note`, or `suggestion`. Default is `mention`.
4. For `mention`, you type a verb (`rephrase`, `expand`, ...). Built-in verbs autocomplete. You can add a freeform instruction.
5. Submit. Sidebar writes a `<!-- @sidebar mention id="m-a3f9" verb="rephrase": tighten this paragraph -->target<!-- @sidebar end id="m-a3f9" -->` pair around your selection.
6. The agent, connected over MCP, sees the mention via `list_pending_mentions`. It claims it with `mark_in_progress`, reads the surrounding doc with `read_doc`, does the work, and calls `resolve_mention` with the new content and a `base_hash` confirming it operated on the version it claimed.
7. If you edited the region while the agent was working, the `base_hash` mismatches and sidebar refuses the write. The agent re-reads via `get_mention` and retries on the new content. No silent overwrites.

The whole thing happens with the file on disk as the source of truth. If you close sidebar mid-flight, the markers stay put. Re-open later, and the lifecycle picks up where it left off.

## A typical session

A short, real-feeling slice of what the surface looks like end to end:

```
$ cd my-project
$ npx sidebar-md init claude-code
sidebar init: wrote new ./.mcp.json
  agent:         claude-code
  mcpServers:    sidebar-md

Start claude-code in this project; it will spawn sidebar via stdio.

$ claude
# Claude Code spawns sidebar over stdio. A browser tab opens
# automatically. The agent says hello in the terminal.

# You select a paragraph in the editor, press Cmd-K, pick `rephrase`,
# and type "tighten this". A marker pair is written to disk:

<!-- @sidebar mention id="m-a3f9" verb="rephrase": tighten this -->
Your selected paragraph here.
<!-- @sidebar end id="m-a3f9" -->

# You watch the status drawer. The mention moves Pending -> In progress
# (with "claude-code" as the claimer). Seconds later, the marker pair
# disappears and the paragraph is replaced with the tightened version.

# You spot something you want to flag for later. Select another region,
# Cmd-K, pick `note`, type "double-check this stat". The annotation
# shows up as a side card on the right. Stays there forever, no
# lifecycle.

# You write a `suggestion` on a third region. The agent (or you) types
# the proposed replacement. The side card has Accept and Reject
# buttons. Accept replaces the prose verbatim.
```

## Configuration

Sidebar reads `.sidebar/config.json` (committed, team-shared) and `.sidebar/local.json` (gitignored, per-machine) from the project root. Neither file is created automatically. They appear lazily the first time you do something that needs persistence.

### `.sidebar/config.json`

```json
{
  "version": 1,
  "scope": "notes/**/*.md",
  "rateLimit": { "agentMentions": { "maxOpen": 5 } },
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

- `scope` overrides the default `docs/**/*.md` workspace glob.
- `rateLimit.agentMentions.maxOpen` caps concurrent agent-origin mentions.
- `verbs.human` extends Cmd-K's verb autocomplete with custom verbs in either `replace` mode (agent rewrites the region) or `annotation` mode (agent leaves a note).
- `verbs.agent` extends the whitelist of verbs agents can use when they originate a mention.

### `.sidebar/local.json`

```json
{ "version": 1, "port": 5180, "browser": "default" }
```

- `port` pins the HTTP port. CLI flag `--port` takes precedence per boot.
- `browser` accepts `"default"`, `"none"`, or any name the [`open`](https://www.npmjs.com/package/open) package understands (`"chrome"`, `"firefox"`, ...).

Sidebar refuses to start on invalid JSON, unknown top-level keys, a `version` other than `1`, an unknown verb mode, or a port that's already in use when you set it explicitly. No silent fallbacks.

### CLI flags

```
npx sidebar-md [--scope "<glob>"] [--port <N>] [--browser <name>] [--verbose|--quiet]
npx sidebar-md init [agent] [--yes]
npx sidebar-md scaffold-skill [--into <path>]
```

## How sidebar is built

One Node 20 process, written in strict TypeScript. The editor is a React 18 SPA built with Vite. The HTTP layer uses `node:http` plus `ws`. The MCP server uses the official `@modelcontextprotocol/sdk` over both stdio (the dominant agent-spawning path) and Streamable HTTP (standalone mode and additional-agent attach). State for transient runtime data (in-progress claims, dirty buffers, recent changes) lives in process memory. Persistent shared state lives in the markdown files themselves as HTML comments. There's no database, no sidecar files (aside from the optional `.sidebar/` config dir).

The full architecture, decision history, and acceptance criteria are documented in:

- [docs/index.md](docs/index.md): docs landing page.
- [docs/qa/README.md](docs/qa/README.md): living capabilities catalogue, written from a user's perspective.
- [docs/specs/sidebar-v1-draft.md](docs/specs/sidebar-v1-draft.md): the V1 design document. Every behavior in QA traces back to a section here.
- [docs/decisions/](docs/decisions/): architecture decision records.

## What sidebar does not do

These are deliberate, not gaps to fill later:

- No global config in `~/.sidebar/`. All configuration is project-scoped.
- No file logging. Logs go to stderr only.
- No telemetry. No phone-home, no crash reporter, no analytics.
- No daemon mode. Sidebar runs in the foreground. Ctrl-C cleanly shuts it down.
- No auto-update. Run `npx sidebar-md@latest` or `npm i -g sidebar-md` to upgrade.
- No file delete or out-of-glob writes by the agent.
- No agent-to-agent direct messaging. Sidebar mediates human-to-agent and agent-to-human only.

## Status

V1 is the current target. Slices 1 through 5 are merged (editor shell, MCP server over stdio plus HTTP, `init` and `.mcp.json` write, `.sidebar/` config, human-origin mentions, annotations). Slices 6 through 11 (agent-origin mentions with rate limiting, conflict modal, scaffold-skill, multi-agent identity, file tree CRUD, runtime polish) land in subsequent releases.

The codebase is small and the slice boundaries are documented. Contributions welcome via GitHub issues and PRs.

## Requirements

- Node 20 LTS or later.
- A POSIX-y filesystem (macOS, Linux, WSL). Native Windows is untested in V1.
- An MCP-speaking agent if you want the collaboration features. Sidebar runs perfectly well as a standalone markdown editor without one.

## License

MIT. See [LICENSE](LICENSE).
