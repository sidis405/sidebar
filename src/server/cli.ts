#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { argv, cwd as procCwd, env, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import open from "open";
import { ArgsError, helpText, parseArgs, type ParsedArgs } from "./args.js";
import { log, setLogLevel } from "./log.js";
import { assertNodeVersion } from "./runtime-check.js";
import { startServer, type ServerHandle } from "./server.js";
import {
  createWorkspace,
  defaultScope,
  defaultScopeDirExists,
  isDefaultScope,
} from "./workspace.js";

const PORT_FALLBACK_START = 5180;
const PORT_FALLBACK_END = 5189;

async function main(): Promise<void> {
  try {
    assertNodeVersion(process.version);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    exit(2);
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv.slice(2));
  } catch (e) {
    if (e instanceof ArgsError) {
      process.stderr.write(`${e.message}\n\n${helpText()}`);
      exit(2);
    }
    throw e;
  }

  if (args.helpRequested) {
    process.stdout.write(helpText());
    return;
  }
  if (args.verbose) setLogLevel("DEBUG");
  else if (args.quiet) setLogLevel("WARN");

  const cwd = procCwd();
  let scope = args.scope ?? defaultScope();
  const scopeFromCli = args.scope !== undefined;

  if (!scopeFromCli && isDefaultScope(scope) && !defaultScopeDirExists(cwd)) {
    const decision = await promptDocsMissing(cwd);
    if (decision.kind === "quit") {
      exit(0);
    } else if (decision.kind === "create") {
      await mkdir(join(cwd, "docs"), { recursive: true });
    } else {
      scope = decision.scope;
    }
  }

  const workspace = createWorkspace(cwd, scope);
  const staticRoot = resolveStaticRoot();

  let handle: ServerHandle;
  if (args.port !== undefined) {
    try {
      handle = await startServer({ workspace, port: args.port, staticRoot });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        process.stderr.write(
          `port ${args.port} is already in use (EADDRINUSE). Pick a different --port, or use --port 0.\n`,
        );
        exit(4);
      }
      throw e;
    }
  } else {
    handle = await tryFallback(workspace, staticRoot);
  }

  process.stderr.write(`sidebar listening at ${handle.url}\n`);
  process.stderr.write(`  workspace: ${workspace.root}\n`);
  process.stderr.write(`  scope:     ${workspace.scope}\n`);

  await maybeLaunchBrowser(args.browser, handle.url);

  installShutdown(handle);
}

async function tryFallback(
  workspace: ReturnType<typeof createWorkspace>,
  staticRoot: string | null,
): Promise<ServerHandle> {
  for (let p = PORT_FALLBACK_START; p <= PORT_FALLBACK_END; p++) {
    try {
      return await startServer({ workspace, port: p, staticRoot });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      log.debug(`port ${p} busy, trying next`);
    }
  }
  process.stderr.write(
    `no free port in ${PORT_FALLBACK_START}-${PORT_FALLBACK_END}. Use --port <N> or --port 0.\n`,
  );
  exit(3);
}

async function maybeLaunchBrowser(browser: string, url: string): Promise<void> {
  if (browser === "none") return;
  const override = env.SIDEBAR_OPEN;
  if (override === "noop") return;
  if (override === "fail") {
    log.warn("SIDEBAR_OPEN=fail: skipping browser launch (test harness)");
    return;
  }
  try {
    if (browser === "default") {
      await open(url);
    } else {
      await open(url, { app: { name: browser } });
    }
  } catch (e) {
    log.warn(`browser launch failed: ${(e as Error).message}`);
  }
}

function installShutdown(handle: ServerHandle): void {
  let shuttingDown = false;
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`received ${sig}, shutting down\n`);
    try {
      await handle.close();
    } catch (e) {
      process.stderr.write(`shutdown error: ${(e as Error).message}\n`);
    }
    exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

type DocsDecision =
  | { kind: "create" }
  | { kind: "scope"; scope: string }
  | { kind: "quit" };

async function promptDocsMissing(cwd: string): Promise<DocsDecision> {
  if (!stdin.isTTY) {
    process.stderr.write(
      `docs/ not found at ${cwd}.\n` +
        `Sidebar uses docs/**/*.md as its default workspace scope.\n` +
        `Re-run with --scope "<glob>" or create docs/ and try again.\n`,
    );
    exit(5);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(
      `\ndocs/ not found at ${cwd}.\n` +
        `Sidebar uses docs/**/*.md as its default workspace scope.\n\n` +
        `  [c] create docs/ here\n` +
        `  [s] use a different scope glob\n` +
        `  [q] quit\n\n`,
    );
    for (;;) {
      const ans = (await rl.question("choice [c/s/q]: ")).trim().toLowerCase();
      if (ans === "c" || ans === "create") return { kind: "create" };
      if (ans === "q" || ans === "quit") return { kind: "quit" };
      if (ans === "s" || ans === "scope") {
        const scope = (await rl.question("scope glob: ")).trim();
        if (scope) return { kind: "scope", scope };
      }
    }
  } finally {
    rl.close();
  }
}

function resolveStaticRoot(): string | null {
  // After `npm run build`, the SPA is at dist/static. When running from
  // source via tsx, the directory may not exist yet; the server handles
  // that case by returning a friendly 503.
  const path = fileURLToPath(new URL("../../dist/static", import.meta.url));
  return existsSync(path) ? path : null;
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
