# Slice NN QA

Replace `NN` with the slice number and rename this file to `slice-NN.md` when
authoring. The reviewer for the slice's PR reads this document end to end; if a
step is unclear here it is unclear.

## What this slice ships

One paragraph. State the user-visible capability the slice adds, in the
terminology from `CONTEXT.md`. No implementation detail.

## Setup

Exact, copy-pasteable commands to put the reviewer in a state where they can
exercise the slice. Include any required fixtures.

```
git fetch origin slice/NN-short-name
git checkout slice/NN-short-name
npm install
npm run build
```

Plus any per-slice setup (a tmp workspace, an env var, a fixture file). Use
`/tmp/sidebar-qa-slice-NN/` as the scratch directory so reviewers can clean up
with a single `rm`.

## Automated coverage

What tests already cover, so the reviewer does not redo work the runner did:

```
npm run test
npm run typecheck
```

List the test files relevant to this slice and the acceptance criteria each
file pins. One line per criterion, with the criterion text in quotes so a
reviewer can grep.

## Manual checks

Numbered checklist of every behavior an automated test cannot verify, with
exact steps. Each item is one observable behavior, not a screenful of context.
Prefer steps that produce a visible artifact (a screenshot the reviewer can
diff against `docs/demo/slice-NN/`).

1. **[ ] Acceptance criterion X.** Open `<file>`. Do `<action>`. Expect
   `<observation>`. Compare against `docs/demo/slice-NN/<image>.png`.
2. ...

## Demo replay

How to recreate every asset in `docs/demo/slice-NN/`, in order. The point is
not to validate the demo; it is to let a reviewer regenerate it after a code
change so the demo never goes stale.

## Known gaps

Anything intentionally out of scope for this slice that a reviewer might
otherwise flag. Link the slice number that covers each gap. If something is
out of scope and is **not** covered by a later slice, that is a missing
decision; file an issue rather than burying it here.
