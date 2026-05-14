import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  destroyWorkspace,
  launchCli,
  makeWorkspace,
  waitFor,
  type LaunchedCli,
} from "./helpers.ts";
import type { ServerMessage, ClientMessage } from "../src/shared/protocol.ts";

type WsClient = {
  send: (m: ClientMessage) => void;
  next: <K extends ServerMessage["kind"]>(
    kind: K,
  ) => Promise<Extract<ServerMessage, { kind: K }>>;
  close: () => void;
};

async function connectWs(url: string): Promise<WsClient> {
  const wsUrl = url.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsUrl}/ws`);
  const buffer: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerMessage;
    if (waiters.length > 0) {
      const next = waiters.shift();
      next?.(msg);
    } else {
      buffer.push(msg);
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });

  return {
    send: (m) => ws.send(JSON.stringify(m)),
    next: async (kind) => {
      for (;;) {
        // Drain buffer first.
        while (buffer.length > 0) {
          const m = buffer.shift();
          if (m && m.kind === kind) return m as Extract<ServerMessage, { kind: typeof kind }>;
        }
        const msg = await new Promise<ServerMessage>((res) => waiters.push(res));
        if (msg.kind === kind) return msg as Extract<ServerMessage, { kind: typeof kind }>;
      }
    },
    close: () => ws.close(),
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("server protocol", () => {
  let cwd: string;
  let cli: LaunchedCli;
  let client: WsClient;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\n", "sub/beta.md": "# beta\n" },
    });
    cli = launchCli(cwd, ["--port", "0", "--browser", "none"]);
    const url = await cli.url;
    client = await connectWs(url);
  });

  afterEach(async () => {
    client?.close();
    await cli?.stop();
    await destroyWorkspace(cwd);
  });

  // AC7: tree lists every file matching workspace glob (default docs/**/*.md)
  it("sends a tree containing every markdown file under docs/", async () => {
    client.send({ kind: "list" });
    const msg = await client.next("tree");
    const paths = collectPaths(msg.nodes);
    expect(paths).toEqual(expect.arrayContaining(["alpha.md", "sub/beta.md"]));
  });

  // AC9: file watcher refreshes the file tree on external add/remove
  it("emits treeChanged when a new file appears on disk", async () => {
    client.send({ kind: "list" });
    await client.next("tree");
    await writeFile(join(cwd, "docs", "gamma.md"), "# gamma\n");
    const update = await client.next("treeChanged");
    const paths = collectPaths(update.nodes);
    expect(paths).toContain("gamma.md");
  });

  it("emits treeChanged when a file disappears", async () => {
    client.send({ kind: "list" });
    await client.next("tree");
    await rm(join(cwd, "docs", "alpha.md"));
    const update = await client.next("treeChanged");
    const paths = collectPaths(update.nodes);
    expect(paths).not.toContain("alpha.md");
  });

  // AC9: refreshes the open buffer on external write
  it("emits diskChanged when an opened file is written externally", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    await client.next("fileOpen");
    await writeFile(join(cwd, "docs", "alpha.md"), "# alpha-changed\n");
    const update = await client.next("diskChanged");
    expect(update.content).toContain("alpha-changed");
    expect(update.path).toBe("alpha.md");
  });

  // AC10: Cmd-S save writes to disk and acks
  it("save persists content and acks with the new disk hash", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    const opened = await client.next("fileOpen");
    const newContent = "# alpha\n\nupdated\n";
    client.send({
      kind: "save",
      path: "alpha.md",
      content: newContent,
      baseHash: opened.diskHash,
    });
    const saved = await client.next("saved");
    expect(saved.diskHash).toBe(sha256(newContent));
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toBe(newContent);
  });

  // AC11: when base hash is stale (disk content changed externally),
  // server returns a save conflict so the editor can show the modal.
  it("returns saveConflict when baseHash is stale", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    await client.next("fileOpen");
    await writeFile(join(cwd, "docs", "alpha.md"), "# tampered\n");
    // Wait for the diskChanged broadcast to clear the queue.
    await client.next("diskChanged");
    client.send({
      kind: "save",
      path: "alpha.md",
      content: "# my-edit\n",
      baseHash: "deadbeef".repeat(8),
    });
    const conflict = await client.next("saveConflict");
    expect(conflict.path).toBe("alpha.md");
    expect(conflict.content).toContain("tampered");
  });

  // AC8: tree operations (new file, new folder, rename, delete)
  it("creates a new file inside the workspace", async () => {
    client.send({ kind: "newFile", parent: "", name: "fresh.md" });
    const update = await client.next("treeChanged");
    const paths = collectPaths(update.nodes);
    expect(paths).toContain("fresh.md");
  });

  it("creates a new folder inside the workspace", async () => {
    client.send({ kind: "newFolder", parent: "", name: "section" });
    const update = await client.next("treeChanged");
    const dirs = collectDirs(update.nodes);
    expect(dirs).toContain("section");
  });

  it("renames a file", async () => {
    client.send({ kind: "rename", from: "alpha.md", to: "alpha-renamed.md" });
    const update = await client.next("treeChanged");
    const paths = collectPaths(update.nodes);
    expect(paths).toContain("alpha-renamed.md");
    expect(paths).not.toContain("alpha.md");
  });

  it("deletes a file", async () => {
    client.send({ kind: "delete", path: "alpha.md" });
    const update = await client.next("treeChanged");
    const paths = collectPaths(update.nodes);
    expect(paths).not.toContain("alpha.md");
  });

  // AC5/AC7: scope filter is honored — files outside the glob are not in the tree.
  it("does not expose files outside the workspace glob", async () => {
    await writeFile(join(cwd, "README.md"), "# project readme\n");
    client.send({ kind: "list" });
    const msg = await client.next("tree");
    const paths = collectPaths(msg.nodes);
    expect(paths).not.toContain("../README.md");
    expect(paths.every((p) => p.endsWith(".md"))).toBe(true);
  });
});

function collectPaths(nodes: Array<{ path: string; kind: "file" | "dir"; children?: any[] }>): string[] {
  const out: string[] = [];
  const walk = (ns: typeof nodes) => {
    for (const n of ns) {
      if (n.kind === "file") out.push(n.path);
      if (n.children) walk(n.children as typeof nodes);
    }
  };
  walk(nodes);
  return out;
}

function collectDirs(nodes: Array<{ path: string; kind: "file" | "dir"; children?: any[] }>): string[] {
  const out: string[] = [];
  const walk = (ns: typeof nodes) => {
    for (const n of ns) {
      if (n.kind === "dir") out.push(n.path);
      if (n.children) walk(n.children as typeof nodes);
    }
  };
  walk(nodes);
  return out;
}

// Quiet the lint: waitFor is exported by helpers but not all suites use it here.
void waitFor;
