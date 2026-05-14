// Slice 04: end-to-end mention lifecycle.
//
// Each `it` block maps to one or more acceptance criteria from issue #4 and
// drives the lifecycle through the MCP surface the agent will actually call.
// Per AGENTS.md test-first contract these tests are added before the
// implementation lands.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CLI_ENTRY,
  TSX_BIN,
  destroyWorkspace,
  makeWorkspace,
} from "./helpers.ts";

type StdioHandle = {
  client: Client;
  close: () => Promise<void>;
};

async function connectStdio(
  cwd: string,
  clientName = "agent-test",
  extraEnv: Record<string, string> = {},
): Promise<StdioHandle> {
  const transport = new StdioClientTransport({
    command: TSX_BIN,
    // --port 0 keeps the stdio CLI's internal HTTP listener on an OS-random
    // port instead of the 5180-5189 fallback range, so it doesn't contend
    // with parallel test files that also touch the fallback range.
    args: [CLI_ENTRY, "--stdio", "--port", "0"],
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      SIDEBAR_OPEN: "noop",
      ...extraEnv,
    },
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

describe("MCP: list_pending_mentions and get_mention", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": [
          "# alpha",
          "",
          '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="alice": tighten this -->',
          "body line one",
          "body line two",
          '<!-- @sidebar end id="m-aaaa" -->',
          "",
        ].join("\n"),
        "beta.md": [
          "# beta",
          "",
          '<!-- @sidebar mention id="m-bbbb" verb="factcheck" origin="human" author="bob": is this right? -->',
          "facts under review",
          '<!-- @sidebar end id="m-bbbb" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("list_pending_mentions returns every open mention across files with the spec shape", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "list_pending_mentions",
      arguments: {},
    });
    const payload = payloadOf<{ mentions: Array<Record<string, unknown>> }>(result);
    expect(payload.mentions).toHaveLength(2);
    const alpha = payload.mentions.find((m) => m.id === "m-aaaa");
    expect(alpha).toMatchObject({
      id: "m-aaaa",
      file: "alpha.md",
      origin: "human",
      verb: "rephrase",
      instruction: "tighten this",
      target_content: "body line one\nbody line two\n",
    });
    expect(typeof alpha?.base_hash).toBe("string");
    expect(typeof alpha?.created_at).toBe("string");
  });

  it("get_mention returns the same shape for a single mention", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-aaaa" },
    });
    const payload = payloadOf<{ id: string; target_content: string; base_hash: string }>(result);
    expect(payload.id).toBe("m-aaaa");
    expect(payload.target_content).toBe("body line one\nbody line two\n");
    expect(payload.base_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("get_mention on an unknown id returns an MCP error", async () => {
    stdio = await connectStdio(cwd);
    const result = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-missing" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP: mark_in_progress and resolve_mention", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": [
          '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="alice": tighten this -->',
          "the body",
          '<!-- @sidebar end id="m-aaaa" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("mark_in_progress claims the mention; a second caller gets a conflict naming the winner", async () => {
    stdio = await connectStdio(cwd, "first-claimer");
    const claim = await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    expect(claim.isError).not.toBe(true);

    const second = await connectStdio(cwd, "second-claimer");
    try {
      const conflict = await second.client.callTool({
        name: "mark_in_progress",
        arguments: { mention_id: "m-aaaa" },
      });
      expect(conflict.isError).toBe(true);
      expect(textOf(conflict)).toMatch(/first-claimer/);
    } finally {
      await second.close();
    }
  });

  it("resolve_mention with type=replace overwrites only the target region (markers go with it)", async () => {
    stdio = await connectStdio(cwd);
    const get = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-aaaa" },
    });
    const base = payloadOf<{ base_hash: string }>(get).base_hash;
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    const result = await stdio.client.callTool({
      name: "resolve_mention",
      arguments: {
        mention_id: "m-aaaa",
        base_hash: base,
        action: { type: "replace", content: "TIGHTENED\n" },
      },
    });
    expect(result.isError).not.toBe(true);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain("TIGHTENED");
    expect(onDisk).not.toContain("@sidebar mention id=\"m-aaaa\"");
    expect(onDisk).not.toContain("@sidebar end id=\"m-aaaa\"");
  });

  it("resolve_mention with type=annotation leaves a note marker in place of the begin/end pair", async () => {
    stdio = await connectStdio(cwd);
    const get = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-aaaa" },
    });
    const base = payloadOf<{ base_hash: string }>(get).base_hash;
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    const result = await stdio.client.callTool({
      name: "resolve_mention",
      arguments: {
        mention_id: "m-aaaa",
        base_hash: base,
        action: { type: "annotation", annotation_type: "note", text: "checked: ok" },
      },
    });
    expect(result.isError).not.toBe(true);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    // Mention marker is gone; the original target prose remains; a new note
    // annotation wraps the same region.
    expect(onDisk).not.toContain("@sidebar mention id=\"m-aaaa\"");
    expect(onDisk).toContain("the body");
    expect(onDisk).toMatch(/<!-- @sidebar note id="n-/);
    expect(onDisk).toContain("checked: ok");
  });

  it("resolve_mention rejects a stale base_hash and the marker stays in place", async () => {
    stdio = await connectStdio(cwd);
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    const result = await stdio.client.callTool({
      name: "resolve_mention",
      arguments: {
        mention_id: "m-aaaa",
        base_hash: "0000000000000000",
        action: { type: "replace", content: "TIGHTENED\n" },
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/base_hash|conflict|stale/i);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain("@sidebar mention id=\"m-aaaa\"");
  });

  it("report_error releases the claim so a different agent can claim it", async () => {
    stdio = await connectStdio(cwd, "first-claimer");
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    const reported = await stdio.client.callTool({
      name: "report_error",
      arguments: { mention_id: "m-aaaa", reason: "ran out of context" },
    });
    expect(reported.isError).not.toBe(true);

    const second = await connectStdio(cwd, "second-claimer");
    try {
      const claim = await second.client.callTool({
        name: "mark_in_progress",
        arguments: { mention_id: "m-aaaa" },
      });
      expect(claim.isError).not.toBe(true);
    } finally {
      await second.close();
    }
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    // Marker stays in place after report_error.
    expect(onDisk).toContain("@sidebar mention id=\"m-aaaa\"");
  });

  it("resolve_mention defaults to annotation mode when the verb is unknown (safe default)", async () => {
    // Replace the existing marker with one carrying an unknown verb so the
    // catalog cannot map it to a target mode. resolve(replace) should be
    // refused; resolve(annotation/note) should succeed.
    const alphaPath = join(cwd, "docs", "alpha.md");
    await writeFile(
      alphaPath,
      [
        '<!-- @sidebar mention id="m-unk" verb="not-a-verb" origin="human" author="alice": go -->',
        "the body",
        '<!-- @sidebar end id="m-unk" -->',
        "",
      ].join("\n"),
      "utf8",
    );
    stdio = await connectStdio(cwd);
    const get = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-unk" },
    });
    const base = payloadOf<{ base_hash: string }>(get).base_hash;
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-unk" },
    });
    const replace = await stdio.client.callTool({
      name: "resolve_mention",
      arguments: {
        mention_id: "m-unk",
        base_hash: base,
        action: { type: "replace", content: "x\n" },
      },
    });
    expect(replace.isError).toBe(true);
    expect(textOf(replace)).toMatch(/annotation|unknown verb/i);
  });
});

describe("MCP: list_recent_changes", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "alpha.md": [
          '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="alice": go -->',
          "the body",
          '<!-- @sidebar end id="m-aaaa" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("returns an ordered ring buffer of events; emits claim and resolve entries", async () => {
    stdio = await connectStdio(cwd, "ringbuf-agent");
    const get = await stdio.client.callTool({
      name: "get_mention",
      arguments: { mention_id: "m-aaaa" },
    });
    const base = payloadOf<{ base_hash: string }>(get).base_hash;
    await stdio.client.callTool({
      name: "mark_in_progress",
      arguments: { mention_id: "m-aaaa" },
    });
    await stdio.client.callTool({
      name: "resolve_mention",
      arguments: {
        mention_id: "m-aaaa",
        base_hash: base,
        action: { type: "replace", content: "DONE\n" },
      },
    });
    const result = await stdio.client.callTool({
      name: "list_recent_changes",
      arguments: {},
    });
    const payload = payloadOf<{
      events: Array<{ id: number; kind: string; mention_id?: string; author?: string }>;
    }>(result);
    expect(payload.events.length).toBeGreaterThanOrEqual(2);
    const kinds = payload.events.map((e) => e.kind);
    expect(kinds).toContain("mention-claimed");
    expect(kinds).toContain("mention-resolved");
    // The `since` cursor is honored: passing the last id returns nothing newer.
    const lastId = payload.events[payload.events.length - 1].id;
    const after = await stdio.client.callTool({
      name: "list_recent_changes",
      arguments: { since: lastId },
    });
    const afterPayload = payloadOf<{ events: unknown[] }>(after);
    expect(afterPayload.events).toEqual([]);
  });
});

describe("MCP: malformed marker handling", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: {
        "broken.md": [
          '<!-- @sidebar mention id="m-stray" verb="rephrase" origin="human" author="alice": go -->',
          "orphaned content without a closing tag",
          "",
        ].join("\n"),
        "ok.md": [
          '<!-- @sidebar mention id="m-good" verb="rephrase" origin="human" author="alice": go -->',
          "body",
          '<!-- @sidebar end id="m-good" -->',
          "",
        ].join("\n"),
      },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("malformed markers are skipped in list_pending_mentions and the file still reads via read_doc", async () => {
    stdio = await connectStdio(cwd);
    const list = await stdio.client.callTool({
      name: "list_pending_mentions",
      arguments: {},
    });
    const payload = payloadOf<{ mentions: Array<{ id: string; file: string }> }>(list);
    const ids = payload.mentions.map((m) => m.id);
    expect(ids).toContain("m-good");
    expect(ids).not.toContain("m-stray");
    const read = await stdio.client.callTool({
      name: "read_doc",
      arguments: { path: "broken.md" },
    });
    expect(read.isError).not.toBe(true);
    expect(payloadOf<{ content: string }>(read).content).toContain("@sidebar mention id=\"m-stray\"");
  });
});

describe("MCP: human-author resolution on Cmd-K mention creation", () => {
  let cwd: string;
  let stdio: StdioHandle | null = null;

  beforeEach(async () => {
    cwd = await makeWorkspace({
      docs: { "alpha.md": "# alpha\nparagraph one\n" },
    });
  });
  afterEach(async () => {
    if (stdio) await stdio.close();
    stdio = null;
    await destroyWorkspace(cwd);
  });

  it("server-side createMention writes a begin/end pair with a generated id and the resolved author", async () => {
    // Drive the editor-side intent through a server entry point that
    // assembles the marker just as Cmd-K will. The exposed helper lets
    // tests assert the on-disk shape without standing up a browser.
    const { createWorkspace } = await import("../src/server/workspace.ts");
    const { createMention } = await import("../src/server/mention-ops.ts");
    const ws = createWorkspace(cwd, "docs/**/*.md");
    const result = await createMention(ws, {
      path: "alpha.md",
      startOffset: 8, // beginning of "paragraph one\n"
      endOffset: "# alpha\nparagraph one\n".length,
      verb: "rephrase",
      instruction: "tighten",
      author: "alice",
    });
    expect(result.mention.id).toMatch(/^m-[a-z0-9]{4,}$/);
    const onDisk = await readFile(join(cwd, "docs", "alpha.md"), "utf8");
    expect(onDisk).toContain('@sidebar mention id="' + result.mention.id + '"');
    expect(onDisk).toContain("verb=\"rephrase\"");
    expect(onDisk).toContain("origin=\"human\"");
    expect(onDisk).toContain("author=\"alice\"");
    expect(onDisk).toContain("paragraph one");
    expect(onDisk).toContain(`@sidebar end id="${result.mention.id}"`);
  });
});
