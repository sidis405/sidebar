import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import fastGlob from "fast-glob";
import {
  type Mention,
  type ParseError,
  computeMentionBaseHash,
  formatAnnotationBegin,
  formatAnnotationEnd,
  formatMentionBegin,
  formatMentionEnd,
  parseMarkers,
  sanitizeAttribute,
} from "../shared/markers.js";
import { generateMentionId, generateNoteId } from "./marker-ids.js";
import { resolveHumanAuthor } from "./author.js";
import type { Workspace } from "./workspace.js";
import { log } from "./log.js";

// Slice 4 surfaces the on-disk mention catalog and the file-level operations
// that mutate it (create on Cmd-K, cancel from the status drawer, replace
// /annotation resolve from MCP). Everything in this module is stateless: we
// re-scan the workspace on demand. Process-local transient state (claims,
// recent-events) lives in mention-store.ts.

export type FileMention = Mention & {
  /** Workspace-relative POSIX path of the file the marker lives in. */
  file: string;
  /** ISO timestamp the mention was first observed at runtime. */
  created_at: string;
};

export type MentionCreatedAtMap = Map<string, string>;

export type ListPendingResult = {
  mentions: FileMention[];
  /** Files we attempted to parse, with per-file malformed-marker error counts. */
  malformedByFile: Map<string, ParseError[]>;
};

const SCAN_IGNORE = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/.sidebar/**"];

/**
 * Walk every file in the workspace glob, parse the markers, and return all
 * well-formed mentions across files. Malformed markers are skipped from the
 * returned mentions but their errors are returned per-file so callers can
 * surface "one stderr warning per file" (spec: Failure Modes / Malformed
 * markers).
 *
 * `firstSeenAt` maps mention id -> ISO timestamp; the caller (the server's
 * mention-tracker) supplies it so re-scans don't reset created_at.
 */
export async function listMentions(
  ws: Workspace,
  firstSeenAt: MentionCreatedAtMap,
  now: () => Date = () => new Date(),
): Promise<ListPendingResult> {
  const files = await fastGlob(ws.innerGlob, {
    cwd: ws.root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: SCAN_IGNORE,
  });
  files.sort();
  const out: FileMention[] = [];
  const malformedByFile = new Map<string, ParseError[]>();
  for (const rel of files) {
    let text: string;
    try {
      text = await readFile(ws.toAbs(rel), "utf8");
    } catch {
      continue;
    }
    const parsed = parseMarkers(text);
    if (parsed.errors.length > 0) malformedByFile.set(rel, parsed.errors);
    for (const m of parsed.mentions) {
      let createdAt = firstSeenAt.get(m.id);
      if (!createdAt) {
        createdAt = now().toISOString();
        firstSeenAt.set(m.id, createdAt);
      }
      out.push({ ...m, file: rel, created_at: createdAt });
    }
  }
  return { mentions: out, malformedByFile };
}

export async function findMention(
  ws: Workspace,
  mentionId: string,
  firstSeenAt: MentionCreatedAtMap,
): Promise<FileMention | null> {
  const result = await listMentions(ws, firstSeenAt);
  return result.mentions.find((m) => m.id === mentionId) ?? null;
}

export type CreateMentionInput = {
  path: string;
  /** UTF-16 char offset where the target region begins (inclusive). */
  startOffset: number;
  /** UTF-16 char offset where the target region ends (exclusive). */
  endOffset: number;
  verb: string;
  instruction: string;
  /** Resolved human author (caller passes the already-resolved value). */
  author: string;
};

export type CreateMentionResult = {
  mention: {
    id: string;
    file: string;
    verb: string;
    author: string;
    instruction: string;
    targetContent: string;
    baseHash: string;
  };
  /** The new file content (returned so the caller can broadcast it). */
  newContent: string;
  diskHash: string;
};

/**
 * Wrap the target region in a begin/end pair and write the new file to disk.
 * The id is generated server-side (ADR-0003: the agent never invents an id;
 * the same rule applies to the editor — the parser-resident state is the
 * only source of truth for ids).
 */
export async function createMention(
  ws: Workspace,
  input: CreateMentionInput,
): Promise<CreateMentionResult> {
  const abs = ws.toAbs(input.path);
  const original = await readFile(abs, "utf8");
  if (input.startOffset < 0 || input.endOffset > original.length || input.startOffset > input.endOffset) {
    throw new Error(
      `createMention: invalid offsets [${input.startOffset}, ${input.endOffset}] for file length ${original.length}`,
    );
  }
  const before = original.slice(0, input.startOffset);
  const target = original.slice(input.startOffset, input.endOffset);
  const after = original.slice(input.endOffset);

  // Mention markers occupy full lines. Insert a newline before the begin
  // marker if the cut isn't at a line boundary, and after the end marker
  // if the cut isn't at the start of a line.
  const beginPrefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const endSuffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

  // The target region itself should end in a newline so the end marker sits
  // on its own line; if the user selected a partial line, normalize.
  const normalizedTarget = target.length === 0 || target.endsWith("\n") ? target : `${target}\n`;

  const id = generateMentionId();
  const begin = formatMentionBegin({
    id,
    verb: input.verb,
    origin: "human",
    author: input.author,
    instruction: input.instruction,
  });
  const end = formatMentionEnd(id);

  const newContent = `${before}${beginPrefix}${begin}\n${normalizedTarget}${end}${endSuffix}${after}`;
  await writeFile(abs, newContent, "utf8");

  return {
    mention: {
      id,
      file: input.path,
      verb: input.verb,
      author: sanitizeAttribute(input.author),
      instruction: input.instruction,
      targetContent: normalizedTarget,
      baseHash: computeMentionBaseHash(normalizedTarget),
    },
    newContent,
    diskHash: "",
  };
}

export type ResolveAction =
  | { type: "replace"; content: string }
  | { type: "annotation"; annotation_type: "note"; text: string };

export type ResolveResult =
  | { kind: "ok"; newContent: string }
  | { kind: "conflict"; current_base_hash: string }
  | { kind: "not-found" }
  | { kind: "orphaned" }
  | { kind: "verb-not-replaceable"; verb: string };

/**
 * Resolve a mention. Honors ADR-0002: the begin/end pair disappears.
 *
 *  - replace: the entire begin/end pair plus the target region is replaced by
 *    the agent's content. Authorization scope is exactly this region.
 *  - annotation (note): the mention markers go; the original target prose
 *    stays in place; a new note annotation wraps that target.
 *
 * The caller is responsible for verb-policy enforcement (replace requires the
 * verb's catalog entry to be in "replace" mode; unknown or "annotation"-mode
 * verbs are restricted to annotation actions only).
 */
export async function resolveMention(
  ws: Workspace,
  mentionId: string,
  action: ResolveAction,
  agentBaseHash: string,
  options: {
    verbMode: "replace" | "annotation" | "unknown";
    annotationAuthor: string;
    firstSeenAt: MentionCreatedAtMap;
  },
): Promise<ResolveResult> {
  // Re-scan to find the mention. We need a fresh parse so we can refuse on
  // base_hash mismatch.
  const result = await listMentions(ws, options.firstSeenAt);
  const target = result.mentions.find((m) => m.id === mentionId);
  if (!target) return { kind: "not-found" };
  if (target.orphan) return { kind: "orphaned" };
  if (target.baseHash !== agentBaseHash) {
    return { kind: "conflict", current_base_hash: target.baseHash };
  }

  if (action.type === "replace") {
    if (options.verbMode !== "replace") {
      return { kind: "verb-not-replaceable", verb: target.verb };
    }
    const abs = ws.toAbs(target.file);
    const original = await readFile(abs, "utf8");
    const replacement = ensureTrailingNewline(action.content);
    const newContent =
      original.slice(0, target.beginLineStart) + replacement + original.slice(target.endLineEnd);
    await writeFile(abs, newContent, "utf8");
    return { kind: "ok", newContent };
  }

  // Annotation resolution. The mention markers are stripped; the original
  // target content stays; a fresh note annotation pair wraps the same region.
  const noteId = generateNoteId();
  const noteBegin = formatAnnotationBegin({
    type: "note",
    id: noteId,
    author: options.annotationAuthor,
    instruction: action.text,
  });
  const noteEnd = formatAnnotationEnd(noteId);

  const abs = ws.toAbs(target.file);
  const original = await readFile(abs, "utf8");
  const replacement = `${noteBegin}\n${target.targetContent}${noteEnd}\n`;
  const newContent =
    original.slice(0, target.beginLineStart) + replacement + original.slice(target.endLineEnd);
  await writeFile(abs, newContent, "utf8");
  return { kind: "ok", newContent };
}

/**
 * Cancel an open mention from the editor (right-click "cancel mention"
 * action). The begin/end pair is removed; the target content stays.
 */
export async function cancelMention(
  ws: Workspace,
  mentionId: string,
  firstSeenAt: MentionCreatedAtMap,
): Promise<{ kind: "ok"; newContent: string; file: string } | { kind: "not-found" }> {
  const result = await listMentions(ws, firstSeenAt);
  const target = result.mentions.find((m) => m.id === mentionId);
  if (!target) return { kind: "not-found" };
  const abs = ws.toAbs(target.file);
  const original = await readFile(abs, "utf8");
  const newContent =
    original.slice(0, target.beginLineStart) +
    target.targetContent +
    original.slice(target.endLineEnd);
  await writeFile(abs, newContent, "utf8");
  return { kind: "ok", newContent, file: target.file };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

/**
 * Emit one stderr warning per file that has malformed markers (spec: Failure
 * Modes / Malformed markers — "one warning per affected file, not per
 * marker"). Used by the listMentions consumer; held here so the wording is
 * shared across MCP and editor entry points.
 */
export function warnOnceForMalformed(malformedByFile: Map<string, ParseError[]>): void {
  for (const [file, errors] of malformedByFile) {
    const kinds = Array.from(new Set(errors.map((e) => e.kind))).join(",");
    log.warn(`malformed sidebar markers in ${file} (${errors.length} defect(s): ${kinds})`);
  }
}

// `existsSync` / `statSync` aren't used here but the editor's CodeMirror
// integration imports them transitively via @codemirror modules. Re-export
// nothing; this comment exists to flag the dependency awareness for future
// maintainers.
void existsSync;
void statSync;
void resolveHumanAuthor;
