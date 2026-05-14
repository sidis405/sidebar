// Slice 04 demo: editor Cmd-K -> server createMention -> marker written.
// Drives the editor WebSocket the same way the React app does; prints what
// each step sees so the human can verify the round trip without launching
// a browser.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const sidebarDir = resolve(process.argv[2] ?? "..");
const TSX = join(sidebarDir, "node_modules", ".bin", "tsx");
const CLI = join(sidebarDir, "src", "server", "cli.ts");

console.log("=== slice-04 demo: Cmd-K -> createMention ===\n");

await mkdir("docs", { recursive: true });
await writeFile(join("docs", "alpha.md"), "# alpha\nparagraph one\n", "utf8");
console.log("[human] wrote docs/alpha.md:\n");
console.log(prefix(await readFile(join("docs", "alpha.md"), "utf8"), "  | "));
console.log();

// Boot a standalone sidebar process to receive WS messages.
const cli = spawn(TSX, [CLI, "--port", "0", "--browser", "none"], {
  env: { ...process.env, SIDEBAR_OPEN: "noop" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
cli.stderr.on("data", (d) => {
  stderr += d.toString();
});
const url = await new Promise((res) => {
  const t = setInterval(() => {
    const m = stderr.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (m) {
      clearInterval(t);
      res(m[0]);
    }
  }, 25);
});
console.log(`[server] booted at ${url}\n`);

const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws`);
await new Promise((res) => ws.once("open", res));

const reply = (kind) =>
  new Promise((res) => {
    const onMsg = (data) => {
      const m = JSON.parse(data.toString());
      if (m.kind === kind) {
        ws.off("message", onMsg);
        res(m);
      }
    };
    ws.on("message", onMsg);
  });

const send = (m) => ws.send(JSON.stringify(m));

send({ kind: "verbCatalog" });
const catalog = await reply("verbCatalog");
console.log("[editor] verbCatalog reply (built-in human verbs only):");
console.log(prefix(catalog.catalog.human.map((v) => `${v.name} (${v.kind})`).join(", "), "  > "));
console.log();

send({ kind: "open", path: "alpha.md" });
const open = await reply("fileOpen");
const target = "paragraph one\n";
const start = open.content.indexOf(target);
console.log(`[editor] selected ${JSON.stringify(target)} at offset ${start}.\n`);

send({
  kind: "createMention",
  path: "alpha.md",
  startOffset: start,
  endOffset: start + target.length,
  verb: "rephrase",
  instruction: "tighten this",
});
const created = await reply("mentionCreated");
console.log(`[editor] mentionCreated id=${created.mentionId} file=${created.file}\n`);

await delay(50);
const after = await readFile(join("docs", "alpha.md"), "utf8");
console.log("[disk] docs/alpha.md after Cmd-K:");
console.log(prefix(after, "  | "));

ws.close();
cli.kill("SIGINT");
await new Promise((res) => cli.once("exit", res));

function prefix(s, p) {
  return s
    .split("\n")
    .map((l) => `${p}${l}`)
    .join("\n");
}
