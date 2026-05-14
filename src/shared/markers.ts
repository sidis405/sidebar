// Marker parser primitives shared between the editor (for CodeMirror
// decorations) and the server (for MCP tools and list_recent_changes).
// Both layers must agree on what a well-formed marker looks like on disk;
// keep this module free of node-only imports so the editor bundle picks it up.
//
// Spec: Data Model / Marker Shape on Disk, Failure Modes / Malformed markers.
// ADR-0003 fixes the begin/end pair shape; slice 4 introduces the parser.
// Slice 5 (annotations) reuses every primitive here without forking; do not
// inline mention-specific assumptions into the generic marker helpers.

export type MarkerType = "mention" | "note" | "suggestion";

export type MarkerAttrs = Readonly<Record<string, string>>;

/** A successfully parsed marker (mention or annotation). */
export type ParsedMarker = {
  type: MarkerType;
  id: string;
  attrs: MarkerAttrs;
  instruction: string;
  /** Byte offset of the first character of the begin marker line. */
  beginLineStart: number;
  /** Byte offset just past the trailing newline of the begin marker line. */
  beginLineEnd: number;
  /** Byte offset of the first character of the end marker line. */
  endLineStart: number;
  /** Byte offset just past the trailing newline of the end marker line. */
  endLineEnd: number;
  /** Byte offset of the first character of the target region. */
  targetStart: number;
  /** Byte offset just past the last character of the target region. */
  targetEnd: number;
  /** Verbatim text of the target region between begin and end. */
  targetContent: string;
  /** 1-indexed line number of the begin marker. */
  beginLineNumber: number;
  /** 1-indexed line number of the end marker. */
  endLineNumber: number;
};

/** A mention is a marker with the agreed attribute set. */
export type Mention = ParsedMarker & {
  type: "mention";
  origin: "human" | "agent";
  verb: string;
  author: string;
  /** True when targetContent is empty or whitespace-only (ADR-0002 orphan). */
  orphan: boolean;
  /** 16-char hex truncation of sha256(targetContent). */
  baseHash: string;
};

export type ParseErrorKind =
  | "missing-end"
  | "stray-end"
  | "duplicate-id"
  | "malformed-syntax";

export type ParseError = {
  kind: ParseErrorKind;
  /** 1-indexed source line where the defect was detected. */
  line: number;
  /** Marker id when known. */
  id?: string;
  message: string;
};

/** Byte range of a malformed marker line, for editor red-gutter painting. */
export type MalformedRange = {
  start: number;
  end: number;
  line: number;
  kind: ParseErrorKind;
};

export type ParseResult = {
  /** Every well-formed marker, in source order. */
  markers: ParsedMarker[];
  /** Convenience filter: well-formed mentions only. */
  mentions: Mention[];
  errors: ParseError[];
  malformedRanges: MalformedRange[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type BeginFrame = {
  line: ParsedLine;
  type: MarkerType;
  id: string;
  attrs: MarkerAttrs;
  instruction: string;
};

export function parseMarkers(text: string): ParseResult {
  const lines = splitLines(text);

  const open: BeginFrame[] = [];
  const completedOrder: ParsedMarker[] = [];
  const completedById = new Map<string, ParsedMarker>();
  const errors: ParseError[] = [];
  const malformedRanges: MalformedRange[] = [];
  const poisonedIds = new Set<string>();
  const seenBeginIds = new Set<string>();

  const reportMalformed = (
    kind: ParseErrorKind,
    pl: ParsedLine,
    id: string | undefined,
    msg: string,
  ): void => {
    errors.push({ kind, line: pl.lineNumber, id, message: msg });
    malformedRanges.push({ start: pl.start, end: pl.end, line: pl.lineNumber, kind });
  };

  for (const pl of lines) {
    const tok = tokenizeMarkerLine(pl);
    if (!tok) continue;

    if (tok.kind === "begin") {
      if (!tok.id) {
        reportMalformed("malformed-syntax", pl, undefined, "marker begin missing id");
        continue;
      }
      if (seenBeginIds.has(tok.id) || poisonedIds.has(tok.id)) {
        if (!poisonedIds.has(tok.id)) {
          // First time we notice the duplicate. Retroactively invalidate any
          // previously parsed marker with this id so the public output never
          // contains it.
          const prior = completedById.get(tok.id);
          if (prior) {
            completedById.delete(tok.id);
            const idx = completedOrder.indexOf(prior);
            if (idx !== -1) completedOrder.splice(idx, 1);
            malformedRanges.push({
              start: prior.beginLineStart,
              end: prior.beginLineEnd,
              line: prior.beginLineNumber,
              kind: "duplicate-id",
            });
            malformedRanges.push({
              start: prior.endLineStart,
              end: prior.endLineEnd,
              line: prior.endLineNumber,
              kind: "duplicate-id",
            });
            errors.push({
              kind: "duplicate-id",
              line: prior.beginLineNumber,
              id: tok.id,
              message: `duplicate marker id ${tok.id}`,
            });
          } else {
            const openIdx = open.findIndex((b) => b.id === tok.id);
            if (openIdx !== -1) {
              const prev = open[openIdx];
              open.splice(openIdx, 1);
              malformedRanges.push({
                start: prev.line.start,
                end: prev.line.end,
                line: prev.line.lineNumber,
                kind: "duplicate-id",
              });
              errors.push({
                kind: "duplicate-id",
                line: prev.line.lineNumber,
                id: tok.id,
                message: `duplicate marker id ${tok.id}`,
              });
            }
          }
          poisonedIds.add(tok.id);
        }
        reportMalformed("duplicate-id", pl, tok.id, `duplicate marker id ${tok.id}`);
        continue;
      }
      seenBeginIds.add(tok.id);
      open.push({
        line: pl,
        type: tok.markerType,
        id: tok.id,
        attrs: tok.attrs,
        instruction: tok.instruction,
      });
      continue;
    }

    // tok.kind === "end"
    if (!tok.id) {
      reportMalformed("malformed-syntax", pl, undefined, "marker end missing id");
      continue;
    }
    if (poisonedIds.has(tok.id)) {
      reportMalformed("duplicate-id", pl, tok.id, `end for poisoned id ${tok.id}`);
      continue;
    }
    const matchIdx = open.findIndex((b) => b.id === tok.id);
    if (matchIdx === -1) {
      reportMalformed("stray-end", pl, tok.id, `end with no matching begin for id ${tok.id}`);
      continue;
    }
    // Any earlier-open begins never got their own end.
    for (let i = 0; i < matchIdx; i++) {
      const stale = open[i];
      reportMalformed("missing-end", stale.line, stale.id, `missing end for id ${stale.id}`);
    }
    const begin = open[matchIdx];
    open.splice(0, matchIdx + 1);

    const targetStart = begin.line.end;
    const targetEnd = pl.start;
    const targetContent = text.slice(targetStart, targetEnd);
    const completed: ParsedMarker = {
      type: begin.type,
      id: begin.id,
      attrs: begin.attrs,
      instruction: begin.instruction,
      beginLineStart: begin.line.start,
      beginLineEnd: begin.line.end,
      endLineStart: pl.start,
      endLineEnd: pl.end,
      targetStart,
      targetEnd,
      targetContent,
      beginLineNumber: begin.line.lineNumber,
      endLineNumber: pl.lineNumber,
    };
    completedOrder.push(completed);
    completedById.set(begin.id, completed);
  }

  for (const b of open) {
    reportMalformed("missing-end", b.line, b.id, `missing end for id ${b.id}`);
  }

  const mentions: Mention[] = [];
  for (const m of completedOrder) {
    if (m.type !== "mention") continue;
    const origin = m.attrs.origin;
    if (origin !== "human" && origin !== "agent") {
      errors.push({
        kind: "malformed-syntax",
        line: m.beginLineNumber,
        id: m.id,
        message: `mention origin must be 'human' or 'agent' (got ${origin ?? "missing"})`,
      });
      malformedRanges.push({
        start: m.beginLineStart,
        end: m.beginLineEnd,
        line: m.beginLineNumber,
        kind: "malformed-syntax",
      });
      continue;
    }
    const verb = m.attrs.verb;
    if (!verb || !/^[a-z][a-z0-9-]*$/.test(verb)) {
      errors.push({
        kind: "malformed-syntax",
        line: m.beginLineNumber,
        id: m.id,
        message: `mention verb missing or malformed (got ${verb ?? "missing"})`,
      });
      malformedRanges.push({
        start: m.beginLineStart,
        end: m.beginLineEnd,
        line: m.beginLineNumber,
        kind: "malformed-syntax",
      });
      continue;
    }
    const author = m.attrs.author ?? "";
    mentions.push({
      ...m,
      type: "mention",
      origin,
      verb,
      author,
      orphan: m.targetContent.trim() === "",
      baseHash: computeMentionBaseHash(m.targetContent),
    });
  }

  return {
    markers: completedOrder,
    mentions,
    errors,
    malformedRanges,
  };
}

// ---------------------------------------------------------------------------
// Hash and marker-emit helpers
// ---------------------------------------------------------------------------

/**
 * sha256(targetContent) hex, truncated to 16 chars. The truncation gives the
 * agent a short token to echo back on resolve_mention without paying for the
 * full 64-char hex on the wire. Slice 4 sets this contract; slices 5 and 6
 * reuse the same algorithm.
 */
export function computeMentionBaseHash(targetContent: string): string {
  return sha256Pure(targetContent).slice(0, 16);
}

/** Build the begin marker line (no trailing newline). */
export function formatMentionBegin(args: {
  id: string;
  verb: string;
  origin: "human" | "agent";
  author: string;
  instruction: string;
}): string {
  const author = sanitizeAttribute(args.author);
  const verb = sanitizeAttribute(args.verb);
  const instruction = sanitizeInstruction(args.instruction);
  return `<!-- @sidebar mention id="${args.id}" verb="${verb}" origin="${args.origin}" author="${author}": ${instruction} -->`;
}

/** Build the end marker line (no trailing newline). */
export function formatMentionEnd(id: string): string {
  return `<!-- @sidebar end id="${id}" -->`;
}

// Annotation emit helpers used by resolve_mention(action=annotation) and by
// slice 5 once it lands. The note/suggestion variants share the same begin/end
// pair shape (ADR-0003); the only difference is the type token.
export function formatAnnotationBegin(args: {
  type: "note" | "suggestion";
  id: string;
  author: string;
  instruction: string;
}): string {
  const author = sanitizeAttribute(args.author);
  const instruction = sanitizeInstruction(args.instruction);
  return `<!-- @sidebar ${args.type} id="${args.id}" author="${author}": ${instruction} -->`;
}

export function formatAnnotationEnd(id: string): string {
  return `<!-- @sidebar end id="${id}" -->`;
}

/**
 * Strip control characters and replace `"` with `'` so a value never breaks
 * the HTML comment quoting. Spec: Human identity in markers.
 */
export function sanitizeAttribute(v: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate scrubber
  return v.replace(/[\x00-\x1f\x7f]/g, "").replace(/"/g, "'");
}

/**
 * Sanitize instruction text: control-chars stripped, `"` replaced with `'`,
 * `-->` neutered so the comment terminator inside the instruction can never
 * close the marker prematurely.
 */
export function sanitizeInstruction(v: string): string {
  return sanitizeAttribute(v).replace(/-->/g, "--&gt;");
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ParsedLine = {
  text: string;
  /** Byte offset of the first character of the line. */
  start: number;
  /** Byte offset just past the trailing newline (or end of file). */
  end: number;
  /** 1-indexed line number. */
  lineNumber: number;
};

function splitLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let lineNumber = 1;
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && text.charCodeAt(j) !== 10 /* \n */) j++;
    const end = j < text.length ? j + 1 : j;
    out.push({ text: text.slice(i, j), start: i, end, lineNumber });
    i = end;
    lineNumber++;
  }
  return out;
}

type BeginToken = {
  kind: "begin";
  markerType: MarkerType;
  id: string;
  attrs: MarkerAttrs;
  instruction: string;
};
type EndToken = { kind: "end"; id: string };
type Tok = BeginToken | EndToken;

const BEGIN_LINE = /^\s*<!--\s*@sidebar\s+(mention|note|suggestion)\s+(.+?)\s*-->\s*$/;
const END_LINE = /^\s*<!--\s*@sidebar\s+end(?:\s+(.+?))?\s*-->\s*$/;

function tokenizeMarkerLine(pl: ParsedLine): Tok | null {
  const trimmed = pl.text;
  const endMatch = END_LINE.exec(trimmed);
  if (endMatch) {
    const rest = (endMatch[1] ?? "").trim();
    const id = extractIdFromAttrs(rest);
    return { kind: "end", id };
  }
  const beginMatch = BEGIN_LINE.exec(trimmed);
  if (!beginMatch) return null;
  const markerType = beginMatch[1] as MarkerType;
  const rest = beginMatch[2];

  let inQuote: '"' | "'" | null = null;
  let colonAt = -1;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ":") {
      colonAt = i;
      break;
    }
  }
  let attrsPart: string;
  let instruction: string;
  if (colonAt === -1) {
    attrsPart = rest;
    instruction = "";
  } else {
    attrsPart = rest.slice(0, colonAt).trim();
    instruction = rest.slice(colonAt + 1).trim();
  }
  const attrs = parseAttrs(attrsPart);
  const id = attrs.id ?? "";
  return { kind: "begin", markerType, id, attrs, instruction };
}

function extractIdFromAttrs(s: string): string {
  const m = /(?:^|\s)id\s*=\s*"([^"]*)"/.exec(s);
  return m ? m[1] : "";
}

function parseAttrs(s: string): MarkerAttrs {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null = re.exec(s);
  while (m) {
    out[m[1]] = m[2];
    m = re.exec(s);
  }
  return out;
}

// ---- Pure-JS SHA-256 (RFC 6234). The editor bundle stays node-import-free
// and the server-side cost is negligible at slice-4 volumes (one hash per
// mention's target region, rebuilt on file watcher change).

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Pure(message: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      const hi = code;
      const lo = message.charCodeAt(++i);
      const cp = 0x10000 + (((hi & 0x3ff) << 10) | (lo & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array<number>(64);
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(toHex8).join("");
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function toHex8(n: number): string {
  return n.toString(16).padStart(8, "0");
}
