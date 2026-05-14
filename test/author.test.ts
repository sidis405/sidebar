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
// falls back to `human`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHumanAuthor } from "../src/server/author.ts";

describe("resolveHumanAuthor", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sidebar-author-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function setupGit(name: string) {
    execSync("git init -q", { cwd });
    execSync(`git config user.name "${name}"`, { cwd });
    execSync("git config user.email noone@example.com", { cwd });
  }

  it("returns git config user.name when a .git/ repo is present and the name is non-empty", () => {
    setupGit("Sidrit T");
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("Sidrit T");
  });

  it("falls back to $USER when .git/ does not exist", () => {
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("fallback-user");
  });

  it("falls back to $USER when git config user.name is empty", async () => {
    execSync("git init -q", { cwd });
    // Intentionally do not configure user.name.
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("fallback-user");
  });

  it("falls back to literal 'human' when neither git nor $USER yields a value", () => {
    const author = resolveHumanAuthor(cwd, {});
    expect(author).toBe("human");
  });

  it("strips control characters and replaces double quotes with single quotes", () => {
    setupGit('A"weird"name');
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("A'weird'name");
  });

  it("falls back to 'human' when sanitization removes every character", () => {
    setupGit("");
    const author = resolveHumanAuthor(cwd, { USER: "fallback-user" });
    expect(author).toBe("fallback-user");
  });

  it("is resolved fresh on each call (mid-session git config changes take effect)", () => {
    setupGit("First Name");
    expect(resolveHumanAuthor(cwd, {})).toBe("First Name");
    execSync('git config user.name "Second Name"', { cwd });
    expect(resolveHumanAuthor(cwd, {})).toBe("Second Name");
  });
});
