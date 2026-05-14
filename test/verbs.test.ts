// Slice 03: verb subsystem — built-in defaults + custom verb loading.
// The catalog output is the public API slices 4-6 consume to validate
// agent/human verb references; if it drifts here those slices fail.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_VERBS,
  BUILTIN_HUMAN_VERBS,
  type VerbCatalog,
  buildVerbCatalog,
} from "../src/server/verbs/index.ts";

// Spec: Verbs (V1 Defaults). These tables are load-bearing for slices 4-6;
// any change here is a spec-level change.
const EXPECTED_HUMAN_VERBS: ReadonlyArray<{ name: string; mode: "replace" | "annotation" }> = [
  { name: "rephrase", mode: "replace" },
  { name: "expand", mode: "replace" },
  { name: "shorten", mode: "replace" },
  { name: "remove-if-redundant", mode: "replace" },
  { name: "factcheck", mode: "annotation" },
  { name: "question", mode: "annotation" },
  { name: "review", mode: "annotation" },
  { name: "explain", mode: "annotation" },
];

const EXPECTED_AGENT_VERBS: ReadonlyArray<string> = ["clarify", "decide", "confirm", "review"];

describe("verbs: built-in defaults", () => {
  it("BUILTIN_HUMAN_VERBS matches the V1 spec table", () => {
    expect(BUILTIN_HUMAN_VERBS.map((v) => ({ name: v.name, mode: v.mode }))).toEqual(
      EXPECTED_HUMAN_VERBS,
    );
    for (const v of BUILTIN_HUMAN_VERBS) expect(v.builtin).toBe(true);
  });

  it("BUILTIN_AGENT_VERBS matches the V1 spec table", () => {
    expect(BUILTIN_AGENT_VERBS.map((v) => v.name)).toEqual(EXPECTED_AGENT_VERBS);
    for (const v of BUILTIN_AGENT_VERBS) expect(v.builtin).toBe(true);
  });
});

describe("verbs: buildVerbCatalog", () => {
  it("returns built-in catalog when config is null", () => {
    const cat = buildVerbCatalog(null);
    for (const v of EXPECTED_HUMAN_VERBS) {
      expect(cat.human.get(v.name)?.mode).toBe(v.mode);
      expect(cat.human.get(v.name)?.builtin).toBe(true);
    }
    for (const v of EXPECTED_AGENT_VERBS) {
      expect(cat.agent.get(v)?.builtin).toBe(true);
    }
  });

  it("merges a custom human verb with replace mode", () => {
    const cat: VerbCatalog = buildVerbCatalog({
      version: 1,
      verbs: { human: { tighten: { mode: "replace" } } },
    });
    expect(cat.human.get("tighten")).toEqual({
      name: "tighten",
      mode: "replace",
      builtin: false,
    });
    // Built-ins remain.
    expect(cat.human.get("rephrase")?.mode).toBe("replace");
  });

  it("merges a custom human verb with annotation mode", () => {
    const cat = buildVerbCatalog({
      version: 1,
      verbs: { human: { audit: { mode: "annotation" } } },
    });
    expect(cat.human.get("audit")?.mode).toBe("annotation");
    expect(cat.human.get("audit")?.builtin).toBe(false);
  });

  it("merges a custom agent verb (extends whitelist consumed by later slices)", () => {
    const cat = buildVerbCatalog({
      version: 1,
      verbs: { agent: { greet: {} } },
    });
    expect(cat.agent.get("greet")?.builtin).toBe(false);
    // Built-ins remain.
    expect(cat.agent.get("clarify")?.builtin).toBe(true);
  });

  it("keeps built-ins intact when only the verbs key is partially populated", () => {
    const cat = buildVerbCatalog({
      version: 1,
      verbs: { human: { tighten: { mode: "replace" } } },
      // No agent entry; built-in agent verbs should still load.
    });
    expect(cat.agent.get("clarify")?.builtin).toBe(true);
  });
});

// Note: invalid custom verbs (redefining a built-in, illegal name, bad
// mode) throw at config *load* time, not at catalog build time. See
// config.test.ts for those assertions.
