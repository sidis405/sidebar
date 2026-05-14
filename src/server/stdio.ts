import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resolveHumanAuthor } from "./author.js";
import {
  type ConnectionInfo,
  probeConnectionFile,
  removeConnectionFile,
  writeConnectionFile,
} from "./connection-file.js";
import { log } from "./log.js";
import { TIER1_DESCRIPTION, createSidebarMcpServer } from "./mcp-server.js";
import type { ServerHandle } from "./server.js";

// `npx sidebar --stdio` is the invite hook (ADR-0007). The MCP client of the
// user's agent spawns this binary; on stdin it expects JSON-RPC, on stdout
// it sends the same. On the same process we either:
//
// - become the **primary** for this project (when no other primary is alive)
//   by booting the same components as standalone mode plus an extra stdio
//   transport for the spawning agent; or
// - become a **proxy** (when a primary is alive) that forwards each
//   stdin-side MCP call to the primary's HTTP transport and pipes the
//   response back, without starting a second editor / watcher / browser.
//
// The probe-and-decide is fast and racy in principle. Whichever process
// actually binds the HTTP port becomes primary; the loser falls through to
// proxy (or refuses, in the standalone case).

export type StdioBootOptions = {
  cwd: string;
  /** Builds the primary HTTP server. Closure so we can defer it. */
  startPrimary: () => Promise<ServerHandle>;
};

export type StdioBootResult = {
  role: "primary" | "proxy";
  /** Primary URL the proxy is forwarding to (only set for proxies). */
  primaryUrl?: string;
  /** Local handle when this process is the primary. */
  handle?: ServerHandle;
  /** Resolves when the spawning agent disconnects. */
  done: Promise<void>;
  /** Tears everything down (used by the test harness; SIGINT does the same). */
  shutdown: () => Promise<void>;
};

export async function bootStdio(opts: StdioBootOptions): Promise<StdioBootResult> {
  const probe = await probeConnectionFile(opts.cwd);
  if (probe.kind === "alive") {
    return bootProxy(probe.info);
  }
  // Stale, malformed or absent: become primary. Stale/malformed files get
  // overwritten by writeConnectionFile in bootPrimary.
  return bootPrimary(opts);
}

async function bootPrimary(opts: StdioBootOptions): Promise<StdioBootResult> {
  const handle = await opts.startPrimary();
  const info: ConnectionInfo = {
    version: 1,
    url: handle.url,
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
  await writeConnectionFile(opts.cwd, info);

  const transport = new StdioServerTransport();
  const mcp = createSidebarMcpServer({
    workspace: handle.workspace,
    dirtyBuffers: handle.dirtyBuffers,
    mentionStore: handle.mentionStore,
    mentionCreatedAt: handle.mentionCreatedAt,
    annotationCreatedAt: handle.annotationCreatedAt,
    verbCatalog: handle.verbCatalog,
    resolveHumanAuthor: () => resolveHumanAuthor(handle.workspace.root),
  });
  await mcp.connect(transport);
  // Register the agent for the status drawer once clientInfo is available
  // (post-initialize). Slice 7 polishes the per-client identity story; this
  // slice just needs the drawer to show "one agent connected". The collision
  // suffix logic in mentionStore.registerAgent dedupes concurrent connections.
  let unregister: () => void = () => {};
  setImmediate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: SDK shape
    const ci = (mcp as any).server?.getClientVersion?.();
    const name = ci?.name && typeof ci.name === "string" ? ci.name : "agent";
    unregister = handle.mentionStore.registerAgent(name);
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      unregister();
    } catch {
      /* noop */
    }
    try {
      await transport.close();
    } catch {
      /* already closed */
    }
    try {
      await mcp.close();
    } catch {
      /* already closed */
    }
    await removeConnectionFile(opts.cwd);
    try {
      await handle.close();
    } catch (e) {
      log.warn(`primary close error: ${(e as Error).message}`);
    }
  };

  const done = new Promise<void>((resolve) => {
    transport.onclose = () => {
      try {
        unregister();
      } catch {
        /* noop */
      }
      // The spawning agent disconnected its stdio. The primary process keeps
      // running so the editor stays alive (and additional agents can attach
      // via HTTP). The lifecycle owner is the user's Ctrl-C, not the agent.
      resolve();
    };
  });

  return { role: "primary", handle, done, shutdown };
}

async function bootProxy(info: ConnectionInfo): Promise<StdioBootResult> {
  // The proxy presents a stdio MCP surface to the agent and forwards each
  // tool call into the primary's HTTP MCP endpoint. We do NOT mirror tools
  // by hand: we open a real MCP client, call `tools/list` once to discover
  // the surface, then forward every `tools/call` blindly. This keeps the
  // proxy in lockstep with whatever read/write tools the primary exposes.
  const httpClient = new Client({ name: "sidebar-proxy", version: "0.1.0" }, { capabilities: {} });
  const httpTransport = new StreamableHTTPClientTransport(new URL(`${info.url}/mcp`));
  await httpClient.connect(httpTransport);

  // Build a server that delegates list_tools and call_tool through the
  // upstream client. We use the low-level Server API via McpServer.server
  // so we don't have to re-declare the schema of each tool.
  const proxyServer = new McpServer(
    { name: "sidebar-proxy", version: "0.1.0" },
    { instructions: TIER1_DESCRIPTION, capabilities: { tools: {} } },
  );

  proxyServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const upstream = await httpClient.listTools();
    return { tools: upstream.tools };
  });

  proxyServer.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return await httpClient.callTool(req.params);
  });

  const stdio = new StdioServerTransport();
  await proxyServer.connect(stdio);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await stdio.close();
    } catch {
      /* already closed */
    }
    try {
      await httpClient.close();
    } catch {
      /* already closed */
    }
  };
  const done = new Promise<void>((resolve) => {
    stdio.onclose = () => {
      resolve();
    };
  });

  return { role: "proxy", primaryUrl: info.url, done, shutdown };
}
