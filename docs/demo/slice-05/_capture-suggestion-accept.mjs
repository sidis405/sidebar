// Slice 05 demo: agent posts a suggestion via add_annotation, human accepts
// via the editor's side card (driven through the WebSocket). The target
// prose is swapped verbatim and the annotation goes.
//
//   cd /tmp/sidebar-slice-05-accept
//   node /path/to/sidebar/docs/demo/slice-05/_capture-suggestion-accept.mjs /path/to/sidebar > suggestion-accept-transcript.txt

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

console.log("=== slice-05 demo: agent suggests, human accepts ===\n");

await mkdir("docs", { recursive: true });
await writeFile(
  join("docs", "alpha.md"),
  "# alpha\n\nthe original paragraph is wordy and could be tighter.\n",
  "utf8",
);

const transport = new StdioClientTransport({
  command: TSX,
  args: [CLI, "--stdio"],
  env: { ...process.env, SIDEBAR_OPEN: "noop" },
  stderr: "pipe",
});
let url = "";
transport.stderr?.on("data", (d) => {
  const m = d.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
  if (m && !url) url = m[0];
});
const agent = new Client({ name: "claude-code", version: "0.0.0" });
await agent.connect(transport);
while (!url) await delay(50);

// Agent: add_annotation(type=suggestion).
const original = await readFile(join("docs", "alpha.md"), "utf8");
const target = "the original paragraph is wordy and could be tighter.\n";
const start = original.indexOf(target);
const created = await agent.callTool({
  name: "add_annotation",
  arguments: {
    path: "alpha.md",
    target_anchor: { start, end: start + target.length },
    type: "suggestion",
    content: "the original paragraph is tight now.",
  },
});
const payload = JSON.parse(created.content[0].text);
console.log("[agent] add_annotation(suggestion) returned:");
console.log(prefix(JSON.stringify(payload, null, 2), "  > "));

const afterCreate = await readFile(join("docs", "alpha.md"), "utf8");
console.log("\n[disk] docs/alpha.md after suggestion creation:");
console.log(prefix(afterCreate, "  | "));

// Human: accept via the editor's WebSocket (the same path the side-card
// Accept button uses).
const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
await new Promise((res) => ws.once("open", () => res()));
ws.send(JSON.stringify({ kind: "acceptSuggestion", annotationId: payload.id }));
console.log(`\n[human] accepted suggestion ${payload.id} via the side-card Accept button.`);
// Wait for the server to write to disk + broadcast.
await delay(200);

const afterAccept = await readFile(join("docs", "alpha.md"), "utf8");
console.log("\n[disk] docs/alpha.md after Accept:");
console.log(prefix(afterAccept, "  | "));

const recent = await agent.callTool({ name: "list_recent_changes", arguments: {} });
console.log("\n[status drawer] list_recent_changes (suggestion-accepted should be present):");
console.log(prefix(JSON.stringify(JSON.parse(recent.content[0].text), null, 2), "  > "));

ws.close();
await agent.close();

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
