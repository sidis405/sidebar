// Demonstrates the verb subsystem: built-in defaults merged with custom
// verbs from .sidebar/config.json. Slices 4-6 consume the catalog this
// script prints. Reviewers regenerate the transcript by running:
//
//   cd /tmp/sidebar-qa-slice-03d
//   node /path/to/sidebar/docs/demo/slice-03/_capture-verbs.mjs /path/to/sidebar > custom-verb-transcript.txt

import { join, resolve } from "node:path";
import { cwd as procCwd } from "node:process";

const sidebarDir = resolve(process.argv[2] ?? "..");
const { loadProjectConfig } = await import(
  `file://${join(sidebarDir, "dist", "server", "config", "index.js")}`
);
const { buildVerbCatalog, BUILTIN_HUMAN_VERBS, BUILTIN_AGENT_VERBS } = await import(
  `file://${join(sidebarDir, "dist", "server", "verbs", "index.js")}`
);

console.log(`Built-in human verbs (from src/server/verbs/builtin.ts):`);
for (const v of BUILTIN_HUMAN_VERBS) {
  console.log(`  ${v.name.padEnd(22)} mode=${v.mode}`);
}
console.log(`\nBuilt-in agent verbs:`);
for (const v of BUILTIN_AGENT_VERBS) {
  console.log(`  ${v.name}`);
}

console.log(`\nLoading .sidebar/config.json at ${procCwd()} ...`);
const { config } = await loadProjectConfig(procCwd());
if (!config) {
  console.log(`(no .sidebar/config.json on disk)`);
  process.exit(0);
}
console.log(JSON.stringify(config, null, 2));

const cat = buildVerbCatalog(config);
console.log(`\nResolved catalog (built-in + custom):`);
console.log(`  human:`);
for (const v of cat.human.values()) {
  const tag = v.builtin ? "" : "  (custom)";
  console.log(`    ${v.name.padEnd(22)} mode=${v.mode}${tag}`);
}
console.log(`  agent:`);
for (const v of cat.agent.values()) {
  const tag = v.builtin ? "" : "  (custom)";
  console.log(`    ${v.name}${tag}`);
}
