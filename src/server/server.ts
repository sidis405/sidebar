import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import {
  createFile,
  createFolder,
  deletePath,
  readWorkspaceFile,
  renamePath,
  saveWorkspaceFile,
} from "./files.js";
import { log } from "./log.js";
import { buildTree, startWatcher, type Workspace } from "./workspace.js";

export type ServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

export type StartOptions = {
  workspace: Workspace;
  /** 0 = let the OS pick a free port. */
  port: number;
  host?: string;
  /** Absolute path to the built SPA, or null when running unbuilt. */
  staticRoot?: string | null;
};

export async function startServer(opts: StartOptions): Promise<ServerHandle> {
  const { workspace } = opts;
  const host = opts.host ?? "127.0.0.1";
  const staticRoot = opts.staticRoot ?? null;

  const http = createServer((req, res) => {
    void handleHttp(req, res, staticRoot).catch((e) => {
      try {
        res.statusCode = 500;
        res.end(`internal error: ${(e as Error).message}`);
      } catch {
        /* socket already gone */
      }
    });
  });

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
  };

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
    ws.on("close", () => clients.delete(ws));
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
      void handleMessage(msg, ws, workspace, refreshTree).catch((e) => {
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

async function handleMessage(
  msg: ClientMessage,
  ws: WebSocket,
  workspace: Workspace,
  refreshTree: () => Promise<void>,
): Promise<void> {
  const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
  switch (msg.kind) {
    case "hello":
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
