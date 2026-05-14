#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit, cwd as procCwd, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import open from "open";
import { ArgsError, type ParsedArgs, helpText, parseArgs } from "./args.js";
import { probeConnectionFile } from "./connection-file.js";
import { SUPPORTED_AGENTS, type SupportedAgent, isSupportedAgent, runInit } from "./init.js";
import { log, setLogLevel } from "./log.js";
import { assertNodeVersion } from "./runtime-check.js";
import { type ServerHandle, startServer } from "./server.js";
import { bootStdio } from "./stdio.js";
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

  switch (args.subcommand) {
    case "init":
      await runInitCommand(args);
      return;
    case "stdio":
      await runStdioCommand(args);
      return;
    case "serve":
      await runServeCommand(args);
      return;
  }
}

async function runInitCommand(args: ParsedArgs): Promise<void> {
  const cwd = procCwd();
  let agentName = args.initAgent;
  if (!agentName) {
    if (args.yes || !stdin.isTTY) {
      // Non-interactive default: V1 ships claude-code (spec: Invocation
      // modes / V1 supports Claude Code and Compound's shared .mcp.json).
      agentName = "claude-code";
    } else {
      agentName = await promptForAgent();
    }
  }
  if (!isSupportedAgent(agentName)) {
    process.stderr.write(
      `unsupported agent: ${agentName}. ` +
        `Supported in V1: ${SUPPORTED_AGENTS.join(", ")}. ` +
        `Cursor, Codex, and Aider variants land in V1.1.\n`,
    );
    exit(2);
  }
  let outcome: Awaited<ReturnType<typeof runInit>>;
  try {
    outcome = await runInit(cwd, agentName as SupportedAgent);
  } catch (e) {
    process.stderr.write(`init failed: ${(e as Error).message}\n`);
    exit(6);
  }
  const verb =
    outcome.action === "created"
      ? "wrote new"
      : outcome.action === "updated"
        ? "updated"
        : "left unchanged";
  process.stdout.write(
    `sidebar init: ${verb} ${outcome.path}\n` +
      `  agent:         ${agentName}\n` +
      `  mcpServers:    ${outcome.agents.join(", ")}\n` +
      `\n` +
      `Start ${agentName} in this project; it will spawn sidebar via stdio.\n`,
  );
}

async function promptForAgent(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(
      `\nWhich MCP-speaking agent should sidebar wire up?\n\n` +
        SUPPORTED_AGENTS.map((a, i) => `  [${i + 1}] ${a}`).join("\n") +
        `\n\nEnter a number or the agent name (default: claude-code): `,
    );
    const ans = (await rl.question("")).trim();
    if (!ans) return "claude-code";
    const idx = Number.parseInt(ans, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= SUPPORTED_AGENTS.length) {
      return SUPPORTED_AGENTS[idx - 1];
    }
    return ans;
  } finally {
    rl.close();
  }
}

async function runStdioCommand(args: ParsedArgs): Promise<void> {
  const cwd = procCwd();
  const workspace = await prepareWorkspaceOrExit(args, cwd, { promptOnMissing: false });
  const staticRoot = resolveStaticRoot();

  const boot = await bootStdio({
    cwd,
    startPrimary: async () => {
      let handle: ServerHandle;
      if (args.port !== undefined) {
        handle = await startServer({ workspace, port: args.port, staticRoot });
      } else {
        handle = await tryFallback(workspace, staticRoot);
      }
      process.stderr.write(`sidebar primary listening at ${handle.url}\n`);
      process.stderr.write(`  workspace: ${workspace.root}\n`);
      process.stderr.write(`  scope:     ${workspace.scope}\n`);
      // Only the primary opens a browser; proxies share the primary tab.
      await maybeLaunchBrowser(args.browser, handle.url);
      return handle;
    },
  });

  installStdioShutdown(boot.shutdown);
  await boot.done;
}

async function runServeCommand(args: ParsedArgs): Promise<void> {
  const cwd = procCwd();

  // ADR-0007 / spec: Invocation modes. Standalone must refuse to start while
  // a primary is already alive for this project.
  const probe = await probeConnectionFile(cwd);
  if (probe.kind === "alive") {
    process.stderr.write(
      `primary sidebar already running at ${probe.info.url} (pid ${probe.info.pid}).\n` +
        `Attach via that URL or stop the running primary first.\n`,
    );
    exit(7);
  }
  if (probe.kind === "stale" || probe.kind === "malformed") {
    log.warn(`removing stale .sidebar/connection.json (probe: ${probe.kind})`);
    // Don't block the user behind a manual cleanup; the file is per-project
    // discovery, not configuration.
    const { removeConnectionFile } = await import("./connection-file.js");
    await removeConnectionFile(cwd);
  }

  const workspace = await prepareWorkspaceOrExit(args, cwd, { promptOnMissing: true });
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

async function prepareWorkspaceOrExit(
  args: ParsedArgs,
  cwd: string,
  opts: { promptOnMissing: boolean },
): Promise<ReturnType<typeof createWorkspace>> {
  let scope = args.scope ?? defaultScope();
  const scopeFromCli = args.scope !== undefined;

  if (!scopeFromCli && isDefaultScope(scope) && !defaultScopeDirExists(cwd)) {
    if (!opts.promptOnMissing) {
      // --stdio is non-interactive (the user's agent is on the other end of
      // stdio). Refuse rather than silently fall back. The user can pass
      // --scope, or `npx sidebar` interactively to create docs/.
      process.stderr.write(
        `docs/ not found at ${cwd}.\n` +
          `Sidebar's --stdio mode is non-interactive. ` +
          `Re-run \`npx sidebar\` interactively to create docs/, or wire ` +
          `\`--scope "<glob>"\` into your .mcp.json entry.\n`,
      );
      exit(5);
    }
    const decision = await promptDocsMissing(cwd);
    if (decision.kind === "quit") {
      exit(0);
    } else if (decision.kind === "create") {
      await mkdir(join(cwd, "docs"), { recursive: true });
    } else {
      scope = decision.scope;
    }
  }
  return createWorkspace(cwd, scope);
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

function installStdioShutdown(stop: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = async (sig: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`received ${sig}, shutting down stdio\n`);
    try {
      await stop();
    } catch (e) {
      process.stderr.write(`stdio shutdown error: ${(e as Error).message}\n`);
    }
    exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

type DocsDecision = { kind: "create" } | { kind: "scope"; scope: string } | { kind: "quit" };

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
