import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Vitest globalSetup. Runs once before the test files load.
//
// Integration tests spawn the CLI as a real subprocess (see test/helpers.ts).
// They use the compiled `dist/server/cli.js` instead of `tsx src/server/cli.ts`
// so each spawn skips the per-invocation tsx cold-start, which previously
// dominated the wall time of the integration suites.
//
// To keep `npm test` a single command, we (re)build the server here. With
// TypeScript's incremental compilation (composite: true in tsconfig.server.json),
// a no-op build is ~0.5s; a real recompile is a few seconds. Cheap relative to
// the >60s the tsx cold-start cost across the suite.

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..");

export async function setup(): Promise<void> {
  const result = spawnSync("npm", ["run", "build:server"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`build:server failed with exit code ${result.status}`);
  }
}
