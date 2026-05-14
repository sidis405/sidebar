import { readFile, stat } from "node:fs/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type WebSocket, WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage, StatusSnapshot } from "../shared/protocol.js";
import { resolveHumanAuthor } from "./author.js";
import { type DirtyBufferTracker, createDirtyBufferTracker } from "./dirty-buffer.js";
import {
  createFile,
  createFolder,
  deletePath,
  readWorkspaceFile,
  renamePath,
  saveWorkspaceFile,
} from "./files.js";
import { log } from "./log.js";
import { createSidebarMcpServer } from "./mcp-server.js";
import {
  type MentionCreatedAtMap,
  cancelMention,
  createMention,
  listMentions,
  warnOnceForMalformed,
} from "./mention-ops.js";
import { type MentionStore, createMentionStore } from "./mention-store.js";
import type { VerbCatalog } from "./verbs/index.js";
import { type Workspace, buildTree, startWatcher } from "./workspace.js";

export type ServerHandle = {
  url: string;
  port: number;
  workspace: Workspace;
  dirtyBuffers: DirtyBufferTracker;
  mentionStore: MentionStore;
  mentionCreatedAt: MentionCreatedAtMap;
  verbCatalog: VerbCatalog;
  close: () => Promise<void>;
};

export type StartOptions = {
  workspace: Workspace;
  /** 0 = let the OS pick a free port. */
  port: number;
  host?: string;
  /** Absolute path to the built SPA, or null when running unbuilt. */
  staticRoot?: string | null;
  /** Verb catalog assembled from built-ins + custom config. */
  verbCatalog: VerbCatalog;
};

export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const { workspace, verbCatalog } = opts;
  const host = opts.host ?? "127.0.0.1";
  const staticRoot = opts.staticRoot ?? null;
  const dirtyBuffers = createDirtyBufferTracker();
  const mentionStore = createMentionStore();
  const mentionCreatedAt: MentionCreatedAtMap = new Map();
  const warnedMalformedFiles = new Set<string>();
  const mcpDeps = {
    workspace,
    dirtyBuffers,
    mentionStore,
    mentionCreatedAt,
    verbCatalog,
    resolveHumanAuthor: () => resolveHumanAuthor(workspace.root),
  };

  const http = createServer((req, res) => {
    void route(req, res).catch((e) => {
      try {
        res.statusCode = 500;
        res.end(`internal error: ${(e as Error).message}`);
      } catch {
        /* socket already gone */
      }
    });
  });

  // Streamable HTTP MCP transport mounts onto the existing node:http server
  // (ADR-0008). Stateless mode: one fresh transport + McpServer per POST.
  // Spec: Architecture / Invocation modes — standalone exposes the MCP
  // server over HTTP at /mcp so additional agents can attach.
  const handleMcpHttp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Only POST is supported on /mcp" },
          id: null,
        }),
      );
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = createSidebarMcpServer(mcpDeps);
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      log.warn(`mcp http handler error: ${(e as Error).message}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "internal error" },
            id: null,
          }),
        );
      }
    } finally {
      // The stateless transport is single-request; close after we are done.
      void transport.close().catch(() => {});
      void mcp.close().catch(() => {});
    }
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "/";
    if (url === "/mcp" || url.startsWith("/mcp?")) {
      await handleMcpHttp(req, res);
      return;
    }
    await handleHttp(req, res, staticRoot);
  };

  // Bind the port first. The HTTP listener surfaces EADDRINUSE here, before
  // any WebSocketServer or watcher gets created — bailing early keeps a port
  // collision from leaking partial resources.
  const port = await listen(http, opts.port, host);

  const wss = new WebSocketServer({ noServer: true });
  const allowedOrigins = originAllowlistFor(host, port);
  http.on("upgrade", (req, socket, head) => {
    // CSRF defense: the WebSocket protocol can read and mutate workspace
    // files. A malicious public page can fetch `ws://127.0.0.1:<port>/ws`
    // from any browser the user opens. Only allow upgrades that either
    // (a) carry no Origin header (non-browser clients, including our tests
    // and curl), or (b) carry an Origin that matches the sidebar listener.
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (req.url === "/ws" || req.url?.startsWith("/ws?")) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const json = JSON.stringify(msg);
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(json);
    }
  };

  const refreshTree = async (): Promise<void> => {
    try {
      const nodes = await buildTree(workspace);
      broadcast({ kind: "treeChanged", nodes });
    } catch (e) {
      log.warn(`buildTree failed: ${(e as Error).message}`);
    }
  };

  const notifyExternalChange = async (relPath: string): Promise<void> => {
    try {
      const { content, hash } = await readWorkspaceFile(workspace, relPath);
      broadcast({ kind: "diskChanged", path: relPath, content, diskHash: hash });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        broadcast({ kind: "diskRemoved", path: relPath });
      } else {
        log.warn(`readWorkspaceFile failed for ${relPath}: ${(e as Error).message}`);
      }
    }
    // A change to a file may have added/removed mention markers; recompute
    // the status snapshot so the drawer reflects the new world.
    void broadcastStatus();
  };

  const buildStatusSnapshot = async (): Promise<StatusSnapshot> => {
    const { mentions, malformedByFile } = await listMentions(workspace, mentionCreatedAt);
    if (malformedByFile.size > 0) {
      // One stderr warning per file, only on first observation.
      const fresh = new Map<string, ReturnType<typeof malformedByFile.get>>();
      for (const [f, errs] of malformedByFile) {
        if (!warnedMalformedFiles.has(f)) {
          warnedMalformedFiles.add(f);
          fresh.set(f, errs);
        }
      }
      if (fresh.size > 0) {
        // biome-ignore lint/suspicious/noExplicitAny: shape matches the imported type
        warnOnceForMalformed(fresh as any);
      }
    }
    const claims = new Map(mentionStore.claims().map((c) => [c.mentionId, c]));
    return {
      pendingMentions: mentions.map((m) => {
        const claim = claims.get(m.id);
        return {
          id: m.id,
          file: m.file,
          origin: m.origin,
          verb: m.verb,
          author: m.author,
          instruction: m.instruction,
          orphan: m.orphan,
          created_at: m.created_at,
          inProgress: claim ? { agent: claim.agentName, claimedAt: claim.claimedAt } : undefined,
        };
      }),
      connectedAgents: mentionStore.connectedAgents().map((a) => ({
        name: a.name,
        connectedAt: a.connectedAt,
      })),
      recentEvents: mentionStore.recentEvents().map((e) => ({ ...e })),
    };
  };

  const broadcastStatus = async (): Promise<void> => {
    try {
      const snapshot = await buildStatusSnapshot();
      broadcast({ kind: "status", snapshot });
    } catch (e) {
      log.warn(`status broadcast failed: ${(e as Error).message}`);
    }
  };

  // Anything that changes the mention store (claim, release, event) should
  // push a fresh status snapshot to subscribed editor tabs.
  mentionStore.onChange(() => {
    void broadcastStatus();
  });

  const watcher = startWatcher(
    workspace,
    () => void refreshTree(),
    (relPath) => void notifyExternalChange(relPath),
  );
  // Wait for chokidar's initial scan so tests (and the first browser load)
  // never race a not-yet-ready watcher.
  await new Promise<void>((res) => watcher.once("ready", () => res()));

  wss.on("connection", (ws) => {
    clients.add(ws);
    // Track paths this tab declared dirty. When the tab disconnects we
    // unmark them so a closed editor never leaves a phantom draft visible
    // to MCP clients via `read_doc`.
    const myDirty = new Set<string>();
    ws.on("close", () => {
      for (const p of myDirty) dirtyBuffers.setDirty(p, false);
      clients.delete(ws);
    });
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        ws.send(JSON.stringify({ kind: "error", message: "invalid JSON" } satisfies ServerMessage));
        return;
      }
      // Catch-all: every per-case handler already converts errors to a
      // `kind: "error"` reply, but anything that throws synchronously or
      // before the inner try/catch (e.g. `list` building the tree) would
      // otherwise become an unhandled rejection. Belt and suspenders.
      if (msg.kind === "dirty") {
        if (msg.isDirty) myDirty.add(msg.path);
        else myDirty.delete(msg.path);
      }
      void handleMessage(msg, ws, {
        workspace,
        refreshTree,
        dirtyBuffers,
        mentionStore,
        mentionCreatedAt,
        verbCatalog,
        broadcastStatus,
      }).catch((e) => {
        try {
          ws.send(
            JSON.stringify({
              kind: "error",
              message: `unhandled error processing ${msg.kind}`,
              cause: (e as Error).message,
            } satisfies ServerMessage),
          );
        } catch {
          /* socket may already be closed */
        }
      });
    });
    ws.send(
      JSON.stringify({
        kind: "welcome",
        workspaceRoot: workspace.root,
        scope: workspace.scope,
      } satisfies ServerMessage),
    );
    void buildTree(workspace).then(
      (nodes) => ws.send(JSON.stringify({ kind: "tree", nodes } satisfies ServerMessage)),
      (e) =>
        ws.send(
          JSON.stringify({
            kind: "error",
            message: "tree build failed",
            cause: (e as Error).message,
          } satisfies ServerMessage),
        ),
    );
  });

  const url = `http://${host}:${port}`;
  return {
    url,
    port,
    workspace,
    dirtyBuffers,
    mentionStore,
    mentionCreatedAt,
    verbCatalog,
    close: async () => {
      // Terminate live WebSocket clients before closing the HTTP server, or
      // http.close() will wait for the existing upgraded sockets to drain on
      // their own — which, with an editor tab still open, never happens.
      for (const c of clients) {
        try {
          c.terminate();
        } catch {
          /* socket already gone */
        }
      }
      await watcher.close();
      await new Promise<void>((res) => wss.close(() => res()));
      http.closeAllConnections();
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}

async function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((res, rej) => {
    const onError = (e: Error) => {
      server.off("listening", onListening);
      rej(e);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      if (addr && typeof addr === "object") res(addr.port);
      else rej(new Error("server listen returned no address"));
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

type HandlerDeps = {
  workspace: Workspace;
  refreshTree: () => Promise<void>;
  dirtyBuffers: DirtyBufferTracker;
  mentionStore: MentionStore;
  mentionCreatedAt: MentionCreatedAtMap;
  verbCatalog: VerbCatalog;
  broadcastStatus: () => Promise<void>;
};

async function handleMessage(
  msg: ClientMessage,
  ws: WebSocket,
  deps: HandlerDeps,
): Promise<void> {
  const {
    workspace,
    refreshTree,
    dirtyBuffers,
    mentionStore,
    mentionCreatedAt,
    verbCatalog,
    broadcastStatus,
  } = deps;
  const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
  switch (msg.kind) {
    case "hello":
      return;
    case "dirty":
      dirtyBuffers.setDirty(msg.path, msg.isDirty);
      return;
    case "list": {
      try {
        const nodes = await buildTree(workspace);
        send({ kind: "tree", nodes });
      } catch (e) {
        send({ kind: "error", message: "list failed", cause: (e as Error).message });
      }
      return;
    }
    case "open":
      try {
        const { content, hash } = await readWorkspaceFile(workspace, msg.path);
        send({ kind: "fileOpen", path: msg.path, content, diskHash: hash });
      } catch (e) {
        send({ kind: "error", message: `open failed: ${msg.path}`, cause: (e as Error).message });
      }
      return;
    case "save":
      try {
        const outcome = await saveWorkspaceFile(workspace, msg.path, msg.content, msg.baseHash);
        if (outcome.kind === "saved") {
          send({ kind: "saved", path: msg.path, diskHash: outcome.hash });
        } else {
          send({
            kind: "saveConflict",
            path: msg.path,
            content: outcome.content,
            diskHash: outcome.diskHash,
          });
        }
      } catch (e) {
        send({ kind: "error", message: `save failed: ${msg.path}`, cause: (e as Error).message });
      }
      return;
    case "newFile":
      try {
        await createFile(workspace, msg.parent, msg.name);
        await refreshTree();
      } catch (e) {
        send({ kind: "error", message: "newFile failed", cause: (e as Error).message });
      }
      return;
    case "newFolder":
      try {
        await createFolder(workspace, msg.parent, msg.name);
        await refreshTree();
      } catch (e) {
        send({ kind: "error", message: "newFolder failed", cause: (e as Error).message });
      }
      return;
    case "rename":
      try {
        await renamePath(workspace, msg.from, msg.to);
        await refreshTree();
      } catch (e) {
        send({ kind: "error", message: "rename failed", cause: (e as Error).message });
      }
      return;
    case "delete":
      try {
        await deletePath(workspace, msg.path);
        await refreshTree();
      } catch (e) {
        send({ kind: "error", message: "delete failed", cause: (e as Error).message });
      }
      return;
    case "verbCatalog": {
      const snapshot = {
        human: Array.from(verbCatalog.human.values()).map((v) => ({
          name: v.name,
          kind: v.mode === "replace" ? ("human-replace" as const) : ("human-annotation" as const),
          builtin: v.builtin,
        })),
        agent: Array.from(verbCatalog.agent.values()).map((v) => ({
          name: v.name,
          kind: "agent" as const,
          builtin: v.builtin,
        })),
      };
      send({ kind: "verbCatalog", catalog: snapshot });
      return;
    }
    case "statusRequest":
      // Push the latest snapshot just to this caller.
      await broadcastStatus();
      return;
    case "createMention":
      try {
        const author = resolveHumanAuthor(workspace.root);
        const result = await createMention(workspace, {
          path: msg.path,
          startOffset: msg.startOffset,
          endOffset: msg.endOffset,
          verb: msg.verb,
          instruction: msg.instruction,
          author,
        });
        // Eagerly track creation timestamp so the next status snapshot
        // already carries the fresh mention.
        mentionCreatedAt.set(result.mention.id, new Date().toISOString());
        mentionStore.recordEvent({
          kind: "mention-created",
          mention_id: result.mention.id,
          file: msg.path,
          verb: msg.verb,
          origin: "human",
          author,
          at: new Date().toISOString(),
        });
        send({ kind: "mentionCreated", mentionId: result.mention.id, file: msg.path });
        await broadcastStatus();
      } catch (e) {
        send({
          kind: "error",
          message: "createMention failed",
          cause: (e as Error).message,
        });
      }
      return;
    case "cancelMention":
      try {
        const outcome = await cancelMention(workspace, msg.mentionId, mentionCreatedAt);
        if (outcome.kind === "not-found") {
          send({
            kind: "error",
            message: "cancelMention failed",
            cause: `no open mention with id ${msg.mentionId}`,
          });
          return;
        }
        mentionStore.release(msg.mentionId);
        mentionCreatedAt.delete(msg.mentionId);
        mentionStore.recordEvent({
          kind: "mention-cancelled",
          mention_id: msg.mentionId,
          file: outcome.file,
          at: new Date().toISOString(),
        });
        await broadcastStatus();
      } catch (e) {
        send({
          kind: "error",
          message: "cancelMention failed",
          cause: (e as Error).message,
        });
      }
      return;
    case "releaseClaim": {
      const released = mentionStore.release(msg.mentionId);
      if (!released) {
        send({
          kind: "error",
          message: "releaseClaim failed",
          cause: `mention ${msg.mentionId} is not claimed`,
        });
        return;
      }
      mentionStore.recordEvent({
        kind: "mention-released",
        mention_id: msg.mentionId,
        file: "",
        agent: released.agentName,
        reason: "manual release from status drawer",
        at: new Date().toISOString(),
      });
      await broadcastStatus();
      return;
    }
  }
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  staticRoot: string | null,
): Promise<void> {
  const url = req.url ?? "/";
  if (url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.end("ok");
    return;
  }
  if (!staticRoot) {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain");
    res.end(
      "sidebar editor SPA bundle is not present.\nRun `npm run build` first, then start sidebar again.\n",
    );
    return;
  }
  const path = url.split("?")[0].replace(/^\/+/, "");
  const candidate = path === "" ? "index.html" : path;
  const root = resolve(staticRoot);
  const abs = resolve(root, candidate);
  // Sibling-path defense: `abs.startsWith(root)` accepts e.g. /foo/static-evil
  // when root is /foo/static. Use path.relative so any escape resolves to a
  // segment beginning with "..".
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
    // rel === "" is the root itself; we redirect that to index.html below,
    // but reject anything else above the root.
    if (rel !== "") {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
  }
  try {
    const s = await stat(abs);
    if (s.isFile()) {
      const body = await readFile(abs);
      res.setHeader("content-type", contentTypeFor(abs));
      res.end(body);
      return;
    }
  } catch {
    // fall through to index.html SPA shell
  }
  try {
    const body = await readFile(resolve(staticRoot, "index.html"));
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}

function originAllowlistFor(host: string, port: number): Set<string> {
  // The HTTP listener binds to either `127.0.0.1` (our default) or
  // `localhost`-style aliases. Browsers normalize Origin from whatever the
  // user navigated to. Accept the canonical IPv4 form, the IPv6 loopback,
  // and `localhost`, all on the bound port.
  const out = new Set<string>([
    `http://${host}:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
    `http://localhost:${port}`,
  ]);
  return out;
}

function contentTypeFor(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    default:
      return "application/octet-stream";
  }
}
