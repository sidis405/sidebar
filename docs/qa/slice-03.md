## What this slice ships

Project-scoped persistent **Sidebar** configuration via two files at
`.sidebar/` in the project root. `.sidebar/config.json` is committed and
team-shared (workspace `scope`, agent-mention rate limit, custom verbs).
`.sidebar/local.json` is gitignored and per-machine (`port`, `browser`
launch target). Neither file is created on a plain `npx sidebar` boot;
both appear lazily the first time a future slice (or the demo driver
script) calls the writer API. The loader is strict: invalid JSON,
unknown top-level keys, schema mismatches, or out-of-range values refuse
to boot with a clear error pointing at the file and the offending field.
Verb subsystem: built-in tables for human-origin and agent-origin
**Mentions**, extensible via `verbs.{human,agent}` in `config.json`;
redefining a built-in is a load error. The catalog produced by
`buildVerbCatalog` is the public API slices 4-6 consume.

## Setup

```
git fetch origin slice/03-config-files
git checkout slice/03-config-files
npm install
npm run build
```

Per-slice scratch workspaces (one per manual check). The QA doc reuses
`/tmp/sidebar-qa-slice-03/` as the root so reviewers can clean up with
one `rm -rf`.

```
SCRATCH=/tmp/sidebar-qa-slice-03
rm -rf "$SCRATCH"
mkdir -p "$SCRATCH/docs"
printf '# fresh\n' > "$SCRATCH/docs/welcome.md"
```

Replace `/path/to/sidebar/` with the absolute path to your checkout in
the manual checks below.

## Automated coverage

```
npm run test         # 104 tests across cli/server-protocol/unit/mcp/config/verbs suites
npm run typecheck    # tsconfig.server.json + tsconfig.editor.json
```

`test/config.test.ts` and `test/verbs.test.ts` pin every acceptance
criterion from issue #3. Mapping (criterion text in quotes so a reviewer
can grep):

- "`.sidebar/` directory and files are created lazily on first
  persistent write" --
  `config: lazy creation on boot > standalone boot does not create .sidebar/ at all`,
  `--stdio boot creates connection.json but neither config.json nor local.json`,
  `persistLocal creates .sidebar/local.json on first call (lazy)`,
  `persistConfig creates .sidebar/config.json on first call (lazy)`.
- "`config.json` schema: `{version, scope, rateLimit, verbs}`" --
  every test in `config.json: schema validation` (rejects on each shape
  mismatch; accepts the valid shape).
- "`local.json` schema: `{version, port, browser}`" -- every test in
  `local.json: schema validation`.
- "Both files validate at load time ... refuse to start with a clear
  error pointing at the file and field" --
  `CLI: refuses to start on invalid config > rejects invalid JSON with a message pointing at the file`,
  `rejects a bad version with a message pointing at the field`,
  `rejects an unknown top-level key with a message naming the key`.
- "`version` other than `1` is a load error in both files" --
  `config.json: schema validation > rejects version other than 1`,
  `local.json: schema validation > rejects version other than 1`,
  `rejects missing version`.
- "`scope` in `config.json` is the persistent default workspace glob;
  `--scope` CLI flag overrides for one boot" --
  `CLI: persisted scope from config.json > config.json scope is honored when --scope is absent`,
  `--scope on the CLI overrides config.json for one boot`.
- "`port` in `local.json` is the persistent default port; `--port` CLI
  flag overrides for one boot; explicit port collision refuses (no
  fallback)" --
  `CLI: persisted port from local.json > local.json port is honored when --port is absent`,
  `--port on the CLI overrides local.json for one boot`,
  `local.json port collision refuses to start (no fallback)`.
- "`browser` accepts `\"default\"`, `\"none\"`, or a platform-specific
  identifier" --
  `local.json: schema validation > accepts browser value 'none'`,
  `accepts an arbitrary platform-specific browser identifier`,
  `CLI: persisted browser from local.json > local.json browser=none short-circuits launch`.
- "`verbs.human.<verb>.mode` accepts `\"replace\"` or `\"annotation\"`;
  redefining a built-in verb is a load error; verb name must match
  `[a-z][a-z0-9-]*`" --
  `config.json: schema validation > rejects redefining a built-in human verb`,
  `rejects redefining a built-in agent verb`,
  `rejects human verb mode outside {replace, annotation}`,
  `rejects verb name that does not match [a-z][a-z0-9-]*`,
  `accepts a custom human verb in the allowed shape`.
- "`verbs.agent.<verb>` entries extend the agent verb whitelist
  (consumed by later slices)" --
  `config.json: schema validation > accepts a custom agent verb in the allowed shape`
  plus the `verbs: buildVerbCatalog > merges a custom agent verb`
  test in `test/verbs.test.ts`.
- "On creation of `.sidebar/local.json`, sidebar checks for `.git/`;
  if present and `local.json` is not already ignored, offers to append
  it to `.gitignore` and proceeds either way" --
  every test in `gitignore offer on local.json creation`: the absent,
  already-ignored, appended, declined, missing-`.gitignore`, only-on-
  creation, and double-add-guard paths.
- "If `local.json` exists and is still unignored, every subsequent boot
  emits a single-line stderr warning; no persistent dismissal flag" --
  `CLI: unignored-local warning at boot > emits a single-line stderr warning when local.json is unignored`,
  `does not warn when local.json is already gitignored`,
  `does not warn when .git/ is absent`.
- "Logs go to stderr at INFO by default; `--verbose` raises to DEBUG,
  `--quiet` lowers to WARN" -- already pinned by slice 01 (see
  `src/server/log.ts`); this slice consumes it via the
  `unignored-local` warning emitted at INFO.

## Manual checks

Each item names the acceptance criterion in parentheses, the action,
and the expected observation.

1. **[ ] Standalone boot leaves the working tree untouched (AC1).**
   `cd $SCRATCH; ls -A .` shows only `docs`. Then
   `SIDEBAR_OPEN=noop node /path/to/sidebar/dist/server/cli.js --browser none --port 0`
   in another shell, Ctrl-C after a moment, and `ls -A .` again.
   Expected: still only `docs`; no `.sidebar/` directory, no
   `config.json`, no `local.json`. Compare against
   `docs/demo/slice-03/lazy-creation-transcript.txt`.
2. **[ ] --stdio boot only creates `.sidebar/connection.json` (AC1).**
   With the same scratch tree, run
   `SIDEBAR_OPEN=noop node /path/to/sidebar/dist/server/cli.js --stdio &`
   and `ls -A .sidebar/` while alive. Expected: `connection.json` only.
   Compare against `lazy-creation-transcript.txt`.
3. **[ ] gitignore-offer prompt fires on first local.json creation
   (AC11).** Initialise a git repo with a minimal `.gitignore`, then
   run the demo driver. The driver invokes `persistLocal(cwd, {port:
   5555})`, sees `.git/` plus an unignored state, prompts for consent,
   and (on `y`) appends the line. Replay:
   ```
   cd $SCRATCH; git init -q .; printf 'node_modules\n' > .gitignore
   printf 'y\n' | node /path/to/sidebar/docs/demo/slice-03/_capture-config.mjs /path/to/sidebar
   ```
   Compare against `docs/demo/slice-03/gitignore-offer-transcript.txt`.
   Repeat with `printf 'n\n'`; expect `gitignoreAction: "declined"` and
   no change to `.gitignore`. Repeat with the line already present;
   expect `gitignoreAction: "already-ignored"`.
4. **[ ] Per-boot unignored-local warning fires once and only once
   (AC12).** Set up a workspace with `.git/`, a `.gitignore` that does
   NOT mention `.sidebar/local.json`, and a hand-written
   `.sidebar/local.json` (the simulated post-decline state). Boot
   sidebar (`--browser none --port 0`). Expect one stderr line:
   `warning: .sidebar/local.json exists in this project but is not gitignored. Add it to .gitignore (per-machine state should not be committed).`
   Add the line to `.gitignore` and boot again. Expect no warning.
   Compare against `docs/demo/slice-03/unignored-warning-transcript.txt`.
5. **[ ] Strict validation refuses with a clear error and exit code 8
   (AC4, AC5).** Four sub-cases, each in a fresh scratch directory:
   ```
   printf '{ not json'                                                 > .sidebar/config.json   # invalid JSON
   printf '{ "version": 2 }\n'                                          > .sidebar/local.json    # version != 1
   printf '{ "version": 1, "mystery": true }\n'                         > .sidebar/config.json   # unknown key
   printf '{ "version": 1, "verbs": { "human": { "rephrase": { "mode": "annotation" } } } }\n' > .sidebar/config.json  # redefining built-in
   ```
   Run sidebar after each. Expected stderr lines and exit codes are in
   `docs/demo/slice-03/config-error-transcript.txt`. All four exit with
   code 8 (config-load-error), distinct from 4 (port collision), 5
   (missing workspace), and 7 (stale primary already alive).
6. **[ ] CLI > local.json > built-in default precedence for port
   (AC7).** With `.sidebar/local.json` set to `{"version":1,"port":5291}`
   and no other args, boot sidebar; expect bind at 5291. Re-run with
   `--port 5292`; expect bind at 5292 and `.sidebar/local.json`
   untouched on disk. Re-run with no flag and a different process
   holding 5291 ahead of time; expect refuse-to-start with exit 4 (no
   fallback through the 5180-5189 range — explicit ports refuse on
   collision, identical to slice-01's `--port` behavior).
7. **[ ] CLI > config.json > built-in default precedence for scope
   (AC6).** With `.sidebar/config.json` set to `{"version":1,"scope":"notes/**/*.md"}`
   in a workspace that has `notes/` but no `docs/`, boot sidebar; expect
   the workspace to come up against `notes/**/*.md` (no docs/-missing
   prompt). Add `--scope "other/**/*.md"` to the CLI; expect bind
   against `other/**/*.md` and `config.json` unchanged on disk.
8. **[ ] Custom verb merging (AC9, AC10).** Write a `.sidebar/config.json`
   declaring a custom human verb and a custom agent verb:
   ```
   { "version": 1, "verbs": {
       "human": { "tighten": { "mode": "replace" }, "audit": { "mode": "annotation" } },
       "agent": { "estimate": {} } } }
   ```
   Run the verb-capture driver:
   ```
   node /path/to/sidebar/docs/demo/slice-03/_capture-verbs.mjs /path/to/sidebar
   ```
   Expect built-ins listed first, then the custom entries with the
   `(custom)` tag. Compare against
   `docs/demo/slice-03/custom-verb-transcript.txt`.
9. **[ ] Log level switches (AC13).** Run sidebar in a configured-good
   workspace with `--verbose`. Expect `[DEBUG]` lines (e.g. the port-
   fallback "port X busy, trying next" line if 5180 is held). Run with
   `--quiet`. Expect no `[INFO]` lines; only `[WARN]` and above. Default
   boot is INFO; the unignored-local warning is one example.

## Demo replay

Recreating each asset in `docs/demo/slice-03/`. Same goal as slice 02's
QA doc: let a future reviewer regenerate the transcripts after a code
change so the demo never goes stale.

1. **`gitignore-offer-transcript.txt`.**
   ```
   SCRATCH=/tmp/sidebar-qa-slice-03; rm -rf "$SCRATCH"; mkdir -p "$SCRATCH/docs"
   cd "$SCRATCH"; git init -q .; printf 'node_modules\n' > .gitignore
   printf 'y\n' | node /path/to/sidebar/docs/demo/slice-03/_capture-config.mjs /path/to/sidebar \
     > /path/to/sidebar/docs/demo/slice-03/gitignore-offer-transcript.txt
   ```
   Then hand-edit the captured paths to use `/path/to/sidebar/` and
   `/tmp/sidebar-qa-slice-03/` placeholders so the transcript reads
   the same on any reviewer's machine.
2. **`unignored-warning-transcript.txt`.**
   ```
   SCRATCH=/tmp/sidebar-qa-slice-03b; rm -rf "$SCRATCH"
   mkdir -p "$SCRATCH/docs" "$SCRATCH/.git" "$SCRATCH/.sidebar"
   printf '# scratch\n'                  > "$SCRATCH/docs/welcome.md"
   printf 'node_modules\n'               > "$SCRATCH/.gitignore"
   printf '{\n  "version": 1,\n  "port": 0\n}\n' > "$SCRATCH/.sidebar/local.json"
   cd "$SCRATCH"; SIDEBAR_OPEN=noop node /path/to/sidebar/dist/server/cli.js --browser none --port 0
   # The warning is the first stderr line; Ctrl-C after the URL prints.
   ```
3. **`config-error-transcript.txt`.** Each of the four sub-cases is
   reproduced by writing the matching file content (shown in the
   transcript) and running `node /path/to/sidebar/dist/server/cli.js
   --browser none --port 0`. Capture stderr.
4. **`custom-verb-transcript.txt`.**
   ```
   SCRATCH=/tmp/sidebar-qa-slice-03d; rm -rf "$SCRATCH"
   mkdir -p "$SCRATCH/docs" "$SCRATCH/.sidebar"
   # Write the example config.json shown in the transcript.
   cd "$SCRATCH"; node /path/to/sidebar/docs/demo/slice-03/_capture-verbs.mjs /path/to/sidebar \
     > /path/to/sidebar/docs/demo/slice-03/custom-verb-transcript.txt
   ```
5. **`lazy-creation-transcript.txt`.** Two sub-runs, one standalone
   one --stdio. Both use `SIDEBAR_OPEN=noop` to suppress the real
   browser launch.

## Known gaps

Intentionally out of scope for slice 03, all covered by later slices:

- UI surface for "save current port to local.json" / "register custom
  verb" etc. The lazy-write API (`persistLocal`, `persistConfig`) is in
  place; the UI hooks that call it land alongside the features that
  need them (slice 04 onward).
- Slice 02 leaves an empty `.sidebar/` directory after a clean `--stdio`
  shutdown (it removes `connection.json` but not the parent dir).
  Cosmetic only; the on-disk state is otherwise identical to a
  pre-boot tree. Tracked in #11 (failure-mode polish).
- The interactive gitignore-offer prompt is exercised only via the
  demo driver `_capture-config.mjs`. Future slices that surface a
  "save settings" UI will pass their own consent callback into
  `persistLocal`.
- No global config (`~/.sidebar/`, `~/.config/sidebar/`) in V1. Reuse
  across projects is by copying `.sidebar/config.json`. Spec calls this
  out explicitly under Configuration.
- Slice does not consume the verb catalog yet; slices 4-6 will. The
  public API (`buildVerbCatalog`, `BUILTIN_*`, `VerbCatalog`) is the
  surface those slices import.

Anything else flagged as "missing" but not listed here is a missing
decision; per AGENTS.md, file an issue rather than absorb it into this
slice.
