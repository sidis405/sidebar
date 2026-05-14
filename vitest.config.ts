import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    globals: false,
    // Compile the server once before any test file loads, so integration
    // tests can spawn `node dist/server/cli.js` instead of `tsx src/server/cli.ts`.
    // See test/global-setup.ts for the rationale.
    globalSetup: ["./test/global-setup.ts"],
  },
});
