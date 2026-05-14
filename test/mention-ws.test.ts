// Slice 04 WebSocket-side acceptance:
//  - editor Cmd-K -> server `createMention` writes a marker on disk
//  - status drawer right-click -> `cancelMention` strips the begin/end pair
//  - editor first message asks for `verbCatalog`; server replies with the
//    built-ins plus any custom verbs from .sidebar/config.json
//
// The browser bits (popover rendering, decoration painting) are exercised by
// the demo evidence in docs/demo/slice-04/. These tests confirm the wire
// contract behind them.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../src/shared/protocol.ts";
import {
  type LaunchedCli,
  destroyWorkspace,
  launchCli,
  makeWorkspace,
} from "./helpers.ts";

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

describe("WS slice-04: verb catalog + mention round-trip + cancel", () => {
  let cwd: string;
  let cli: LaunchedCli;
  let client: WsClient;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\nparagraph one\n" },
    });
    // Custom verb so we can prove the editor sees it.
    await mkdir(join(cwd, ".sidebar"), { recursive: true });
    await writeFile(
      join(cwd, ".sidebar", "config.json"),
      JSON.stringify({
        version: 1,
        verbs: { human: { tighten: { mode: "replace" } } },
      }),
      "utf8",
    );
    cli = launchCli(cwd, ["--port", "0", "--browser", "none"]);
    const url = await cli.url;
    client = await connectWs(url);
  });

  afterEach(async () => {
    client?.close();
    await cli?.stop();
    await destroyWorkspace(cwd);
  });

  it("verbCatalog reply lists built-in human verbs plus any custom ones", async () => {
    client.send({ kind: "verbCatalog" });
    const reply = await client.next("verbCatalog");
    const humanNames = reply.catalog.human.map((v) => v.name);
    // Built-ins from the spec table.
    expect(humanNames).toEqual(
      expect.arrayContaining([
        "rephrase",
        "expand",
        "shorten",
        "remove-if-redundant",
        "factcheck",
        "question",
        "review",
        "explain",
      ]),
    );
    // Custom verb from .sidebar/config.json shows up too.
    expect(humanNames).toContain("tighten");
    const tighten = reply.catalog.human.find((v) => v.name === "tighten");
    expect(tighten?.kind).toBe("human-replace");
    expect(tighten?.builtin).toBe(false);
  });

  it("createMention writes a begin/end pair around the selection and emits status", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const target = "paragraph one\n";
    const start = open.content.indexOf(target);
    expect(start).toBeGreaterThan(-1);
    client.send({
      kind: "createMention",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + target.length,
      verb: "rephrase",
      instruction: "tighten this",
    });
    const created = await client.next("mentionCreated");
    expect(created.file).toBe("alpha.md");
    expect(created.mentionId).toMatch(/^m-[a-z0-9]{4,}$/);

    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain(`@sidebar mention id="${created.mentionId}"`);
    expect(onDisk).toContain("verb=\"rephrase\"");
    expect(onDisk).toContain("origin=\"human\"");
    expect(onDisk).toContain("paragraph one");
    expect(onDisk).toContain(`@sidebar end id="${created.mentionId}"`);

    const status = await client.next("status");
    const found = status.snapshot.pendingMentions.find((m) => m.id === created.mentionId);
    expect(found).toBeDefined();
    expect(found?.verb).toBe("rephrase");
    expect(found?.instruction).toBe("tighten this");
  });

  it("cancelMention strips the begin/end pair from the file", async () => {
    // Seed a marker.
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const target = "paragraph one\n";
    const start = open.content.indexOf(target);
    client.send({
      kind: "createMention",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + target.length,
      verb: "rephrase",
      instruction: "noop",
    });
    const created = await client.next("mentionCreated");
    // The createMention path emits a status snapshot WITH the new mention;
    // drain it before issuing the cancel so the next status we await is the
    // post-cancel one.
    let snapshotAfterCreate = await client.next("status");
    while (
      !snapshotAfterCreate.snapshot.pendingMentions.find((m) => m.id === created.mentionId)
    ) {
      snapshotAfterCreate = await client.next("status");
    }
    client.send({ kind: "cancelMention", mentionId: created.mentionId });
    let snap = await client.next("status");
    while (snap.snapshot.pendingMentions.find((m) => m.id === created.mentionId)) {
      snap = await client.next("status");
    }
    expect(snap.snapshot.pendingMentions.find((m) => m.id === created.mentionId)).toBeUndefined();
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).not.toContain(`@sidebar mention id="${created.mentionId}"`);
    expect(onDisk).not.toContain(`@sidebar end id="${created.mentionId}"`);
    expect(onDisk).toContain("paragraph one");
  });
});
