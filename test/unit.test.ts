import { describe, expect, it } from "vitest";
import { ArgsError, parseArgs } from "../src/server/args.ts";
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

// Hardening (Copilot review): --port must reject partial-numeric input
// rather than silently coercing "123abc" -> 123 via Number.parseInt.
describe("--port strict parsing", () => {
  it("rejects '123abc' rather than silently using 123", () => {
    expect(() => parseArgs(["--port", "123abc"])).toThrowError(ArgsError);
  });
  it("rejects '1.5'", () => {
    expect(() => parseArgs(["--port", "1.5"])).toThrowError(ArgsError);
  });
  it("rejects negative values", () => {
    expect(() => parseArgs(["--port", "-1"])).toThrowError(ArgsError);
  });
  it("rejects values above 65535", () => {
    expect(() => parseArgs(["--port", "70000"])).toThrowError(/out of range/);
  });
  it("accepts a clean decimal", () => {
    expect(parseArgs(["--port", "5180"]).port).toBe(5180);
  });
  it("accepts 0 (OS-assigned)", () => {
    expect(parseArgs(["--port", "0"]).port).toBe(0);
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
