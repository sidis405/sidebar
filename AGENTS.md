# Agents working agreement

This document defines how an agent picks up and completes a sidebar issue. Read it before starting any slice.

## Scope discipline

Implement only the acceptance criteria of the issue you are working on. Do not start, finish, or refactor anything from another slice. If you discover that an adjacent slice contains a bug, a missing detail, or an ambiguity, leave a comment on that issue and stop. Do not bundle slices into one PR; the tracer-bullet design depends on each slice being independently mergeable.

## Language and prior decisions

Before writing code:

1. Re-read `CONTEXT.md` (the project glossary). Use exact terms from it in identifiers, comments, file names, commit messages, and PR text. Do not invent synonyms. The glossary is load-bearing across slices; vocabulary drift in one slice infects every slice after it.
2. Read every ADR in `docs/decisions/`, especially the ones linked from the issue's "Spec references" section. ADRs settle decisions. If your implementation would contradict an ADR, stop and post on the issue rather than improvising.
3. Read the spec sections referenced in the issue.

The tech stack is locked by [ADR-0008](docs/decisions/0008-typescript-monorepo-stack.md). Use the tools it names. Do not introduce a different language, framework, test runner, or formatter without a superseding ADR.

## Test-first contract

Your first commit on the branch must add a failing test (or test stub) for each acceptance criterion in the issue. Implement after. The final test file is what proves the slice is done. If a criterion is genuinely untestable in code (visual rendering, browser launch behavior, OS-default browser handoff), leave a comment in the test file explaining how a human can verify, and put the verification steps in the PR description.

## Demo evidence

When you open the PR, attach proof that the slice cuts through every layer it claims to:

* CLI features: a copy-pasted terminal transcript showing the feature working.
* Editor features: a short screen recording or annotated screenshot, committed under `docs/demo/slice-NN/`.
* MCP features: a copy-pasted MCP tool call and response transcript.

Tests prove correctness in isolation. The demo proves the slice works end to end.

## QA documentation

Sidebar keeps one QA document at `docs/qa/README.md`. It is a user-perspective capabilities catalogue organized by feature, not by release. Every slice that adds, changes, or removes a user-visible capability updates that file in the same PR.

The QA doc is not a per-slice verification script and not a test replay. Automated tests cover correctness; the PR description covers what changed; the QA doc covers what the system lets a user do at this commit. New features land as new sections (or as additions to an existing section); features that change get edited in place; features that go away get removed.

## Branch and PR convention

* Branch name: `slice/NN-short-name` (for example, `slice/01-editor-shell`).
* One slice per branch. Do not work on two slices in one branch.
* PR target: `main`.
* PR description: link the issue, lift the acceptance criteria into the PR body as a checkbox list, paste or link the demo evidence.

## Stop and ask

If you find an ambiguity, a contradiction with an ADR, a missing decision, or a state requirement that is not specified, do not guess. Post a comment on the issue describing the gap and stop. A human will resolve. You can resume after.

## Why this exists

Sidebar's V1 is being built as 11 parallel-trackable slices by autonomous agents. Without this agreement, agents drift in language, stack, scope, and verification, and the slices stop composing. The agreement is the contract that lets parallelism actually work.
