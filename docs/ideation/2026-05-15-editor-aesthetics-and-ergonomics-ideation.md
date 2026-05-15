---
date: 2026-05-15
topic: editor-aesthetics-and-ergonomics
tool: sidebar
mode: ideation
status: draft
---

# Editor Aesthetics and Ergonomics Ideation

Quality-of-life improvements to make Sidebar pleasant to use before adding
more features. Not themes (the user can pick those later); just less rough
looking and less rough feeling. Issue #14 already exists ("Editor aesthetics
pass: colors, gutters, highlighting, typography"); this doc widens the scope
to cover ergonomics and writing-flow polish too.

The current styling is the Vite default in a suit: correct, generic,
neutral. What makes a markdown editor feel crafted rarely shows up in
feature lists.

Ordered from highest impact per hour of work to delightful but a real
undertaking.

## 1. Typography (the single biggest "rough" tell)

The current setup uses the OS system font for everything, the editor
equivalent of beige walls.

- **Prose font is not the same as UI font**. Keep system for chrome (file
  tree, drawer, header). Switch the editor surface to a body font tuned for
  long reading. Free, self-hostable picks: iA Writer Quattro, JetBrains Mono
  for code, Inter as a bulletproof UI fallback. Do not ship fonts in the npm
  tarball; offer them via CSS `@font-face` from `dist/static` so `docs/`
  users can swap.
- **Optical measure**. Cap the editor's line length to roughly 70 to 80
  characters (about 660px at 18px) and center the content. Currently the
  prose stretches to the full pane width, which is the most "this is a
  CodeMirror demo" tell. Reading research is annoyingly consistent on this;
  it just looks better and reads faster.
- **Honest type scale**. H1 does not really feel bigger than H3 right now.
  Pick a modular scale (1.25 or 1.333) and apply it. Heading weight 600 to
  700, body 400, code 450. Tighter line-height on headings, looser on body.
- **Code blocks should feel like code blocks**. Slightly inset background,
  monospace font, subtle border-radius. Inline `code` should have a soft
  fill, not just monospace.

## 2. Dark mode (table stakes in 2026)

Already wired-up architecturally via `:root` CSS variables, so the cost is
one well-tuned `@media (prefers-color-scheme: dark)` block plus a manual
toggle in the status drawer. Do not invent a palette; steal a known-good one
(GitHub dark, One Dark Pro, Nord, Solarized Dark) and tune the accent and
marker colors against it. The marker pills will need different luminance for
legibility on dark.

## 3. Editor surface QoL

Things you do not notice until they are missing.

- **Sticky heading at scroll**. The current H1 or H2 stays pinned at the top
  of the editor while you scroll past it. Notion and Bear both do this;
  once you have it, scrolling a long doc without it feels like getting lost.
- **Active line highlight**. Subtle (a few percent luminance off the
  background). CodeMirror has this built in; just enable and tune.
- **Caret personality**. Default CodeMirror caret is a thin line. Wider, no
  blink (or slow blink), accent-colored makes the editor feel less generic.
  Optional: animated caret movement for line and column jumps.
- **Smooth scroll on jump**. When you click an outline entry or Cmd-Click a
  marker, `behavior: smooth` instead of instant. Cheap, feels alive.
- **Soft cross-fade on file switch**. 100 to 150ms opacity transition on the
  content area between files. Hides the loading flash.

## 4. Markdown writing ergonomics

The "every editor has this and yours does not" details.

- **Smart list continuation**. Enter on a `- item` line creates `- ` on the
  next; Enter on an empty bullet deletes it. Same for numbered, blockquotes,
  and task lists.
- **Smart pairs**. Typing `(` inserts `()` and puts the caret between. Same
  for `[`, `{`, `"`, `` ` ``. Do not pair `'` (apostrophes in prose) or `*`
  (bold or italic, too aggressive).
- **Paste handling**. URL pasted onto a selection wraps as
  `[selection](url)`. Image from clipboard saves to `docs/assets/` (or
  configurable) and inserts the markdown reference. This one is bigger
  because it touches the workspace, but the UX win is huge.
- **Format hotkeys**. Cmd-B for bold, Cmd-I for italic, Cmd-K for link with
  a small input (collision with mention Cmd-K is fine if scoped by mode),
  Cmd-Shift-7 and Cmd-Shift-8 for ordered and unordered lists, Cmd-Shift-K
  for code. Cmd-1 through Cmd-3 for heading levels.
- **Auto-link bare URLs** as you type. Either real markdown rewrite or a
  decoration; decoration is safer.

## 5. Keyboard ergonomics

- **Cmd-Shift-P command palette**. The single biggest "this editor is real"
  affordance. Lists every action with its keybinding. Slice 9 ships Cmd-P
  for file jumps; Cmd-Shift-P for commands is the same pattern.
- **Vim mode toggle**. CodeMirror has `@replit/codemirror-vim`. Ship it
  behind a per-machine `local.json` setting. The crowd that wants it really
  wants it.
- **More keyboardable file tree**. Up and down to move, left and right to
  collapse, Enter to open, Space to preview. Today the tree is mouse-first.
- **Quick navigate to status drawer entry**. Cmd-Shift-A jumps focus into
  the activity log; arrows walk it; Enter scrolls the doc to the affected
  marker.

## 6. Status drawer and chrome polish

- **Time-grouped activity log**. "Today, 14:22, claude-code rephrased
  m-a3f9 in alpha.md" grouped under a "Today" header, then "Yesterday",
  then "Earlier this week." The flat reverse-chrono list gets dense fast.
- **Event-type filter chips**. Toggle mention, annotation, edit,
  agent-connect filters. One-line CSS pattern.
- **Better connection indicator**. Currently a `<span class="connection
  ${ws.state}">` is a class hook; the visual is probably a colored word.
  Make it a dot with a soft pulse during reconnecting, solid when connected,
  X when offline. Five lines of CSS.
- **Frosted-glass editor header**. `backdrop-filter: blur(8px)` on a
  translucent background. Modern, costs nothing.

## 7. Subtle distinctive moves

The things you remember about a tool a year later.

- **Verb-colored mention pills**. Today the pill says the verb. Color-code
  by verb category: action verbs in one hue, query verbs in another, custom
  verbs in neutral. Not so chromatic it is noisy; just enough to scan a long
  file and clock "this region has a `factcheck`, not a `rephrase`."
- **Author avatars**. The author field on a marker has a name
  (`claude-code`, `alice`, etc.). Render a 16px circle with the initial,
  color-derived from a hash of the name. No gravatar fetch, no network.
  Consistent across the file tree, drawer, side cards.
- **Empty state with personality**. The current `<div className="empty-state">`
  is probably blank. A single quiet sentence ("Pick a file from the left,
  or press Cmd-N to start one.") plus a `?` icon hover for keyboard
  shortcuts. Quiet design, but says "this thing was made by a person."
- **Reader mode toggle**. `Cmd-Shift-R` strips markers, mention pills, and
  gutters; renders the doc full-width with the prose font on a paper-tinted
  background. Useful for proofreading without the agent furniture. Bear and
  iA Writer both nail this.

## If there was a free afternoon

Picking by highest visible impact per hour:

1. **Typography pass** (font swap, measure cap, type scale). Half a day,
   massive feel change.
2. **Dark mode** with prefers-color-scheme. One to two hours.
3. **Smart list continuation plus smart pairs**. Two hours, prevents 90% of
   "ugh" moments while writing.
4. **Sticky heading on scroll**. 30 minutes, instant "wait this is nice."
5. **Command palette skeleton** (just the modal plus a few canned actions,
   expand later). Two to three hours.

Most of these are independent enough to ship as separate `feat:` PRs through
the same release pipeline. The typography pass is the highest leverage;
everything else compounds off it.
