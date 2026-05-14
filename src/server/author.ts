import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sanitizeAttribute } from "../shared/markers.js";

// Resolve the `author` attribute written into a human-origin marker.
//
// Spec: Identity and Multi-Agent / Human identity in markers.
// Resolution order, evaluated per write:
//
//   1. `git config user.name` if `.git/` exists in the workspace root and
//      the value is non-empty.
//   2. `$USER` from the environment.
//   3. Literal `human`.
//
// Control characters are stripped, `"` is replaced with `'` so the value
// never breaks the HTML comment's quoted attribute. Empty after sanitization
// falls back to the next candidate, ultimately to `human`.

const FALLBACK = "human";

export function resolveHumanAuthor(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const gitName = readGitUserName(cwd);
  const gitSan = sanitizeAttribute(gitName).trim();
  if (gitSan) return gitSan;

  const userEnv = env.USER ?? "";
  const userSan = sanitizeAttribute(userEnv).trim();
  if (userSan) return userSan;

  return FALLBACK;
}

function readGitUserName(cwd: string): string {
  if (!existsSync(join(cwd, ".git"))) return "";
  try {
    const out = execFileSync("git", ["config", "user.name"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return "";
  }
}
