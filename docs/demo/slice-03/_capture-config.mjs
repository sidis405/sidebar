// Drives the slice-03 lazy-write API to produce the gitignore-offer
// transcript. Reviewers regenerate the demo by running:
//
//   cd /tmp/sidebar-qa-slice-03
//   git init -q .
//   echo "node_modules" > .gitignore
//   node /path/to/sidebar/docs/demo/slice-03/_capture-config.mjs /path/to/sidebar > offer-transcript.txt
//
// The script imports the compiled API from dist/server/config/ so it is
// running against exactly the code shipping in the PR.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd as procCwd, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const sidebarDir = resolve(process.argv[2] ?? "..");
const { persistLocal } = await import(
  `file://${join(sidebarDir, "dist", "server", "config", "index.js")}`
);

async function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ans = (await rl.question(question)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

console.log(`sidebar config: writing .sidebar/local.json (port=5555)`);
const result = await persistLocal(
  procCwd(),
  { port: 5555 },
  {
    consent: async ({ gitignorePath }) => {
      console.log(
        `\nsidebar created ${procCwd()}/.sidebar/local.json (per-machine state).`,
      );
      console.log(`Detected ${gitignorePath} without an entry for .sidebar/local.json.`);
      return await ask("Append `.sidebar/local.json` to .gitignore? [y/N]: ");
    },
  },
);
console.log(`\nresult: ${JSON.stringify(result, null, 2)}`);

if (result.gitignoreAction === "appended") {
  const after = await readFile(join(procCwd(), ".gitignore"), "utf8");
  console.log(`\n.gitignore is now:\n----\n${after}----`);
}
