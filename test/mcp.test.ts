// Slice 02: MCP server + init subcommand + read-only tools.
//
// Each test maps to one or more acceptance criteria from issue #2.
// Per AGENTS.md test-first contract these tests are added before the
// implementation; a fresh checkout of this commit should fail every
// MCP-related assertion until the slice 02 implementation lands.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CLI_ENTRY,
  TSX_BIN,
  destroyWorkspace,
  launchCli,
  makeWorkspace,
  waitFor,
  type LaunchedCli,
} from "./helpers.ts";

type StdioHandle = {
  client: Client;
  transport: StdioClientTransport;
  pid: number | null;
  close: () => Promise<void>;
};

async function connectStdio(
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<StdioHandle> {
  const transport = new StdioClientTransport({
    command: TSX_BIN,
    args: [CLI_ENTRY, "--stdio"],
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      SIDEBAR_OPEN: "noop",
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "sidebar-test-client", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    transport,
    pid: transport.pid,
    close: async () => {
      try {
        await client.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function connectStandaloneHttp(httpUrl: string): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const transport = new StreamableHTTPClientTransport(new URL(`${httpUrl}/mcp`));
  const client = new Client({ name: "sidebar-test-http", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      try {
        await client.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AC1 + AC2 + AC3: `init` subcommand writes a project-local .mcp.json
// ---------------------------------------------------------------------------

describe("CLI: init subcommand", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  async function runInit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((res, rej) => {
      const child = spawn(TSX_BIN, [CLI_ENTRY, "init", ...args], {
        cwd,
        env: { ...process.env, SIDEBAR_OPEN: "noop" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.once("error", rej);
      child.once("exit", (code) => res({ code: code ?? -1, stdout, stderr }));
    });
  }

  // AC1: `init <agent>` wires up the named agent (claude-code in V1).
  // AC3: the resulting entry spawns `npx sidebar --stdio`.
  it("init claude-code writes a .mcp.json with a sidebar entry that spawns --stdio", async () => {
    const { code } = await runInit(["claude-code"]);
    expect(code).toBe(0);
    const raw = await readFile(join(cwd, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.sidebar).toBeDefined();
    const entry = parsed.mcpServers.sidebar;
    // The entry must spawn `npx sidebar --stdio` (the locked invite shape).
    expect(entry.command).toBe("npx");
    expect(entry.args).toContain("sidebar");
    expect(entry.args).toContain("--stdio");
  });

  // AC2: re-running init updates the existing sidebar entry rather than
  // duplicating it; existing unrelated entries are preserved.
  it("init is idempotent and preserves unrelated mcpServers entries", async () => {
    await writeFile(
      join(cwd, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "other-thing": { command: "node", args: ["other.js"] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const first = await runInit(["claude-code"]);
    expect(first.code).toBe(0);
    const afterFirst = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"));
    expect(afterFirst.mcpServers["other-thing"]).toEqual({
      command: "node",
      args: ["other.js"],
    });
    expect(afterFirst.mcpServers.sidebar).toBeDefined();

    // Second run must not duplicate or corrupt.
    const second = await runInit(["claude-code"]);
    expect(second.code).toBe(0);
    const afterSecond = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"));
    expect(Object.keys(afterSecond.mcpServers).sort()).toEqual([
      "other-thing",
      "sidebar",
    ]);
    expect(afterSecond.mcpServers["other-thing"]).toEqual({
      command: "node",
      args: ["other.js"],
    });
  });

  // AC1: no-arg detection. Without an arg, `init` should still produce a
  // sidebar entry when a non-interactive --yes flag is passed (the
  // interactive prompt is exercised manually in the QA doc).
  it("init --yes with no agent arg still writes a sidebar entry for claude-code", async () => {
    const { code } = await runInit(["--yes"]);
    expect(code).toBe(0);
    const raw = await readFile(join(cwd, ".mcp.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.mcpServers.sidebar).toBeDefined();
    expect(parsed.mcpServers.sidebar.args).toContain("--stdio");
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC5 + AC6 + AC8 + AC9 + AC10 + AC11 + AC12: MCP server over stdio
// ---------------------------------------------------------------------------

describe("MCP server: stdio primary", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": "# alpha\n\n<!-- @sidebar mention id=\"m-test\" verb=\"rephrase\": go -->\nbody\n<!-- @sidebar end id=\"m-test\" -->\n",
        "sub/beta.md": "# beta\n",
      },
    });
  });

  afterEach(async () => {
    if (stdio) {
      await stdio.close();
      stdio = null;
    }
    await destroyWorkspace(cwd);
  });

  // AC11: Tier-1 server description on initialize is 200-400 tokens covering
  // what sidebar is, prose-edit permission model, base_hash protocol,
  // is_draft signal, and a pointer to npx sidebar scaffold-skill.
  it("initialize returns a 200-400 token description covering the Tier-1 floor", async () => {
    stdio = await connectStdio(cwd);
    const info = stdio.client.getServerVersion();
    expect(info?.name).toMatch(/sidebar/);
    const instructions = stdio.client.getInstructions() ?? "";
    // 200-400 tokens at ~4 chars/token is roughly 700-2000 chars.
    expect(instructions.length).toBeGreaterThanOrEqual(700);
    expect(instructions.length).toBeLessThanOrEqual(2200);
    // Each of the five Tier-1 obligations must be present in some form.
    expect(instructions).toMatch(/sidebar/i);
    expect(instructions).toMatch(/resolve_mention|mention/i);
    expect(instructions).toMatch(/base_hash/);
    expect(instructions).toMatch(/is_draft/);
    expect(instructions).toMatch(/scaffold-skill/);
  });

  // AC9: list_docs returns every file path in the workspace glob.
  it("list_docs returns every workspace path", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({ name: "list_docs", arguments: {} });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    // The tool returns JSON-encoded paths; parse them out of the text payload
    // (the MCP SDK contract for tool results without a typed output schema).
    const payload = JSON.parse(text);
    expect(payload.paths).toEqual(
      expect.arrayContaining(["alpha.md", "sub/beta.md"]),
    );
  });

  // AC10: read_doc returns full file content with markers NOT stripped,
  // plus is_draft and draft_age_seconds.
  it("read_doc returns full content with markers intact and is_draft=false on clean buffer", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "read_doc",
      arguments: { path: "alpha.md" },
    });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    const payload = JSON.parse(text);
    expect(payload.content).toContain("<!-- @sidebar mention");
    expect(payload.content).toContain("<!-- @sidebar end");
    expect(payload.is_draft).toBe(false);
    expect(payload.draft_age_seconds).toBe(0);
  });

  // AC12: tool handler errors return MCP error responses, not crashes.
  it("read_doc on a non-existent path returns an MCP error response, not a crash", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "read_doc",
      arguments: { path: "missing.md" },
    });
    expect(result.isError).toBe(true);
    // Subsequent calls must still succeed: the process did not die.
    const followup = await stdio.client.callTool({ name: "list_docs", arguments: {} });
    expect(followup.isError).not.toBe(true);
  });

  // AC10 (bonus): read_doc on a file outside the workspace returns an error.
  it("read_doc on a path outside the workspace glob returns an error response", async () => {
    await writeFile(join(cwd, "outside.md"), "# outside\n");
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "read_doc",
      arguments: { path: "../outside.md" },
    });
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 + AC6: primary --stdio starts editor/watcher/browser + writes
// .sidebar/connection.json on boot, removes on graceful shutdown.
// ---------------------------------------------------------------------------

describe("--stdio primary: connection.json + side components", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace({ docs: { "alpha.md": "# alpha\n" } });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("writes .sidebar/connection.json with version/url/pid/started_at on boot", async () => {
    const stdio = await connectStdio(cwd);
    try {
      // The primary writes the file before it answers the first MCP request.
      const connPath = join(cwd, ".sidebar", "connection.json");
      await waitFor(() => existsSync(connPath), { label: "connection.json to appear" });
      const conn = JSON.parse(await readFile(connPath, "utf8"));
      expect(conn.version).toBe(1);
      expect(conn.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(typeof conn.pid).toBe("number");
      expect(typeof conn.started_at).toBe("string");
    } finally {
      await stdio.close();
    }
  });

  it("removes .sidebar/connection.json on graceful shutdown", async () => {
    const stdio = await connectStdio(cwd);
    const connPath = join(cwd, ".sidebar", "connection.json");
    await waitFor(() => existsSync(connPath), { label: "connection.json to appear" });
    await stdio.close();
    await waitFor(() => !existsSync(connPath), {
      timeoutMs: 5000,
      label: "connection.json to be removed",
    });
  });

  // AC5: primary --stdio starts the editor/watcher (HTTP listener serves the
  // SPA shell) so the browser can attach.
  it("primary --stdio binds the HTTP listener so the editor is reachable", async () => {
    const stdio = await connectStdio(cwd);
    try {
      const connPath = join(cwd, ".sidebar", "connection.json");
      await waitFor(() => existsSync(connPath), { label: "connection.json to appear" });
      const conn = JSON.parse(await readFile(connPath, "utf8"));
      const res = await fetch(`${conn.url}/healthz`);
      expect(res.ok).toBe(true);
    } finally {
      await stdio.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4: subsequent --stdio invocation becomes a proxy when a primary lives.
// ---------------------------------------------------------------------------

describe("--stdio primary/proxy routing", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace({ docs: { "alpha.md": "# alpha\n" } });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("second --stdio while a primary lives joins as a proxy and shares MCP state", async () => {
    const primary = await connectStdio(cwd);
    try {
      const connPath = join(cwd, ".sidebar", "connection.json");
      await waitFor(() => existsSync(connPath), { label: "connection.json to appear" });
      const primaryConn = JSON.parse(await readFile(connPath, "utf8"));

      const proxy = await connectStdio(cwd);
      try {
        // The proxy must not have written a *new* connection.json; the same
        // primary URL/pid must still be in place.
        const stillSame = JSON.parse(await readFile(connPath, "utf8"));
        expect(stillSame.pid).toBe(primaryConn.pid);
        expect(stillSame.url).toBe(primaryConn.url);

        // The proxy serves the same tool surface as the primary.
        const result = await proxy.client.callTool({
          name: "list_docs",
          arguments: {},
        });
        const text = (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");
        const payload = JSON.parse(text);
        expect(payload.paths).toEqual(expect.arrayContaining(["alpha.md"]));
      } finally {
        await proxy.close();
      }

      // Killing the proxy must not remove the primary's connection.json.
      await delay(200);
      expect(existsSync(connPath)).toBe(true);
    } finally {
      await primary.close();
    }
  });

  it("becomes primary when connection.json exists but the recorded pid is dead", async () => {
    await mkdir(join(cwd, ".sidebar"), { recursive: true });
    // Pid 1 is alive on POSIX (init), so synthesise a guaranteed-dead pid by
    // forking a child and waiting for it to exit.
    const ghost = spawn(TSX_BIN, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const ghostPid = ghost.pid ?? 99999;
    await new Promise<void>((res) => ghost.once("exit", () => res()));
    expect(isPidAlive(ghostPid)).toBe(false);
    await writeFile(
      join(cwd, ".sidebar", "connection.json"),
      JSON.stringify({
        version: 1,
        url: "http://127.0.0.1:65530",
        pid: ghostPid,
        started_at: "2024-01-01T00:00:00Z",
      }),
      "utf8",
    );

    const stdio = await connectStdio(cwd);
    try {
      const connPath = join(cwd, ".sidebar", "connection.json");
      const conn = JSON.parse(await readFile(connPath, "utf8"));
      // The stale file was replaced with one whose pid matches this process.
      expect(conn.pid).not.toBe(ghostPid);
      expect(isPidAlive(conn.pid)).toBe(true);
    } finally {
      await stdio.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC7: standalone refuses to start when a primary is alive.
// ---------------------------------------------------------------------------

describe("standalone: refuses while a primary is alive", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace({ docs: { "alpha.md": "# alpha\n" } });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("npx sidebar refuses to start if .sidebar/connection.json points at a live primary", async () => {
    const primary = await connectStdio(cwd);
    try {
      const connPath = join(cwd, ".sidebar", "connection.json");
      await waitFor(() => existsSync(connPath), { label: "connection.json to appear" });

      const standalone = launchCli(cwd, ["--browser", "none"]);
      try {
        const exit = await new Promise<number | null>((res) => {
          standalone.child.once("exit", (code) => res(code));
        });
        expect(exit).not.toBe(0);
        const stderr = standalone.stderr();
        expect(stderr).toMatch(/primary.*already|attach|http:\/\/127\.0\.0\.1/);
      } finally {
        await standalone.stop();
      }
    } finally {
      await primary.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC8: MCP server is also reachable over HTTP from standalone.
// ---------------------------------------------------------------------------

describe("MCP server: HTTP transport (standalone)", () => {
  let cwd: string;
  let cli: LaunchedCli | null = null;
  beforeEach(async () => {
    cwd = await makeWorkspace({ docs: { "alpha.md": "# alpha\n" } });
  });
  afterEach(async () => {
    if (cli) await cli.stop();
    await destroyWorkspace(cwd);
  });

  it("exposes the same read tool surface over the Streamable HTTP endpoint", async () => {
    cli = launchCli(cwd, ["--port", "0", "--browser", "none"]);
    const url = await cli.url;
    const http = await connectStandaloneHttp(url);
    try {
      const result = await http.client.callTool({ name: "list_docs", arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const payload = JSON.parse(text);
      expect(payload.paths).toEqual(expect.arrayContaining(["alpha.md"]));
    } finally {
      await http.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC10: is_draft / draft_age_seconds reflect the editor's dirty-buffer state.
// ---------------------------------------------------------------------------

describe("read_doc: is_draft reflects editor dirty buffer", () => {
  let cwd: string;
  let cli: LaunchedCli | null = null;
  beforeEach(async () => {
    cwd = await makeWorkspace({ docs: { "alpha.md": "# alpha\n" } });
  });
  afterEach(async () => {
    if (cli) {
      await cli.stop();
      cli = null;
    }
    await destroyWorkspace(cwd);
  });

  it("is_draft=true and draft_age_seconds>0 after editor signals a dirty buffer", async () => {
    cli = launchCli(cwd, ["--port", "0", "--browser", "none"]);
    const url = await cli.url;

    // Drive the dirty signal over the editor WebSocket the same way the
    // real CodeMirror buffer does.
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    ws.send(JSON.stringify({ kind: "dirty", path: "alpha.md", isDirty: true }));
    await delay(50);

    const http = await connectStandaloneHttp(url);
    try {
      const result = await http.client.callTool({
        name: "read_doc",
        arguments: { path: "alpha.md" },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const payload = JSON.parse(text);
      expect(payload.is_draft).toBe(true);
      expect(payload.draft_age_seconds).toBeGreaterThanOrEqual(0);

      // Clearing the dirty state flips is_draft back to false.
      ws.send(JSON.stringify({ kind: "dirty", path: "alpha.md", isDirty: false }));
      await delay(50);
      const after = await http.client.callTool({
        name: "read_doc",
        arguments: { path: "alpha.md" },
      });
      const afterText = (after.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const afterPayload = JSON.parse(afterText);
      expect(afterPayload.is_draft).toBe(false);
      expect(afterPayload.draft_age_seconds).toBe(0);
    } finally {
      ws.close();
      await http.close();
    }
  });
});

