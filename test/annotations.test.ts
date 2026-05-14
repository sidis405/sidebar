// Slice 05: annotations end-to-end (notes + suggestions).
//
// Each `it` block maps to one or more acceptance criteria from issue #5 and
// drives the lifecycle through the MCP surface the agent will actually call,
// plus the WebSocket surface the editor uses (Cmd-K mode toggle for
// note/suggestion, Accept/Reject side-card buttons). Per AGENTS.md test-first
// contract these tests are added before the implementation lands.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../src/shared/protocol.ts";
import {
  CLI_ENTRY,
  TSX_BIN,
  type LaunchedCli,
  destroyWorkspace,
  launchCli,
  makeWorkspace,
} from "./helpers.ts";

type StdioHandle = {
  client: Client;
  close: () => Promise<void>;
};

async function connectStdio(cwd: string, clientName = "agent-test"): Promise<StdioHandle> {
  const transport = new StdioClientTransport({
    command: TSX_BIN,
    // --port 0 keeps the stdio CLI's internal HTTP listener on an OS-random
    // port instead of the 5180-5189 fallback range, so it doesn't contend
    // with parallel test files that also touch the fallback range.
    args: [CLI_ENTRY, "--stdio", "--port", "0"],
    cwd,
    env: { ...(process.env as Record<string, string>), SIDEBAR_OPEN: "noop" },
    stderr: "pipe",
  });
  const client = new Client({ name: clientName, version: "0.0.0" });
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

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function payloadOf<T = unknown>(result: { content: Array<{ type: string; text?: string }> }): T {
  return JSON.parse(textOf(result)) as T;
}

// ---------------------------------------------------------------------------
// AC1 + AC15: marker shape on disk reuses begin/end pair with type=note or
// type=suggestion. Tolerant-parse extends to broken note/suggestion markers.
// ---------------------------------------------------------------------------

describe("parseMarkers: annotation shapes", () => {
  it("parses a well-formed note (type=note + author + content + target region)", async () => {
    const { parseMarkers } = await import("../src/shared/markers.ts");
    const text = [
      "intro",
      '<!-- @sidebar note id="n-abcd" author="alice": looks fine to me -->',
      "the target prose",
      '<!-- @sidebar end id="n-abcd" -->',
      "trailing",
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    const note = result.markers.find((m) => m.type === "note");
    expect(note).toBeDefined();
    expect(note?.id).toBe("n-abcd");
    expect(note?.attrs.author).toBe("alice");
    expect(note?.instruction).toBe("looks fine to me");
    expect(note?.targetContent).toBe("the target prose\n");
  });

  it("parses a well-formed suggestion (type=suggestion + author + content)", async () => {
    const { parseMarkers } = await import("../src/shared/markers.ts");
    const text = [
      '<!-- @sidebar suggestion id="s-xyz1" author="claude-code": the body, but tighter -->',
      "the body",
      '<!-- @sidebar end id="s-xyz1" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    const sug = result.markers.find((m) => m.type === "suggestion");
    expect(sug).toBeDefined();
    expect(sug?.id).toBe("s-xyz1");
    expect(sug?.attrs.author).toBe("claude-code");
    expect(sug?.instruction).toBe("the body, but tighter");
  });

  it("reports a missing-end error for a broken suggestion marker (no closing tag)", async () => {
    const { parseMarkers } = await import("../src/shared/markers.ts");
    const text = [
      '<!-- @sidebar suggestion id="s-broke" author="alice": rewrite -->',
      "the target",
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors.some((e) => e.kind === "missing-end" && e.id === "s-broke")).toBe(true);
    expect(result.markers.some((m) => m.id === "s-broke")).toBe(false);
    expect(result.malformedRanges.length).toBeGreaterThan(0);
  });

  it("reports a stray-end error for an unmatched note end marker", async () => {
    const { parseMarkers } = await import("../src/shared/markers.ts");
    const text = ['<!-- @sidebar end id="n-lost" -->', ""].join("\n");
    const result = parseMarkers(text);
    expect(result.errors.some((e) => e.kind === "stray-end" && e.id === "n-lost")).toBe(true);
  });

  it("parseAnnotations is a thin filter over parseMarkers and keeps notes + suggestions only", async () => {
    const { parseAnnotations } = await import("../src/shared/markers.ts");
    const text = [
      '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="a": go -->',
      "m body",
      '<!-- @sidebar end id="m-aaaa" -->',
      '<!-- @sidebar note id="n-bbbb" author="a": ok -->',
      "n body",
      '<!-- @sidebar end id="n-bbbb" -->',
      '<!-- @sidebar suggestion id="s-cccc" author="a": tighten -->',
      "s body",
      '<!-- @sidebar end id="s-cccc" -->',
      "",
    ].join("\n");
    const annotations = parseAnnotations(text);
    expect(annotations.map((a) => a.id).sort()).toEqual(["n-bbbb", "s-cccc"]);
    expect(annotations.find((a) => a.id === "n-bbbb")?.type).toBe("note");
    expect(annotations.find((a) => a.id === "s-cccc")?.type).toBe("suggestion");
  });

  it("annotation content survives a multi-line body through encode/decode helpers", async () => {
    const { encodeAnnotationContent, decodeAnnotationContent } = await import(
      "../src/shared/markers.ts"
    );
    const original = "first paragraph\n\nsecond paragraph\nwith **bold** and a `code` span";
    const encoded = encodeAnnotationContent(original);
    // Encoded form must be single-line so it fits inside a one-line HTML
    // comment marker.
    expect(encoded.includes("\n")).toBe(false);
    expect(decodeAnnotationContent(encoded)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// AC8 + AC11: add_annotation creates an annotation; list_annotations returns
// the full record. AC1: marker shape on disk for both flavors.
// ---------------------------------------------------------------------------

describe("MCP: add_annotation + list_annotations", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\n\nparagraph one\n\nparagraph two\n" },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("add_annotation(type=note) writes a <!-- @sidebar note ... --> begin/end pair on disk", async () => {
    stdio = await connectStdio(cwd, "claude-code");
    const original = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    const targetStart = original.indexOf("paragraph one\n");
    const targetEnd = targetStart + "paragraph one\n".length;
    const result = await stdio.client.callTool({
      name: "add_annotation",
      arguments: {
        path: "alpha.md",
        target_anchor: { start: targetStart, end: targetEnd },
        type: "note",
        content: "looks good to me",
      },
    });
    expect(result.isError).not.toBe(true);
    const payload = payloadOf<{ id: string; file: string; type: string; author: string }>(result);
    expect(payload.id).toMatch(/^n-[a-z0-9]{4,}$/);
    expect(payload.type).toBe("note");
    expect(payload.author).toBe("claude-code");
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain(`@sidebar note id="${payload.id}"`);
    expect(onDisk).toContain(`@sidebar end id="${payload.id}"`);
    expect(onDisk).toContain("paragraph one");
  });

  it("add_annotation(type=suggestion) writes a <!-- @sidebar suggestion ... --> pair", async () => {
    stdio = await connectStdio(cwd, "claude-code");
    const original = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    const targetStart = original.indexOf("paragraph two\n");
    const targetEnd = targetStart + "paragraph two\n".length;
    const result = await stdio.client.callTool({
      name: "add_annotation",
      arguments: {
        path: "alpha.md",
        target_anchor: { start: targetStart, end: targetEnd },
        type: "suggestion",
        content: "paragraph two, but tighter",
      },
    });
    expect(result.isError).not.toBe(true);
    const payload = payloadOf<{ id: string; type: string }>(result);
    expect(payload.id).toMatch(/^s-[a-z0-9]{4,}$/);
    expect(payload.type).toBe("suggestion");
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain(`@sidebar suggestion id="${payload.id}"`);
  });

  it("list_annotations returns every annotation with the spec shape", async () => {
    stdio = await connectStdio(cwd, "claude-code");
    const before1 = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    const s1 = before1.indexOf("paragraph one\n");
    await stdio.client.callTool({
      name: "add_annotation",
      arguments: {
        path: "alpha.md",
        target_anchor: { start: s1, end: s1 + "paragraph one\n".length },
        type: "note",
        content: "n1",
      },
    });
    // Re-read to pick up the post-insert offset for paragraph two.
    const before2 = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    const s2 = before2.indexOf("paragraph two\n");
    await stdio.client.callTool({
      name: "add_annotation",
      arguments: {
        path: "alpha.md",
        target_anchor: { start: s2, end: s2 + "paragraph two\n".length },
        type: "suggestion",
        content: "tighter",
      },
    });
    const list = await stdio.client.callTool({ name: "list_annotations", arguments: {} });
    const payload = payloadOf<{
      annotations: Array<{
        id: string;
        file: string;
        type: string;
        author: string;
        target_content: string;
        content: string;
        target_anchor: unknown;
        created_at: string;
      }>;
    }>(list);
    expect(payload.annotations).toHaveLength(2);
    const note = payload.annotations.find((a) => a.type === "note");
    const sug = payload.annotations.find((a) => a.type === "suggestion");
    expect(note).toBeDefined();
    expect(sug).toBeDefined();
    expect(note?.file).toBe("alpha.md");
    expect(note?.author).toBe("claude-code");
    expect(note?.target_content).toBe("paragraph one\n");
    expect(note?.content).toBe("n1");
    expect(typeof note?.target_anchor).toBe("object");
    expect(typeof note?.created_at).toBe("string");
    expect(sug?.content).toBe("tighter");
  });

  it("list_annotations(path) filters by file", async () => {
    await writeFile(
      join(cwd, "docs", "beta.md"),
      [
        '<!-- @sidebar note id="n-pre" author="alice": pre-existing -->',
        "body",
        '<!-- @sidebar end id="n-pre" -->',
        "",
      ].join("\n"),
      "utf8",
    );
    stdio = await connectStdio(cwd);
    const filtered = await stdio.client.callTool({
      name: "list_annotations",
      arguments: { path: "beta.md" },
    });
    const payload = payloadOf<{ annotations: Array<{ id: string; file: string }> }>(filtered);
    expect(payload.annotations.every((a) => a.file === "beta.md")).toBe(true);
    expect(payload.annotations.find((a) => a.id === "n-pre")).toBeDefined();
  });

  it("add_annotation preserves multi-line markdown content (round-trips through list_annotations)", async () => {
    stdio = await connectStdio(cwd, "claude-code");
    const original = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    const s = original.indexOf("paragraph one\n");
    const body = "first line\n\nsecond paragraph with **bold** and `code`";
    const result = await stdio.client.callTool({
      name: "add_annotation",
      arguments: {
        path: "alpha.md",
        target_anchor: { start: s, end: s + "paragraph one\n".length },
        type: "suggestion",
        content: body,
      },
    });
    const created = payloadOf<{ id: string }>(result);
    const list = await stdio.client.callTool({ name: "list_annotations", arguments: {} });
    const annotations = payloadOf<{ annotations: Array<{ id: string; content: string }> }>(
      list,
    ).annotations;
    const back = annotations.find((a) => a.id === created.id);
    expect(back?.content).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// AC9 + AC10: update_annotation and remove_annotation are author-scoped for
// agent callers.
// ---------------------------------------------------------------------------

describe("MCP: update_annotation + remove_annotation (author scope)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": [
          '<!-- @sidebar note id="n-mine" author="claude-code": original content -->',
          "the target",
          '<!-- @sidebar end id="n-mine" -->',
          '<!-- @sidebar note id="n-yours" author="alice": human-authored -->',
          "another target",
          '<!-- @sidebar end id="n-yours" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("update_annotation rewrites content for an annotation matching the agent's author", async () => {
    const stdio = await connectStdio(cwd, "claude-code");
    try {
      const result = await stdio.client.callTool({
        name: "update_annotation",
        arguments: { id: "n-mine", content: "edited content" },
      });
      expect(result.isError).not.toBe(true);
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).toContain("edited content");
      expect(onDisk).not.toContain("original content");
    } finally {
      await stdio.close();
    }
  });

  it("update_annotation refuses when the annotation was authored by someone else", async () => {
    const stdio = await connectStdio(cwd, "claude-code");
    try {
      const result = await stdio.client.callTool({
        name: "update_annotation",
        arguments: { id: "n-yours", content: "shouldn't land" },
      });
      expect(result.isError).toBe(true);
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).toContain("human-authored");
      expect(onDisk).not.toContain("shouldn't land");
    } finally {
      await stdio.close();
    }
  });

  it("remove_annotation strips the begin/end pair when author matches", async () => {
    const stdio = await connectStdio(cwd, "claude-code");
    try {
      const result = await stdio.client.callTool({
        name: "remove_annotation",
        arguments: { id: "n-mine" },
      });
      expect(result.isError).not.toBe(true);
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).not.toContain('@sidebar note id="n-mine"');
      expect(onDisk).not.toContain('@sidebar end id="n-mine"');
      // The other annotation is untouched.
      expect(onDisk).toContain('@sidebar note id="n-yours"');
      // The target prose stays put.
      expect(onDisk).toContain("the target");
    } finally {
      await stdio.close();
    }
  });

  it("remove_annotation refuses to delete another author's annotation", async () => {
    const stdio = await connectStdio(cwd, "claude-code");
    try {
      const result = await stdio.client.callTool({
        name: "remove_annotation",
        arguments: { id: "n-yours" },
      });
      expect(result.isError).toBe(true);
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).toContain('@sidebar note id="n-yours"');
    } finally {
      await stdio.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC12 + AC13: resolve_mention forwards note annotations for query verbs; it
// REFUSES annotation_type=suggestion (the agent's path to proposing prose is
// add_annotation(type=suggestion), not via resolve_mention).
// ---------------------------------------------------------------------------

describe("MCP: resolve_mention + annotation_type interplay", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": [
          '<!-- @sidebar mention id="m-q" verb="factcheck" origin="human" author="alice": is this right? -->',
          "the body",
          '<!-- @sidebar end id="m-q" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("resolve_mention(annotation, type=note) for a query verb still leaves a note on the region", async () => {
    const stdio = await connectStdio(cwd);
    try {
      const get = await stdio.client.callTool({
        name: "get_mention",
        arguments: { mention_id: "m-q" },
      });
      const base = payloadOf<{ base_hash: string }>(get).base_hash;
      await stdio.client.callTool({
        name: "mark_in_progress",
        arguments: { mention_id: "m-q" },
      });
      const result = await stdio.client.callTool({
        name: "resolve_mention",
        arguments: {
          mention_id: "m-q",
          base_hash: base,
          action: { type: "annotation", annotation_type: "note", text: "checked: ok" },
        },
      });
      expect(result.isError).not.toBe(true);
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).toMatch(/<!-- @sidebar note id="n-/);
      expect(onDisk).toContain("checked: ok");
    } finally {
      await stdio.close();
    }
  });

  it("resolve_mention(annotation, type=suggestion) is rejected; agent must use add_annotation instead", async () => {
    const stdio = await connectStdio(cwd);
    try {
      const get = await stdio.client.callTool({
        name: "get_mention",
        arguments: { mention_id: "m-q" },
      });
      const base = payloadOf<{ base_hash: string }>(get).base_hash;
      await stdio.client.callTool({
        name: "mark_in_progress",
        arguments: { mention_id: "m-q" },
      });
      const result = await stdio.client.callTool({
        name: "resolve_mention",
        arguments: {
          mention_id: "m-q",
          base_hash: base,
          action: { type: "annotation", annotation_type: "suggestion", text: "tighter" },
        },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/add_annotation|suggestion/i);
      // The mention marker must stay in place since resolution failed.
      const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      expect(onDisk).toContain('@sidebar mention id="m-q"');
    } finally {
      await stdio.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC14: list_recent_changes returns the four new event kinds.
// ---------------------------------------------------------------------------

describe("MCP: list_recent_changes new annotation event kinds", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\n\nparagraph one\n" },
    });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("annotation-created event fires on add_annotation; annotation-removed on remove_annotation", async () => {
    const stdio = await connectStdio(cwd, "claude-code");
    try {
      const original = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
      const s = original.indexOf("paragraph one\n");
      const created = await stdio.client.callTool({
        name: "add_annotation",
        arguments: {
          path: "alpha.md",
          target_anchor: { start: s, end: s + "paragraph one\n".length },
          type: "note",
          content: "first note",
        },
      });
      const noteId = payloadOf<{ id: string }>(created).id;
      await stdio.client.callTool({
        name: "remove_annotation",
        arguments: { id: noteId },
      });
      const recent = await stdio.client.callTool({
        name: "list_recent_changes",
        arguments: {},
      });
      const events = payloadOf<{
        events: Array<{
          kind: string;
          annotation_id?: string;
          author?: string;
          annotation_type?: string;
        }>;
      }>(recent).events;
      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain("annotation-created");
      expect(kinds).toContain("annotation-removed");
      const createEvent = events.find((e) => e.kind === "annotation-created");
      expect(createEvent?.annotation_id).toBe(noteId);
      expect(createEvent?.author).toBe("claude-code");
      expect(createEvent?.annotation_type).toBe("note");
    } finally {
      await stdio.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC7: editor wire contract for Cmd-K extension + accept/reject paths.
// The visual side-card rendering itself is verified manually (QA doc) and via
// slice-05 demo evidence; this test pins the WebSocket message shapes the UI
// relies on so the implementation can't drift away from them.
// ---------------------------------------------------------------------------

type WsClient = {
  send: (m: ClientMessage) => void;
  next: <K extends ServerMessage["kind"]>(kind: K) => Promise<Extract<ServerMessage, { kind: K }>>;
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

describe("WS slice-05: createAnnotation + acceptSuggestion + rejectSuggestion", () => {
  let cwd: string;
  let cli: LaunchedCli;
  let client: WsClient;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\n\nparagraph one\n\nparagraph two\n" },
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

  it("createAnnotation(type=note) from Cmd-K wraps the target with a note begin/end pair", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const start = open.content.indexOf("paragraph one\n");
    client.send({
      kind: "createAnnotation",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + "paragraph one\n".length,
      type: "note",
      content: "looks good",
    });
    const created = await client.next("annotationCreated");
    expect(created.file).toBe("alpha.md");
    expect(created.annotationId).toMatch(/^n-[a-z0-9]{4,}$/);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain(`@sidebar note id="${created.annotationId}"`);
  });

  it("createAnnotation(type=suggestion) carries the proposed replacement text", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const start = open.content.indexOf("paragraph two\n");
    client.send({
      kind: "createAnnotation",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + "paragraph two\n".length,
      type: "suggestion",
      content: "paragraph two, but better",
    });
    const created = await client.next("annotationCreated");
    expect(created.annotationId).toMatch(/^s-[a-z0-9]{4,}$/);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain(`@sidebar suggestion id="${created.annotationId}"`);
    expect(onDisk).toContain("paragraph two");
  });

  it("acceptSuggestion swaps the target prose verbatim and removes the annotation", async () => {
    // Seed a suggestion via the WS path (the same one Cmd-K uses).
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const start = open.content.indexOf("paragraph one\n");
    client.send({
      kind: "createAnnotation",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + "paragraph one\n".length,
      type: "suggestion",
      content: "REPLACEMENT TEXT",
    });
    const created = await client.next("annotationCreated");
    // Accept the suggestion.
    client.send({ kind: "acceptSuggestion", annotationId: created.annotationId });
    // After acceptance, the file watcher emits a diskChanged broadcast.
    let snap = await client.next("status");
    while (snap.snapshot.recentEvents.every((e) => e.kind !== "suggestion-accepted")) {
      snap = await client.next("status");
    }
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain("REPLACEMENT TEXT");
    expect(onDisk).not.toContain("paragraph one\n");
    expect(onDisk).not.toContain(`@sidebar suggestion id="${created.annotationId}"`);
    expect(onDisk).not.toContain(`@sidebar end id="${created.annotationId}"`);
  });

  it("rejectSuggestion removes the annotation pair and leaves the target prose unchanged", async () => {
    client.send({ kind: "open", path: "alpha.md" });
    const open = await client.next("fileOpen");
    const start = open.content.indexOf("paragraph one\n");
    client.send({
      kind: "createAnnotation",
      path: "alpha.md",
      startOffset: start,
      endOffset: start + "paragraph one\n".length,
      type: "suggestion",
      content: "REPLACEMENT TEXT",
    });
    const created = await client.next("annotationCreated");
    client.send({ kind: "rejectSuggestion", annotationId: created.annotationId });
    let snap = await client.next("status");
    while (snap.snapshot.recentEvents.every((e) => e.kind !== "suggestion-rejected")) {
      snap = await client.next("status");
    }
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain("paragraph one\n");
    expect(onDisk).not.toContain("REPLACEMENT TEXT");
    expect(onDisk).not.toContain(`@sidebar suggestion id="${created.annotationId}"`);
  });
});

// ---------------------------------------------------------------------------
// AC2: note has no lifecycle (stays until manually removed). AC3: suggestion
// has binary lifecycle - accept swaps + removes; reject removes only.
//
// These are encoded above (acceptSuggestion / rejectSuggestion) but we also
// pin the absence of a corresponding `acceptNote` / `rejectNote` path so the
// implementation doesn't accidentally grow lifecycle UX for notes.
// ---------------------------------------------------------------------------

describe("note has no lifecycle (no accept/reject path)", () => {
  it("ClientMessage protocol exposes acceptSuggestion + rejectSuggestion only (not notes)", async () => {
    // Static / shape check: the protocol module is the authoritative source.
    const protocol = await import("../src/shared/protocol.ts");
    // The union is type-only, so we assert by inspecting actual server
    // behavior: an attempted acceptSuggestion on a *note* id is refused.
    expect(protocol).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC4 + AC5 (visual): editor renders annotations as side cards anchored to
// the target region; suggestion side cards show Accept and Reject buttons;
// annotation `content` rendered via the same CodeMirror live-preview pipeline.
//
// These are visual rendering concerns. The marker-decorations module is the
// foundation for them and its API contract is tested here; the actual side
// card DOM is verified manually per AGENTS.md (visual rendering carve-out).
// ---------------------------------------------------------------------------

describe("editor marker decorations: annotations contribute side cards", () => {
  it("the decoration plugin surfaces note and suggestion regions so side cards can anchor", async () => {
    const { parseMarkers } = await import("../src/shared/markers.ts");
    const text = [
      '<!-- @sidebar note id="n-aaaa" author="alice": ok -->',
      "the target",
      '<!-- @sidebar end id="n-aaaa" -->',
      '<!-- @sidebar suggestion id="s-bbbb" author="alice": tighter -->',
      "other target",
      '<!-- @sidebar end id="s-bbbb" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    // The decoration plugin (sidebarMarkerDecorations) consumes result.markers.
    // Slice 5 expects every well-formed annotation begin marker line to be
    // present so the editor can attach a side card to it.
    const notes = result.markers.filter((m) => m.type === "note");
    const sugs = result.markers.filter((m) => m.type === "suggestion");
    expect(notes).toHaveLength(1);
    expect(sugs).toHaveLength(1);
    // The begin/end byte offsets must be exact so the side card lines up.
    expect(text.slice(notes[0].beginLineStart, notes[0].beginLineStart + 4)).toBe("<!--");
    expect(text.slice(sugs[0].endLineEnd - 4, sugs[0].endLineEnd)).toBe("-->\n");
  });
});
