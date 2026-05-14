// Slice 04: marker parser primitives shared between editor and server.
//
// Per AGENTS.md test-first contract this file lands with the failing tests
// before the implementation does. Each `it` block exercises one of the
// invariants the marker parser must hold for slice 4 to compose cleanly with
// slices 5 (annotations) and 6 (agent-origin mentions) downstream.

import { describe, expect, it } from "vitest";
import {
  computeMentionBaseHash,
  formatMentionBegin,
  formatMentionEnd,
  parseMarkers,
} from "../src/shared/markers.ts";

// ---------------------------------------------------------------------------
// Spec: Marker Shape on Disk; ADR-0003.
//
// `<!-- @sidebar mention id="..." verb="..." origin="human" author="...": ...-->`
// target region
// `<!-- @sidebar end id="..." -->`
// ---------------------------------------------------------------------------

describe("parseMarkers: well-formed mentions", () => {
  it("parses a single mention with verb, origin, author, instruction, and target region", () => {
    const text = [
      "# alpha",
      "",
      '<!-- @sidebar mention id="m-a3f9" verb="rephrase" origin="human" author="alice": please tighten -->',
      "the body of the paragraph",
      "with two lines",
      '<!-- @sidebar end id="m-a3f9" -->',
      "",
      "more text",
      "",
    ].join("\n");

    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    expect(result.mentions).toHaveLength(1);
    const m = result.mentions[0];
    expect(m.id).toBe("m-a3f9");
    expect(m.verb).toBe("rephrase");
    expect(m.origin).toBe("human");
    expect(m.author).toBe("alice");
    expect(m.instruction).toBe("please tighten");
    expect(m.targetContent).toBe("the body of the paragraph\nwith two lines\n");
    expect(m.orphan).toBe(false);
    expect(m.baseHash).toBe(computeMentionBaseHash(m.targetContent));
    // Offsets bracket the entire begin/end pair (markers go with replace).
    expect(text.slice(m.beginLineStart, m.beginLineStart + 4)).toBe("<!--");
    expect(text.slice(m.endLineEnd - 4, m.endLineEnd)).toBe("-->\n");
    // The target region offsets exclude the marker lines themselves.
    expect(text.slice(m.targetStart, m.targetEnd)).toBe(m.targetContent);
  });

  it("preserves the order of consecutive mentions in the same file", () => {
    const text = [
      '<!-- @sidebar mention id="m-aaaa" verb="rephrase" origin="human" author="alice": one -->',
      "first",
      '<!-- @sidebar end id="m-aaaa" -->',
      '<!-- @sidebar mention id="m-bbbb" verb="expand" origin="human" author="alice": two -->',
      "second",
      '<!-- @sidebar end id="m-bbbb" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions.map((m) => m.id)).toEqual(["m-aaaa", "m-bbbb"]);
    expect(result.errors).toEqual([]);
  });

  it("preserves the verb attribute exactly even when it's a custom name", () => {
    const text = [
      '<!-- @sidebar mention id="m-cust" verb="tighten" origin="human" author="alice": go -->',
      "x",
      '<!-- @sidebar end id="m-cust" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions[0]?.verb).toBe("tighten");
  });

  it("accepts an empty instruction (everything after the colon)", () => {
    const text = [
      '<!-- @sidebar mention id="m-empty" verb="rephrase" origin="human" author="a": -->',
      "x",
      '<!-- @sidebar end id="m-empty" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions[0]?.instruction).toBe("");
  });
});

describe("parseMarkers: orphaned mentions", () => {
  it("marks a mention with an empty target region as orphaned", () => {
    const text = [
      '<!-- @sidebar mention id="m-orph" verb="rephrase" origin="human" author="alice": go -->',
      '<!-- @sidebar end id="m-orph" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.orphan).toBe(true);
    expect(result.mentions[0]?.targetContent).toBe("");
  });

  it("marks a mention as orphaned when only whitespace remains in the target", () => {
    const text = [
      '<!-- @sidebar mention id="m-orph" verb="expand" origin="human" author="alice": go -->',
      "   ",
      "\t",
      '<!-- @sidebar end id="m-orph" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions[0]?.orphan).toBe(true);
  });
});

describe("parseMarkers: malformed markers (tolerant parse)", () => {
  it("reports a missing-end error and skips the marker when no matching end line exists", () => {
    const text = [
      '<!-- @sidebar mention id="m-stray" verb="rephrase" origin="human" author="a": go -->',
      "orphan content",
      "no closing tag below",
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === "missing-end" && e.id === "m-stray")).toBe(true);
    // Editor decoration ranges still cover the begin line so the red gutter
    // can paint exactly the broken marker line.
    expect(result.malformedRanges.length).toBeGreaterThan(0);
  });

  it("reports a stray-end error when an end line has no matching begin", () => {
    const text = [
      '<!-- @sidebar end id="m-nope" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions).toHaveLength(0);
    expect(result.errors.some((e) => e.kind === "stray-end" && e.id === "m-nope")).toBe(true);
  });

  it("treats duplicate ids as malformed and skips both mentions", () => {
    const text = [
      '<!-- @sidebar mention id="m-dup" verb="rephrase" origin="human" author="a": one -->',
      "first",
      '<!-- @sidebar end id="m-dup" -->',
      '<!-- @sidebar mention id="m-dup" verb="expand" origin="human" author="a": two -->',
      "second",
      '<!-- @sidebar end id="m-dup" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.mentions).toHaveLength(0);
    expect(result.errors.filter((e) => e.kind === "duplicate-id").length).toBeGreaterThan(0);
  });

  it("does not refuse to parse a marker because the verb is unknown", () => {
    // Slice 4 invariant: the parser surfaces every well-formed begin/end pair.
    // Verb-policy decisions (action vs annotation, unknown verbs falling
    // through to annotation mode) live in the verb catalog at resolve time.
    const text = [
      '<!-- @sidebar mention id="m-unk" verb="not-a-real-verb" origin="human" author="a": go -->',
      "x",
      '<!-- @sidebar end id="m-unk" -->',
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    expect(result.mentions[0]?.verb).toBe("not-a-real-verb");
  });

  it("reports malformed-syntax for a begin line missing the id attribute", () => {
    const text = [
      "<!-- @sidebar mention verb=\"rephrase\" origin=\"human\" author=\"a\": go -->",
      "x",
      "<!-- @sidebar end id=\"m-irrelevant\" -->",
      "",
    ].join("\n");
    const result = parseMarkers(text);
    expect(result.errors.some((e) => e.kind === "malformed-syntax")).toBe(true);
    expect(result.mentions).toHaveLength(0);
  });
});

describe("computeMentionBaseHash", () => {
  it("returns a deterministic 16-character hex string for a given target", () => {
    const a = computeMentionBaseHash("hello world\n");
    const b = computeMentionBaseHash("hello world\n");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when target content changes", () => {
    expect(computeMentionBaseHash("a")).not.toBe(computeMentionBaseHash("b"));
  });

  it("returns a stable value for an empty target", () => {
    expect(computeMentionBaseHash("")).toBe(computeMentionBaseHash(""));
    expect(computeMentionBaseHash("")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("formatMentionBegin / formatMentionEnd", () => {
  it("round-trips through parseMarkers preserving id, verb, origin, author, and instruction", () => {
    const begin = formatMentionBegin({
      id: "m-z9k2",
      verb: "rephrase",
      origin: "human",
      author: "alice",
      instruction: "please tighten",
    });
    const end = formatMentionEnd("m-z9k2");
    const text = `${begin}\nthe target\n${end}\n`;
    const result = parseMarkers(text);
    expect(result.errors).toEqual([]);
    expect(result.mentions[0]).toMatchObject({
      id: "m-z9k2",
      verb: "rephrase",
      origin: "human",
      author: "alice",
      instruction: "please tighten",
      targetContent: "the target\n",
    });
  });
});
