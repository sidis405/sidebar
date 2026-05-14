import { describe, expect, it } from "vitest";
import { assertNodeVersion } from "../src/server/runtime-check.ts";
import { nextBackoffMs } from "../src/shared/backoff.ts";

// AC13: Node 20+ baseline check; older Node refuses with a clear error.
describe("Node version baseline", () => {
  it("throws a clear error for Node 18", () => {
    expect(() => assertNodeVersion("v18.19.0")).toThrowError(/Node 20/);
  });

  it("accepts Node 20+", () => {
    expect(() => assertNodeVersion("v20.11.0")).not.toThrow();
    expect(() => assertNodeVersion("v22.4.0")).not.toThrow();
  });
});

// AC12: editor reconnect uses exponential backoff with values
// 1s, 2s, 5s, 10s, capped at 30s for subsequent attempts.
describe("WebSocket reconnect backoff", () => {
  it("follows the 1s, 2s, 5s, 10s ladder", () => {
    expect(nextBackoffMs(0)).toBe(1000);
    expect(nextBackoffMs(1)).toBe(2000);
    expect(nextBackoffMs(2)).toBe(5000);
    expect(nextBackoffMs(3)).toBe(10_000);
  });

  it("caps at 30 seconds for further attempts", () => {
    expect(nextBackoffMs(4)).toBe(30_000);
    expect(nextBackoffMs(10)).toBe(30_000);
    expect(nextBackoffMs(100)).toBe(30_000);
  });
});
