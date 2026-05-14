# Sidebar docs

Sidebar is a local-first markdown reading and co-authoring surface for
a project's docs. It pairs a browser-based editor with a local MCP
server that any MCP-speaking agent (Claude Code, Codex, Aider, ...)
can join on invite.

## Where to start

- **[QA](qa/README.md)** &mdash; what Sidebar lets you do today,
  feature by feature, written from a user's perspective. The first
  stop if you want to know what the project ships.
- **[Spec](specs/sidebar-v1-draft.md)** &mdash; the V1 design document.
  Every behavior in QA traces back to a section here.
- **[Decisions](decisions/README.md)** &mdash; architectural decision
  records. The "why" behind everything that surprised someone.
- **[Ideation](ideation/2026-05-13-sidebar-ideation.md)** &mdash; the
  rough thinking that preceded the spec. Useful for archaeology, not
  for "how does this work today".

## Quick install

```
npx sidebar-md
```

In a project that has a `docs/` folder. A browser tab opens, the file
tree lists every markdown file under `docs/`. See [QA](qa/README.md)
for the full feature tour.
