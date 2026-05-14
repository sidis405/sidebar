// Slice 04 demo: malformed marker tolerance. A file with a broken
// begin/end pair still reads via read_doc, is skipped from
// list_pending_mentions, and the editor (per spec) renders a red gutter
// over the offending line. We only capture the server-side surface here;
// the gutter is in docs/demo/slice-04/screenshots/.

import { mkdir, writeFile } from "node:fs/promises";
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

console.log("=== slice-04 demo: malformed marker tolerance ===\n");

await mkdir("docs", { recursive: true });
const broken = [
  "# broken",
  "",
  '<!-- @sidebar mention id="m-stray" verb="rephrase" origin="human" author="alice": go -->',
  "no closing tag below",
  "",
].join("\n");
const ok = [
  "# ok",
  "",
  '<!-- @sidebar mention id="m-good" verb="expand" origin="human" author="alice": go -->',
  "fine",
  '<!-- @sidebar end id="m-good" -->',
  "",
].join("\n");
await writeFile(join("docs", "broken.md"), broken, "utf8");
await writeFile(join("docs", "ok.md"), ok, "utf8");

console.log("[human] wrote docs/broken.md (no end marker):");
console.log(prefix(broken, "  | "));
console.log();
console.log("[human] wrote docs/ok.md:");
console.log(prefix(ok, "  | "));
console.log();

const transport = new StdioClientTransport({
  command: TSX,
  args: [CLI, "--stdio"],
  env: { ...process.env, SIDEBAR_OPEN: "noop" },
  stderr: "inherit", // single stderr warning per affected file lands here
});
const client = new Client({ name: "demo-agent", version: "0.0.0" });
await client.connect(transport);

const listed = await client.callTool({ name: "list_pending_mentions", arguments: {} });
console.log("[agent] list_pending_mentions skips the malformed file:");
console.log(prefix(JSON.stringify(JSON.parse(listed.content[0].text), null, 2), "  > "));
console.log();

const read = await client.callTool({
  name: "read_doc",
  arguments: { path: "broken.md" },
});
console.log("[agent] read_doc('broken.md') still works (markers intact):");
const payload = JSON.parse(read.content[0].text);
console.log(prefix(payload.content, "  | "));

await client.close();

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
