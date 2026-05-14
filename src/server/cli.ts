#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit, cwd as procCwd, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import open from "open";
import { ArgsError, type ParsedArgs, helpText, parseArgs } from "./args.js";
import {
  ConfigLoadError,
  LOCAL_REL,
  type LoadConfigResult,
  type SidebarConfigFile,
  type SidebarLocalFile,
  gitignoreState,
  loadProjectConfig,
} from "./config/index.js";
import { probeConnectionFile } from "./connection-file.js";
import { SUPPORTED_AGENTS, type SupportedAgent, isSupportedAgent, runInit } from "./init.js";
import { log, setLogLevel } from "./log.js";
import { assertNodeVersion } from "./runtime-check.js";
import { type ServerHandle, startServer } from "./server.js";
import { bootStdio } from "./stdio.js";
import { buildVerbCatalog } from "./verbs/index.js";
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

  // `init` writes a .mcp.json; it does not need the .sidebar/ config layer.
  // Everything else passes through the loader so an invalid file refuses
  // boot per the Q9 "no silent fallback" stance.
  if (args.subcommand === "init") {
    await runInitCommand(args);
    return;
  }

  const cwd = procCwd();
  let loaded: LoadConfigResult;
  try {
    loaded = await loadProjectConfig(cwd);
  } catch (e) {
    if (e instanceof ConfigLoadError) {
      process.stderr.write(`${e.message}\n`);
      exit(8);
    }
    throw e;
  }
  warnUnignoredLocal(cwd, loaded.local);

  const settings = resolveSettings(args, loaded);

  switch (args.subcommand) {
    case "stdio":
      await runStdioCommand(settings);
      return;
    case "serve":
      await runServeCommand(settings);
      return;
  }
}

type EffectiveSettings = {
  /** Workspace glob (CLI > config.json > built-in default). */
  scope: string;
  /** True when scope came from CLI or config.json (suppresses the docs/
   *  prompt because the user has made an explicit choice). */
  scopeFromDisk: boolean;
  /** Explicit port (number) or undefined for fallback range. CLI > local.json. */
  port: number | undefined;
  /** True when port came from CLI or local.json — collision must NOT fall
   *  back, per spec: Port collision on startup. */
  portExplicit: boolean;
  /** Browser launch mode. CLI > local.json > "default". */
  browser: string;
  /** The parsed .sidebar/config.json (or null). Slice 4 reads `verbs` from it. */
  config: SidebarConfigFile | null;
};

function resolveSettings(args: ParsedArgs, loaded: LoadConfigResult): EffectiveSettings {
  const cfg: SidebarConfigFile | null = loaded.config;
  const loc: SidebarLocalFile | null = loaded.local;

  const scope = args.scope ?? cfg?.scope ?? defaultScope();
  const scopeFromDisk = args.scope !== undefined || cfg?.scope !== undefined;

  const port = args.port ?? loc?.port;
  const portExplicit = args.port !== undefined || loc?.port !== undefined;

  const browser = args.browser ?? loc?.browser ?? "default";

  return { scope, scopeFromDisk, port, portExplicit, browser, config: cfg };
}

function warnUnignoredLocal(cwd: string, local: SidebarLocalFile | null): void {
  if (!local) return;
  if (gitignoreState(cwd) === "unignored") {
    // Spec: Configuration / Gitignore behavior. Single-line stderr nag; no
    // persistent dismissal flag.
    process.stderr.write(
      `warning: ${LOCAL_REL} exists in this project but is not gitignored. ` +
        `Add it to .gitignore (per-machine state should not be committed).\n`,
    );
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

async function runStdioCommand(settings: EffectiveSettings): Promise<void> {
  const cwd = procCwd();
  const workspace = await prepareWorkspaceOrExit(settings, cwd, { promptOnMissing: false });
  const staticRoot = resolveStaticRoot();
  const verbCatalog = buildVerbCatalog(settings.config);

  const boot = await bootStdio({
    cwd,
    startPrimary: async () => {
      const handle = await bindServer(workspace, settings, staticRoot, verbCatalog);
      process.stderr.write(`sidebar primary listening at ${handle.url}\n`);
      process.stderr.write(`  workspace: ${workspace.root}\n`);
      process.stderr.write(`  scope:     ${workspace.scope}\n`);
      // Only the primary opens a browser; proxies share the primary tab.
      await maybeLaunchBrowser(settings.browser, handle.url);
      return handle;
    },
  });

  installStdioShutdown(boot.shutdown);
  await boot.done;
}

async function runServeCommand(settings: EffectiveSettings): Promise<void> {
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

  const workspace = await prepareWorkspaceOrExit(settings, cwd, { promptOnMissing: true });
  const staticRoot = resolveStaticRoot();
  const verbCatalog = buildVerbCatalog(settings.config);

  const handle = await bindServer(workspace, settings, staticRoot, verbCatalog);

  process.stderr.write(`sidebar listening at ${handle.url}\n`);
  process.stderr.write(`  workspace: ${workspace.root}\n`);
  process.stderr.write(`  scope:     ${workspace.scope}\n`);

  await maybeLaunchBrowser(settings.browser, handle.url);

  installShutdown(handle);
}

// Bind the HTTP server honouring the precedence rules: an explicit port
// (CLI or local.json) refuses on collision; an absent port walks the
// 5180-5189 fallback range.
async function bindServer(
  workspace: ReturnType<typeof createWorkspace>,
  settings: EffectiveSettings,
  staticRoot: string | null,
  verbCatalog: ReturnType<typeof buildVerbCatalog>,
): Promise<ServerHandle> {
  if (settings.portExplicit && settings.port !== undefined) {
    try {
      return await startServer({ workspace, port: settings.port, staticRoot, verbCatalog });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        process.stderr.write(
          `port ${settings.port} is already in use (EADDRINUSE). ` +
            `Pick a different --port, or use --port 0.\n`,
        );
        exit(4);
      }
      throw e;
    }
  }
  return tryFallback(workspace, staticRoot, verbCatalog);
}

async function prepareWorkspaceOrExit(
  settings: EffectiveSettings,
  cwd: string,
  opts: { promptOnMissing: boolean },
): Promise<ReturnType<typeof createWorkspace>> {
  let scope = settings.scope;

  // The docs/ prompt only fires for the *default* scope. A scope coming from
  // either CLI or config.json is the user's explicit choice; we don't second-
  // guess it.
  if (!settings.scopeFromDisk && isDefaultScope(scope) && !defaultScopeDirExists(cwd)) {
    if (!opts.promptOnMissing) {
      // --stdio is non-interactive (the user's agent is on the other end of
      // stdio). Refuse rather than silently fall back.
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
  verbCatalog: ReturnType<typeof buildVerbCatalog>,
): Promise<ServerHandle> {
  for (let p = PORT_FALLBACK_START; p <= PORT_FALLBACK_END; p++) {
    try {
      return await startServer({ workspace, port: p, staticRoot, verbCatalog });
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
