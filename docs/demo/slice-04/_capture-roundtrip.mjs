// Slice 04 demo: full mention round-trip from human -> agent -> resolution.
// Drives the MCP surface the same way an invited agent would and prints what
// each side sees. Reviewers regenerate the transcript by running this script
// against a workspace that contains a docs/ folder.
//
//   cd /tmp/sidebar-slice-04-demo
//   node /path/to/sidebar/docs/demo/slice-04/_capture-roundtrip.mjs /path/to/sidebar > roundtrip-transcript.txt

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const sidebarDir = resolve(process.argv[2] ?? "..");
const TSX = join(sidebarDir, "node_modules", ".bin", "tsx");
const CLI = join(sidebarDir, "src", "server", "cli.ts");

const { Client } = await import(
  `file://${join(sidebarDir, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js")}`
);
const { StdioClientTransport } = await import(
  `file://${join(
    sidebarDir,
    "node_modules",
    "@modelcontextprotocol",
    "sdk",
    "dist",
    "esm",
    "client",
    "stdio.js",
  )}`
);

console.log("=== slice-04 demo: full mention round-trip ===\n");

// 1. Human seeds a markdown file with a mention marker (the same shape Cmd-K
//    would produce; see test/mention-ws.test.ts for the editor wiring).
await mkdir("docs", { recursive: true });
const seed = [
  "# alpha",
  "",
  '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="alice": tighten this -->',
  "the body of the paragraph",
  "with two lines",
  '<!-- @sidebar end id="m-aaaa" -->',
  "",
  "more prose underneath",
  "",
].join("\n");
await writeFile(join("docs", "alpha.md"), seed, "utf8");
console.log("[human] wrote docs/alpha.md with a 'rephrase' mention:\n");
console.log(prefix(seed, "  | "));
console.log();

// 2. Agent (we play it via stdio) discovers the mention, claims it, and
//    resolves it with replacement text.
const transport = new StdioClientTransport({
  command: TSX,
  args: [CLI, "--stdio"],
  env: { ...process.env, SIDEBAR_OPEN: "noop" },
  stderr: "pipe",
});
const client = new Client({ name: "demo-agent", version: "0.0.0" });
await client.connect(transport);

const listed = await client.callTool({ name: "list_pending_mentions", arguments: {} });
const pending = JSON.parse(listed.content[0].text).mentions;
console.log("[agent] list_pending_mentions returned:");
console.log(prefix(JSON.stringify(pending, null, 2), "  > "));
console.log();

const baseHash = pending[0].base_hash;

const claimed = await client.callTool({
  name: "mark_in_progress",
  arguments: { mention_id: "m-aaaa" },
});
console.log("[agent] mark_in_progress:");
console.log(prefix(claimed.content[0].text, "  > "));
console.log();

const resolved = await client.callTool({
  name: "resolve_mention",
  arguments: {
    mention_id: "m-aaaa",
    base_hash: baseHash,
    action: { type: "replace", content: "the body, now tighter\n" },
  },
});
console.log("[agent] resolve_mention (replace):");
console.log(prefix(resolved.content[0].text, "  > "));
console.log();

const onDisk = await readFile(join("docs", "alpha.md"), "utf8");
console.log("[disk] docs/alpha.md after resolution:");
console.log(prefix(onDisk, "  | "));
console.log();

// 3. Status drawer view: list_recent_changes reflects the lifecycle events
//    the editor's status drawer renders. The drawer pulls this same data over
//    the WebSocket; here we read it via MCP for transcript purposes.
const recent = await client.callTool({ name: "list_recent_changes", arguments: {} });
console.log("[status drawer] list_recent_changes events:");
console.log(prefix(JSON.stringify(JSON.parse(recent.content[0].text), null, 2), "  > "));
console.log();

await client.close();

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
