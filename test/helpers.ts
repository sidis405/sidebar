import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const CLI_ENTRY = resolve(REPO_ROOT, "src/server/cli.ts");
export const TSX_BIN = resolve(REPO_ROOT, "node_modules/.bin/tsx");

export type LaunchedCli = {
  child: ChildProcess;
  cwd: string;
  /** Resolves with the bound URL parsed from stderr. */
  url: Promise<string>;
  /** All stderr received so far. */
  stderr: () => string;
  stop: () => Promise<void>;
};

export async function makeWorkspace(opts?: {
  docs?: Record<string, string>;
  withDocsDir?: boolean;
}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "sidebar-test-"));
  if (opts?.withDocsDir !== false) {
    await mkdir(join(cwd, "docs"), { recursive: true });
  }
  if (opts?.docs) {
    for (const [rel, body] of Object.entries(opts.docs)) {
      const abs = join(cwd, "docs", rel);
      await mkdir(resolve(abs, ".."), { recursive: true });
      await writeFile(abs, body, "utf8");
    }
  }
  return cwd;
}

export async function destroyWorkspace(cwd: string): Promise<void> {
  await rm(cwd, { recursive: true, force: true });
}

export function launchCli(
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {},
): LaunchedCli {
  // Test harness suppresses real browser launch by default; tests that need
  // to assert on launch behavior can override via SIDEBAR_OPEN.
  const child = spawn(
    TSX_BIN,
    [CLI_ENTRY, ...args],
    {
      cwd,
      env: {
        ...process.env,
        SIDEBAR_OPEN: env.SIDEBAR_OPEN ?? "noop",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let buffer = "";
  let resolveUrl!: (u: string) => void;
  let rejectUrl!: (e: Error) => void;
  const url = new Promise<string>((res, rej) => {
    resolveUrl = res;
    rejectUrl = rej;
  });
  // Tests that intentionally expect the CLI to fail (e.g. port collision,
  // missing docs/) will not await this promise. A silent .catch keeps Node
  // from treating that as an unhandled rejection.
  url.catch(() => {});

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    buffer += chunk;
    const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) resolveUrl(match[0]);
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      rejectUrl(new Error(`cli exited with ${code} before URL printed: ${buffer}`));
    }
  });

  return {
    child,
    cwd,
    url,
    stderr: () => buffer,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGINT");
      // Give it a moment to clean up.
      const exited = new Promise<void>((res) => child.once("exit", () => res()));
      await Promise.race([exited, delay(2000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 5000, intervalMs = 50, label = "condition" } = opts;
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastErr ?? "no value"}`);
}
