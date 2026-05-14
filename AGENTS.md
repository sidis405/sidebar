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

## Conventional commits

Every PR title must follow [Conventional Commits](https://www.conventionalcommits.org/). The `.github/workflows/pr-title.yml` workflow blocks merge until the title parses. Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`, `test`, `build`, `ci`, `style`, `revert`.

The PR title is what release-please reads (squash-merge inherits the title as the commit subject), so the type drives both the changelog and the next version bump:

* `feat:` ⇒ minor bump (`0.1.0` → `0.2.0` while pre-1.0; `1.0.0` → `1.1.0` after).
* `fix:` / `perf:` / `refactor:` / `docs:` ⇒ patch bump.
* `feat!:` or any commit body with `BREAKING CHANGE:` ⇒ major bump.
* `chore:`, `ci:`, `build:`, `test:`, `style:` are hidden from the changelog and do not bump.

Pre-1.0, release-please is configured so `feat:` produces a minor bump and `fix:`/`refactor:`/`docs:` produce patch bumps (`bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: true`). After 1.0.0 this auto-flips to the standard semver mapping.

## Releasing

`sidebar-md` is published to npm by GitHub Actions, never from a maintainer laptop. Releases are automated end to end via [release-please](https://github.com/googleapis/release-please). There are no manual version bumps and no manual tags.

### How a release happens

1. PRs merge into `main` with Conventional Commit titles.
2. The `release` workflow runs on every push to `main`. release-please scans commits since the last release tag and, if there's anything releasable, opens (or updates) a **release PR** titled like `chore(main): release 0.2.0`. The PR bumps `package.json` and `.release-please-manifest.json`, and writes `CHANGELOG.md`.
3. A human reviews the release PR and merges it. (This is the only manual step.)
4. release-please runs again on the merge commit, creates a GitHub Release + git tag (`vX.Y.Z`), and emits `release_created=true`.
5. The `publish` job in the same workflow picks that up, runs `typecheck` / `test` / `build` again on the tagged commit, and publishes to npm with `npm publish --provenance --access public`. The provenance attestation links the tarball to the exact commit and workflow run.

A republish of an existing version is refused by the workflow (it consults `npm view` first). The whole loop is idempotent: re-running on the same merge commit publishes nothing.

### One-time npm setup (Trusted Publishing)

The publish job authenticates to npm via OIDC, not a long-lived token. To enable that, the package owner registers this repo and workflow as a trusted publisher on npmjs.com (one-time, web UI only):

1. Visit https://www.npmjs.com/package/sidebar-md/access and sign in.
2. Scroll to **Trusted publishers**. Click **Add trusted publisher**.
3. Pick **GitHub Actions**. Fill in:
   * **Organization or user**: `sidis405`
   * **Repository**: `sidebar`
   * **Workflow filename**: `release.yml`
   * **Environment name**: leave blank.
4. Save.

Once registered, the workflow publishes without any `NPM_TOKEN` secret. Any pre-existing publish tokens for this package should be revoked at https://www.npmjs.com/settings/sidis405/tokens.

### Local sanity before opening a PR

The CI workflow runs typecheck, test, and build on every PR. Running them locally first avoids the round-trip:

```
npm ci && npm run typecheck && npm run test && npm run build
```

### When something goes wrong

* **release-please PR is wrong (e.g. wants to bump to the wrong version)**. Close it. Fix the offending commits on `main` (revert or `git commit --amend` is not possible after merge, so use a follow-up PR with a corrective Conventional Commit). release-please opens a new release PR on the next push.
* **CHANGELOG.md is missing an entry you wrote**. Check the PR title's commit type. `chore:`, `ci:`, `build:`, `test:`, `style:` are hidden by design. Use `docs:` or `refactor:` if it should appear.
* **Publish job fails on OIDC error**. The trusted publisher entry on npmjs.com is missing or pointed at a different workflow filename. See the one-time setup above.

## Why this exists

Sidebar's V1 is being built as 11 parallel-trackable slices by autonomous agents. Without this agreement, agents drift in language, stack, scope, and verification, and the slices stop composing. The agreement is the contract that lets parallelism actually work.
