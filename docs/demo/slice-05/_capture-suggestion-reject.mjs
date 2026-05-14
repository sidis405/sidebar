// Slice 05 demo: agent posts a suggestion; human rejects. The annotation
// pair disappears; the target prose stays.
//
//   cd /tmp/sidebar-slice-05-reject
//   node /path/to/sidebar/docs/demo/slice-05/_capture-suggestion-reject.mjs /path/to/sidebar > suggestion-reject-transcript.txt

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

console.log("=== slice-05 demo: agent suggests, human rejects ===\n");

await mkdir("docs", { recursive: true });
await writeFile(
  join("docs", "alpha.md"),
  "# alpha\n\nthe original paragraph stays put because the human rejects.\n",
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

const original = await readFile(join("docs", "alpha.md"), "utf8");
const target = "the original paragraph stays put because the human rejects.\n";
const start = original.indexOf(target);
const created = await agent.callTool({
  name: "add_annotation",
  arguments: {
    path: "alpha.md",
    target_anchor: { start, end: start + target.length },
    type: "suggestion",
    content: "this proposed replacement is going to be rejected.",
  },
});
const payload = JSON.parse(created.content[0].text);
console.log(`[agent] add_annotation(suggestion) -> id ${payload.id}`);

const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
await new Promise((res) => ws.once("open", () => res()));
ws.send(JSON.stringify({ kind: "rejectSuggestion", annotationId: payload.id }));
console.log(`[human] rejected suggestion ${payload.id} via the side-card Reject button.\n`);
await delay(200);

const afterReject = await readFile(join("docs", "alpha.md"), "utf8");
console.log("[disk] docs/alpha.md after Reject (annotation gone, prose unchanged):");
console.log(prefix(afterReject, "  | "));

const list = await agent.callTool({ name: "list_annotations", arguments: {} });
const listed = JSON.parse(list.content[0].text);
console.log("\n[agent] list_annotations after Reject (should be empty):");
console.log(prefix(JSON.stringify(listed, null, 2), "  > "));

const recent = await agent.callTool({ name: "list_recent_changes", arguments: {} });
console.log("\n[status drawer] list_recent_changes (suggestion-rejected present):");
console.log(prefix(JSON.stringify(JSON.parse(recent.content[0].text), null, 2), "  > "));

ws.close();
await agent.close();

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
