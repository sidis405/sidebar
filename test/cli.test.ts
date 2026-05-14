import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import {
  destroyWorkspace,
  launchCli,
  makeWorkspace,
  waitFor,
} from "./helpers.ts";

// CLI behavior tests. Each test maps to one or more acceptance criteria
// from issue #1. Tests intentionally avoid the editor UI; UI criteria live
// in test/MANUAL-VERIFY.md.

describe("CLI: port selection", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  // AC1: linear fallback through 5180-5189
  it("falls back through 5180-5189 when the first ports are taken", async () => {
    // Hold 5180 with a dummy server so sidebar must fall back.
    const blocker = createServer().listen(5180, "127.0.0.1");
    try {
      const cli = launchCli(cwd, []);
      try {
        const url = await cli.url;
        expect(url).toMatch(/127\.0\.0\.1:518[1-9]/);
      } finally {
        await cli.stop();
      }
    } finally {
      blocker.close();
    }
  });

  // AC1: prints the URL on stderr (not stdout)
  it("prints the bound URL on stderr", async () => {
    const cli = launchCli(cwd);
    try {
      const url = await cli.url;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(cli.stderr()).toContain(url);
    } finally {
      await cli.stop();
    }
  });

  // AC2: --port <N> binds that exact port
  it("--port <N> binds the requested port", async () => {
    const cli = launchCli(cwd, ["--port", "5279"]);
    try {
      const url = await cli.url;
      expect(url).toBe("http://127.0.0.1:5279");
    } finally {
      await cli.stop();
    }
  });

  // AC2: --port 0 binds an OS-assigned free port and prints it
  it("--port 0 binds an OS-assigned port", async () => {
    const cli = launchCli(cwd, ["--port", "0"]);
    try {
      const url = await cli.url;
      const m = url.match(/:(\d+)$/);
      const port = m ? Number.parseInt(m[1], 10) : -1;
      expect(port).toBeGreaterThan(1024);
      expect(port).toBeLessThan(65536);
    } finally {
      await cli.stop();
    }
  });

  // AC2: explicit port collision refuses with a clear error
  it("--port <N> refuses with a clear error when the port is taken", async () => {
    const blocker = createServer().listen(5283, "127.0.0.1");
    try {
      const cli = launchCli(cwd, ["--port", "5283"]);
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

describe("CLI: --browser flag", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await makeWorkspace();
  });
  afterEach(async () => {
    await destroyWorkspace(cwd);
  });

  // AC3: --browser none skips browser launch; URL still prints
  it("--browser none skips launch but still prints URL", async () => {
    const cli = launchCli(cwd, ["--browser", "none"], { SIDEBAR_OPEN: "fail" });
    try {
      const url = await cli.url;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      // SIDEBAR_OPEN=fail would crash the open path if it ran; we asserted
      // a URL was printed without crash, proving --browser none short-circuited.
    } finally {
      await cli.stop();
    }
  });
});

describe("CLI: workspace scope", () => {
  // AC4: docs/ missing -> prompts; --scope flag also short-circuits the prompt.
  it("refuses to silently start when docs/ is missing and stdin is not a TTY", async () => {
    const cwd = await makeWorkspace({ withDocsDir: false });
    try {
      const cli = launchCli(cwd, []);
      const exit = await new Promise<number | null>((res) => {
        cli.child.once("exit", (code) => res(code));
      });
      expect(exit).not.toBe(0);
      expect(cli.stderr()).toMatch(/docs.*not found|workspace|scope/i);
    } finally {
      await destroyWorkspace(cwd);
    }
  });

  // AC5: --scope overrides default and lets the boot succeed.
  it("--scope overrides the default glob for the boot", async () => {
    const cwd = await makeWorkspace({
      withDocsDir: false,
      docs: {},
    });
    // Stand up a `notes/` directory instead of docs/.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(cwd, "notes"), { recursive: true });
    await writeFile(join(cwd, "notes", "a.md"), "# hi\n");

    const cli = launchCli(cwd, ["--scope", "notes/**/*.md"]);
    try {
      const url = await cli.url;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await cli.stop();
      await destroyWorkspace(cwd);
    }
  });
});

describe("CLI: clean shutdown", () => {
  // AC14: Ctrl-C releases the port (no orphan)
  it("releases the bound port on SIGINT", async () => {
    const cwd = await makeWorkspace();
    try {
      const cli = launchCli(cwd, ["--port", "5286"]);
      await cli.url;
      await cli.stop();
      // If the port is still bound, this listen call rejects.
      await waitFor(
        () =>
          new Promise<boolean>((res, rej) => {
            const s = createServer();
            s.once("error", rej);
            s.listen(5286, "127.0.0.1", () => {
              s.close(() => res(true));
            });
          }),
        { timeoutMs: 5000, label: "port 5286 to be released" },
      );
    } finally {
      await destroyWorkspace(cwd);
    }
  });
});
