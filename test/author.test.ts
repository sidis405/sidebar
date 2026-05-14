// Slice 04: human-author resolution for marker writes.
// Spec: Identity and Multi-Agent / Human identity in markers.
//
// Resolution order, evaluated *per marker write* (not per boot):
//   1. `git config user.name` if `.git/` exists in the workspace root and
//      the value is non-empty.
//   2. The `$USER` environment variable.
//   3. Literal `human`.
// Control characters are stripped. `"` is replaced with `'` (markers are
// inside HTML comments with quoted attributes). Empty after sanitization
// falls back to the next candidate.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHumanAuthor } from "../src/server/author.ts";

// Host machines running these tests usually have a global git user.name.
// Point git at empty config files so `git config user.name` only sees what
// each test sets. `resolveHumanAuthor` runs `git` in-process, so we have to
// mutate process.env (not just pass env to setup commands).
const ISOLATED_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  HOME: "/nonexistent-home-for-git-isolation",
};

function withIsolatedGit<T>(fn: () => T): T {
  const orig: Record<string, string | undefined> = {};
  for (const key of Object.keys(ISOLATED_ENV)) {
    orig[key] = process.env[key];
    process.env[key] = (ISOLATED_ENV as Record<string, string>)[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(orig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("resolveHumanAuthor", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sidebar-author-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function setupGit(name: string | null) {
    execFileSync("git", ["init", "-q"], { cwd, env: { ...process.env, ...ISOLATED_ENV } });
    if (name !== null) {
      execFileSync("git", ["config", "user.name", name], {
        cwd,
        env: { ...process.env, ...ISOLATED_ENV },
      });
    }
  }

  it("returns git config user.name when .git/ is present and the name is non-empty", () => {
    setupGit("Sidrit T");
    const author = withIsolatedGit(() =>
      resolveHumanAuthor(cwd, { USER: "fallback-user" }),
    );
    expect(author).toBe("Sidrit T");
  });

  it("falls back to $USER when .git/ does not exist", () => {
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("fallback-user");
  });

  it("falls back to $USER when git config user.name is unset for this repo", () => {
    setupGit(null);
    const author = withIsolatedGit(() =>
      resolveHumanAuthor(cwd, { USER: "fallback-user" }),
    );
    expect(author).toBe("fallback-user");
  });

  it("falls back to literal 'human' when neither git nor $USER yields a value", () => {
    const author = resolveHumanAuthor(cwd, {});
    expect(author).toBe("human");
  });

  it("strips control characters and replaces double quotes with single quotes", () => {
    setupGit('A"weird"name');
    const author = withIsolatedGit(() =>
      resolveHumanAuthor(cwd, { USER: "fallback-user" }),
    );
    expect(author).toBe("A'weird'name");
  });

  it("falls back to $USER when sanitization removes every character of the git name", () => {
    setupGit("\x01\x02\x03");
    const author = withIsolatedGit(() =>
      resolveHumanAuthor(cwd, { USER: "fallback-user" }),
    );
    expect(author).toBe("fallback-user");
  });

  it("is resolved fresh on each call (mid-session git config changes take effect)", () => {
    setupGit("First Name");
    withIsolatedGit(() => {
      expect(resolveHumanAuthor(cwd, {})).toBe("First Name");
      execFileSync("git", ["config", "user.name", "Second Name"], {
        cwd,
        env: { ...process.env, ...ISOLATED_ENV },
      });
      expect(resolveHumanAuthor(cwd, {})).toBe("Second Name");
    });
  });
});
