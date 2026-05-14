# Slice 1 — manual verification checklist

Some acceptance criteria for issue #1 are visual or depend on the user's
default browser. These are noted here per the AGENTS.md test-first contract,
which allows human-only verification for criteria that are genuinely
untestable in code.

Each checkbox must be confirmed before opening the PR; results are pasted
into the PR description alongside the test transcript and screen capture.

## How to run

1. `npm run build`
2. `cd <some project with a docs/ folder>`
3. `node /path/to/sidebar/dist/server/cli.js`
4. Watch the terminal for the printed URL.
5. The default browser should open to that URL.

## Criteria covered here

- [ ] **AC1 (browser launch)** — running `npx sidebar` opens the user's
      default browser to the printed URL. Implementation calls the `open`
      package; this is a one-shot side effect not easily asserted in code.
- [ ] **AC6 (live preview)** — markdown syntax characters (`#`, `**`, list
      markers, link brackets) are visible only on the line containing the
      cursor; on other lines the rendered formatting is shown. Code fences
      render with syntax highlighting picked from their info string
      (` ```ts `, ` ```python `, etc.).
- [ ] **AC7 (file tree visuals)** — left pane shows `react-arborist` tree
      with `vscode-icons` for each file. Click selects + opens.
- [ ] **AC8 (context menu)** — right-clicking a file or folder shows the
      menu `new file`, `new folder`, `rename`, `delete`. Choosing `delete`
      on a file with an unsaved buffer shows an extra confirmation modal.
- [ ] **AC10 (dirty indicator)** — typing in the editor surfaces a `●`
      (or asterisk) next to the filename in the header until Cmd-S.
- [ ] **AC11 (conflict modal)** — with unsaved edits in the editor, modify
      the same file with another tool (e.g. `echo "x" >> docs/foo.md`).
      The editor shows a conflict modal offering `keep yours`,
      `take theirs`, and a side-by-side `merge view`.
- [ ] **AC12 (reconnect indicator)** — kill the sidebar process while the
      browser tab is open; restart it. The tab shows a "reconnecting..."
      indicator and recovers without a manual reload, following the
      1s/2s/5s/10s ladder (subsequent attempts capped at 30s).

The non-visual reconnect ladder values are also asserted in
`test/unit.test.ts`. The other criteria above are validated end to end by
the `test/server-protocol.test.ts` suite operating against the live server
process.
