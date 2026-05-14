import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_REL } from "./paths.js";

// .gitignore plumbing for the lazy-write path. Spec: Configuration / Gitignore
// behavior. We coexist with slice 02's existing connection.json entry: never
// double-add a line that is already there.

export type GitignoreState = "absent" | "ignored" | "unignored";

/** Returns "absent" when there is no .git/ directory at `cwd`. */
export function gitignoreState(cwd: string): GitignoreState {
  if (!existsSync(join(cwd, ".git"))) return "absent";
  return isLocalIgnored(cwd) ? "ignored" : "unignored";
}

export function isLocalIgnored(cwd: string): boolean {
  const path = join(cwd, ".gitignore");
  if (!existsSync(path)) return false;
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  return matchesLocalLine(body);
}

function matchesLocalLine(body: string): boolean {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === LOCAL_REL) return true;
    // Allow a leading slash form (".sidebar/local.json" vs "/.sidebar/...").
    if (line === `/${LOCAL_REL}`) return true;
  }
  return false;
}

/**
 * Append the local.json entry to .gitignore, preserving existing entries.
 * Creates .gitignore if it doesn't exist. No-ops if the entry is already
 * present (defensive double-add guard, in case the caller skipped the check).
 */
export async function appendLocalToGitignore(cwd: string): Promise<void> {
  const path = join(cwd, ".gitignore");
  let body = "";
  if (existsSync(path)) {
    body = await readFile(path, "utf8");
    if (matchesLocalLine(body)) return;
  }
  const sep = body.length === 0 || body.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${body}${sep}${LOCAL_REL}\n`, "utf8");
}
