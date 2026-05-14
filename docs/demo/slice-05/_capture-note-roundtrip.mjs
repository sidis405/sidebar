// Slice 05 demo: human creates a note via Cmd-K (driven through the editor
// WebSocket the same way the SPA does), then an MCP-speaking agent reads the
// note via list_annotations. Confirms the marker shape on disk and the
// MCP view match.
//
//   cd /tmp/sidebar-slice-05-note
//   node /path/to/sidebar/docs/demo/slice-05/_capture-note-roundtrip.mjs /path/to/sidebar > note-roundtrip-transcript.txt

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { WebSocket } from "ws";

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

console.log("=== slice-05 demo: human note via Cmd-K, agent reads via MCP ===\n");

await mkdir("docs", { recursive: true });
await writeFile(
  join("docs", "alpha.md"),
  "# alpha\n\nthis paragraph deserves a note.\n",
  "utf8",
);

// Boot the primary via stdio. The same process serves the editor over WS
// and the MCP server over stdio + HTTP.
const transport = new StdioClientTransport({
  command: TSX,
  args: [CLI, "--stdio"],
  env: { ...process.env, SIDEBAR_OPEN: "noop" },
  stderr: "pipe",
});
let url = "";
transport.stderr?.on("data", (d) => {
  const s = d.toString();
  const m = s.match(/http:\/\/127\.0\.0\.1:\d+/);
  if (m && !url) url = m[0];
});
const agent = new Client({ name: "demo-agent", version: "0.0.0" });
await agent.connect(transport);
while (!url) await delay(50);

// Human side: open the editor's WS and send createAnnotation.
const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
await new Promise((res) => ws.once("open", () => res()));
ws.send(JSON.stringify({ kind: "open", path: "alpha.md" }));
let opened;
await new Promise((res) => {
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.kind === "fileOpen") {
      opened = m;
      res();
    }
  });
});
console.log("[human] opened alpha.md in the editor.\n");

const target = "this paragraph deserves a note.\n";
const start = opened.content.indexOf(target);
ws.send(
  JSON.stringify({
    kind: "createAnnotation",
    path: "alpha.md",
    startOffset: start,
    endOffset: start + target.length,
    type: "note",
    content: "remember to update this every quarter.",
  }),
);
let created;
await new Promise((res) => {
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.kind === "annotationCreated") {
      created = m;
      res();
    }
  });
});
console.log(`[human] Cmd-K -> createAnnotation(note) -> id ${created.annotationId}`);

const onDisk = await readFile(join("docs", "alpha.md"), "utf8");
console.log("\n[disk] docs/alpha.md after note creation:");
console.log(prefix(onDisk, "  | "));

// Agent side: read the same annotation via MCP.
const listed = await agent.callTool({ name: "list_annotations", arguments: {} });
console.log("\n[agent] list_annotations returned:");
console.log(prefix(JSON.stringify(JSON.parse(listed.content[0].text), null, 2), "  > "));

// Recent activity shows annotation-created.
const recent = await agent.callTool({ name: "list_recent_changes", arguments: {} });
console.log("\n[status drawer] list_recent_changes:");
console.log(prefix(JSON.stringify(JSON.parse(recent.content[0].text), null, 2), "  > "));

ws.close();
await agent.close();

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
