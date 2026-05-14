// Slice 03: .sidebar/ config files + lazy creation + strict validation.
//
// Each test maps to one or more acceptance criteria from issue #3. Per
// AGENTS.md the test-first contract requires these to land before the
// implementation; a fresh checkout of the test commit should fail every
// config-related assertion until the slice 03 implementation lands.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigLoadError,
  loadProjectConfig,
  persistConfig,
  persistLocal,
} from "../src/server/config/index.ts";
import { destroyWorkspace, launchCli, makeWorkspace } from "./helpers.ts";

// Compact helper: drop a fixture file into the workspace.
async function write(cwd: string, rel: string, body: string): Promise<void> {
  const abs = join(cwd, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, body, "utf8");
}

// ---------------------------------------------------------------------------
// AC1: .sidebar/ directory and files are created lazily; not created on plain
// `npx sidebar` boot.
// ---------------------------------------------------------------------------

describe("config: lazy creation on boot", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("standalone boot does not create .sidebar/ at all", async () => {
    const cli = launchCli(cwd, ["--browser", "none", "--port", "0"]);
    try {
      await cli.url;
      // Give the watcher a beat in case anything else races a file write.
      await new Promise((r) => setTimeout(r, 200));
      expect(existsSync(join(cwd, ".sidebar"))).toBe(false);
    } finally {
      await cli.stop();
    }
  });

  it("--stdio boot creates connection.json but neither config.json nor local.json", async () => {
    // The slice-02 --stdio path mkdirs .sidebar/ for connection.json. That is
    // explicitly allowed by the spec ("the directory may exist for transient
    // reasons"); only the config files are gated on a persistence event.
    const cli = launchCli(cwd, ["--stdio"]);
    try {
      // Wait for the primary stderr URL line — same signal we use in other tests.
      await cli.url;
      await new Promise((r) => setTimeout(r, 200));
      expect(existsSync(join(cwd, ".sidebar", "connection.json"))).toBe(true);
      expect(existsSync(join(cwd, ".sidebar", "config.json"))).toBe(false);
      expect(existsSync(join(cwd, ".sidebar", "local.json"))).toBe(false);
    } finally {
      await cli.stop();
    }
  });

  it("persistLocal creates .sidebar/local.json on first call (lazy)", async () => {
    expect(existsSync(join(cwd, ".sidebar"))).toBe(false);
    const out = await persistLocal(cwd, { port: 5555 });
    expect(out.created).toBe(true);
    expect(existsSync(join(cwd, ".sidebar", "local.json"))).toBe(true);
  });

  it("persistConfig creates .sidebar/config.json on first call (lazy)", async () => {
    expect(existsSync(join(cwd, ".sidebar"))).toBe(false);
    const out = await persistConfig(cwd, { scope: "notes/**/*.md" });
    expect(out.created).toBe(true);
    expect(existsSync(join(cwd, ".sidebar", "config.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC3 + AC4 + AC5: schema validation for config.json and local.json,
// strict version, no silent fallback.
// ---------------------------------------------------------------------------

describe("config.json: schema validation", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("loads a minimal valid file", async () => {
    await write(cwd, ".sidebar/config.json", JSON.stringify({ version: 1 }));
    const out = await loadProjectConfig(cwd);
    expect(out.config).toEqual({ version: 1 });
  });

  it("rejects invalid JSON with a field-pointing error", async () => {
    await write(cwd, ".sidebar/config.json", "{not json");
    await expect(loadProjectConfig(cwd)).rejects.toThrow(ConfigLoadError);
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/\.sidebar\/config\.json/);
  });

  it("rejects an unknown top-level key", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({ version: 1, mysteryKey: true }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/mysteryKey/);
  });

  it("rejects version other than 1 (V2 migration hook)", async () => {
    await write(cwd, ".sidebar/config.json", JSON.stringify({ version: 2 }));
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/version/);
  });

  it("rejects missing version", async () => {
    await write(cwd, ".sidebar/config.json", JSON.stringify({ scope: "docs/**/*.md" }));
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/version/);
  });

  it("rejects scope of wrong type", async () => {
    await write(cwd, ".sidebar/config.json", JSON.stringify({ version: 1, scope: 7 }));
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/scope/);
  });

  it("rejects rateLimit.agentMentions.maxOpen out of range", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        rateLimit: { agentMentions: { maxOpen: -1 } },
      }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/maxOpen/);
  });

  it("rejects redefining a built-in human verb", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { human: { rephrase: { mode: "annotation" } } },
      }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/rephrase/);
  });

  it("rejects redefining a built-in agent verb", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { agent: { clarify: {} } },
      }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/clarify/);
  });

  it("rejects human verb mode outside {replace, annotation}", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { human: { tighten: { mode: "rewrite" } } },
      }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/mode/);
  });

  it("rejects verb name that does not match [a-z][a-z0-9-]*", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { human: { "Tighten-Up": { mode: "replace" } } },
      }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/Tighten-Up|verb name/);
  });

  it("accepts a custom human verb in the allowed shape", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { human: { tighten: { mode: "replace" } } },
      }),
    );
    const out = await loadProjectConfig(cwd);
    expect(out.config?.verbs?.human?.tighten?.mode).toBe("replace");
  });

  it("accepts a custom agent verb in the allowed shape", async () => {
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({
        version: 1,
        verbs: { agent: { greet: {} } },
      }),
    );
    const out = await loadProjectConfig(cwd);
    expect(out.config?.verbs?.agent?.greet).toEqual({});
  });
});

describe("local.json: schema validation", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("loads a minimal valid file", async () => {
    await write(cwd, ".sidebar/local.json", JSON.stringify({ version: 1 }));
    const out = await loadProjectConfig(cwd);
    expect(out.local).toEqual({ version: 1 });
  });

  it("rejects invalid JSON with a field-pointing error", async () => {
    await write(cwd, ".sidebar/local.json", "garbage");
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/local\.json/);
  });

  it("rejects an unknown top-level key", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, theme: "dark" }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/theme/);
  });

  it("rejects version other than 1", async () => {
    await write(cwd, ".sidebar/local.json", JSON.stringify({ version: 2 }));
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/version/);
  });

  it("rejects port out of range", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 70000 }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/port/);
  });

  it("rejects port of wrong type", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: "5180" }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/port/);
  });

  it("rejects browser of wrong type", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, browser: 42 }),
    );
    await expect(loadProjectConfig(cwd)).rejects.toThrow(/browser/);
  });

  it("accepts browser value 'none'", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, browser: "none" }),
    );
    const out = await loadProjectConfig(cwd);
    expect(out.local?.browser).toBe("none");
  });

  it("accepts an arbitrary platform-specific browser identifier", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, browser: "firefox" }),
    );
    const out = await loadProjectConfig(cwd);
    expect(out.local?.browser).toBe("firefox");
  });
});

// ---------------------------------------------------------------------------
// AC6 + AC7: CLI flags override on-disk for one boot only.
// ---------------------------------------------------------------------------

describe("CLI: persisted scope from config.json", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace({ withDocsDir: false });
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("config.json scope is honored when --scope is absent", async () => {
    // Build a notes/ dir to host the alternative workspace, then point the
    // persisted scope at it. Without slice-03, sidebar would refuse because
    // docs/ does not exist.
    await write(cwd, "notes/a.md", "# hi\n");
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({ version: 1, scope: "notes/**/*.md" }),
    );
    const cli = launchCli(cwd, []);
    try {
      const url = await cli.url;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(cli.stderr()).toContain("notes/**/*.md");
    } finally {
      await cli.stop();
    }
  });

  it("--scope on the CLI overrides config.json for one boot", async () => {
    await write(cwd, "notes/a.md", "# hi\n");
    await write(cwd, "other/b.md", "# other\n");
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({ version: 1, scope: "notes/**/*.md" }),
    );
    const cli = launchCli(cwd, ["--scope", "other/**/*.md"]);
    try {
      await cli.url;
      expect(cli.stderr()).toContain("other/**/*.md");
      // And: we did not mutate the on-disk config.json.
      const stillOnDisk = JSON.parse(
        await readFile(join(cwd, ".sidebar", "config.json"), "utf8"),
      );
      expect(stillOnDisk.scope).toBe("notes/**/*.md");
    } finally {
      await cli.stop();
    }
  });
});

describe("CLI: persisted port from local.json", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("local.json port is honored when --port is absent", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 5291 }),
    );
    const cli = launchCli(cwd, []);
    try {
      const url = await cli.url;
      expect(url).toBe("http://127.0.0.1:5291");
    } finally {
      await cli.stop();
    }
  });

  it("--port on the CLI overrides local.json for one boot", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 5291 }),
    );
    const cli = launchCli(cwd, ["--port", "5292"]);
    try {
      const url = await cli.url;
      expect(url).toBe("http://127.0.0.1:5292");
    } finally {
      await cli.stop();
    }
  });

  it("local.json port collision refuses to start (no fallback)", async () => {
    // The persisted port is an *explicit* user intent, identical to passing
    // --port on the CLI. The spec is firm: no fallback when the explicit port
    // is taken.
    const { createServer } = await import("node:net");
    const blocker = createServer().listen(5293, "127.0.0.1");
    try {
      await write(
        cwd,
        ".sidebar/local.json",
        JSON.stringify({ version: 1, port: 5293 }),
      );
      const cli = launchCli(cwd, []);
      const exit = await new Promise<number | null>((res) => {
        cli.child.once("exit", (code) => res(code));
      });
      expect(exit).not.toBe(0);
      expect(cli.stderr()).toMatch(/port|in use|EADDRINUSE/i);
    } finally {
      blocker.close();
    }
  });
});

describe("CLI: persisted browser from local.json", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("local.json browser=none short-circuits launch (no SIDEBAR_OPEN required)", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, browser: "none" }),
    );
    // SIDEBAR_OPEN=fail would crash the open path if it ran; we assert that
    // the URL still prints and the process stays alive — i.e. the persisted
    // `browser: none` short-circuited before `open` was called.
    const cli = launchCli(cwd, [], { SIDEBAR_OPEN: "fail" });
    try {
      const url = await cli.url;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await cli.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// AC11 + AC12: gitignore offer on first creation; subsequent boots warn on
// unignored local.json.
// ---------------------------------------------------------------------------

describe("gitignore offer on local.json creation", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("no offer when .git/ is absent", async () => {
    const out = await persistLocal(cwd, { port: 5555 });
    expect(out.gitignoreAction).toBe("absent");
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
  });

  it("offer respects an already-gitignored entry", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", ".sidebar/local.json\n");
    const out = await persistLocal(cwd, { port: 5555 });
    expect(out.gitignoreAction).toBe("already-ignored");
    const after = await readFile(join(cwd, ".gitignore"), "utf8");
    // Did not double-add.
    expect(after.match(/local\.json/g)?.length ?? 0).toBe(1);
  });

  it("appends to .gitignore when consent returns true", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", "node_modules\n.sidebar/connection.json\n");
    const out = await persistLocal(cwd, { port: 5555 }, { consent: async () => true });
    expect(out.gitignoreAction).toBe("appended");
    const after = await readFile(join(cwd, ".gitignore"), "utf8");
    expect(after).toContain(".sidebar/local.json");
    // Did not double-add the connection.json line that was already present.
    expect(after.match(/connection\.json/g)?.length ?? 0).toBe(1);
  });

  it("does not append when consent returns false", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", "node_modules\n");
    const out = await persistLocal(cwd, { port: 5555 }, { consent: async () => false });
    expect(out.gitignoreAction).toBe("declined");
    const after = await readFile(join(cwd, ".gitignore"), "utf8");
    expect(after).not.toContain("local.json");
  });

  it("creates .gitignore if missing when consent is true", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    const out = await persistLocal(cwd, { port: 5555 }, { consent: async () => true });
    expect(out.gitignoreAction).toBe("appended");
    const after = await readFile(join(cwd, ".gitignore"), "utf8");
    expect(after).toContain(".sidebar/local.json");
  });

  it("only offers on creation, not on subsequent writes to an existing file", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    // First write: file is new, offer fires (no consent → declined).
    let calls = 0;
    await persistLocal(
      cwd,
      { port: 5555 },
      {
        consent: async () => {
          calls += 1;
          return false;
        },
      },
    );
    expect(calls).toBe(1);
    // Second write: file already exists, no further offer.
    await persistLocal(
      cwd,
      { port: 5556 },
      {
        consent: async () => {
          calls += 1;
          return true;
        },
      },
    );
    expect(calls).toBe(1);
  });

  it("does not double-add when .sidebar/local.json already appears in .gitignore", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", ".sidebar/local.json\n");
    await persistLocal(cwd, { port: 5555 }, { consent: async () => true });
    const after = await readFile(join(cwd, ".gitignore"), "utf8");
    expect(after.match(/local\.json/g)?.length ?? 0).toBe(1);
  });
});

describe("CLI: unignored-local warning at boot", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  it("emits a single-line stderr warning when local.json is unignored", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", "node_modules\n");
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 0 }),
    );
    const cli = launchCli(cwd, []);
    try {
      await cli.url;
      // Warning is one line, on stderr, mentioning local.json and gitignore.
      const err = cli.stderr();
      expect(err).toMatch(/\.sidebar\/local\.json/);
      expect(err.toLowerCase()).toMatch(/gitignor/);
    } finally {
      await cli.stop();
    }
  });

  it("does not warn when local.json is already gitignored", async () => {
    await mkdir(join(cwd, ".git"), { recursive: true });
    await write(cwd, ".gitignore", ".sidebar/local.json\n");
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 0 }),
    );
    const cli = launchCli(cwd, []);
    try {
      await cli.url;
      const err = cli.stderr();
      // The warning is the only place that pairs `local.json` with the word
      // `gitignor`. Either word alone may appear in other log lines.
      expect(err).not.toMatch(/local\.json.*gitignor|gitignor.*local\.json/i);
    } finally {
      await cli.stop();
    }
  });

  it("does not warn when .git/ is absent (no repo, no expectation)", async () => {
    await write(
      cwd,
      ".sidebar/local.json",
      JSON.stringify({ version: 1, port: 0 }),
    );
    const cli = launchCli(cwd, []);
    try {
      await cli.url;
      expect(cli.stderr()).not.toMatch(/gitignor/i);
    } finally {
      await cli.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// AC4: config error message is clear and points at file + field. Exercise
// this through the CLI so we know the message reaches the user, not just
// throws into the void.
// ---------------------------------------------------------------------------

describe("CLI: refuses to start on invalid config", () => {
  let cwd: string;
  afterEach(async () => {
    if (cwd) await destroyWorkspace(cwd);
  });

  it("rejects invalid JSON with a message pointing at the file", async () => {
    cwd = await makeWorkspace();
    await write(cwd, ".sidebar/config.json", "{ not json");
    const cli = launchCli(cwd, []);
    const exit = await new Promise<number | null>((res) => {
      cli.child.once("exit", (code) => res(code));
    });
    expect(exit).not.toBe(0);
    expect(cli.stderr()).toMatch(/\.sidebar\/config\.json/);
  });

  it("rejects a bad version with a message pointing at the field", async () => {
    cwd = await makeWorkspace();
    await write(cwd, ".sidebar/local.json", JSON.stringify({ version: 99 }));
    const cli = launchCli(cwd, []);
    const exit = await new Promise<number | null>((res) => {
      cli.child.once("exit", (code) => res(code));
    });
    expect(exit).not.toBe(0);
    expect(cli.stderr()).toMatch(/\.sidebar\/local\.json/);
    expect(cli.stderr()).toMatch(/version/);
  });

  it("rejects an unknown top-level key with a message naming the key", async () => {
    cwd = await makeWorkspace();
    await write(
      cwd,
      ".sidebar/config.json",
      JSON.stringify({ version: 1, mystery: 1 }),
    );
    const cli = launchCli(cwd, []);
    const exit = await new Promise<number | null>((res) => {
      cli.child.once("exit", (code) => res(code));
    });
    expect(exit).not.toBe(0);
    expect(cli.stderr()).toMatch(/mystery/);
  });
});

// Silence the unused-import warning if a future refactor leaves `rm` orphaned.
void rm;
