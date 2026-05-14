import { readFile, writeFile } from "node:fs/promises";
import fastGlob from "fast-glob";
import {
  type Annotation,
  decodeAnnotationContent,
  formatAnnotationBegin,
  formatAnnotationEnd,
  parseMarkers,
} from "../shared/markers.js";
import { generateNoteId, generateSuggestionId } from "./marker-ids.js";
import type { Workspace } from "./workspace.js";

// Slice 5 surfaces the on-disk annotation catalog (notes + suggestions) and
// the file-level operations that mutate it. Everything in this module is
// stateless: we re-scan the workspace on demand the same way mention-ops.ts
// does. Process-local transient state (recent events) lives in
// mention-store.ts and is appended to via the MCP/WS entry points.

export type FileAnnotation = Annotation & {
  /** Workspace-relative POSIX path of the file the marker lives in. */
  file: string;
  /** ISO timestamp the annotation was first observed at runtime. */
  created_at: string;
};

export type AnnotationCreatedAtMap = Map<string, string>;

const SCAN_IGNORE = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/.sidebar/**"];

/** Walk every file in scope (or one specific file) and return annotations. */
export async function listAnnotations(
  ws: Workspace,
  firstSeenAt: AnnotationCreatedAtMap,
  options: { path?: string; now?: () => Date } = {},
): Promise<FileAnnotation[]> {
  const now = options.now ?? (() => new Date());
  let files: string[];
  if (options.path) {
    if (!ws.matches(options.path)) return [];
    files = [options.path];
  } else {
    files = await fastGlob(ws.innerGlob, {
      cwd: ws.root,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: SCAN_IGNORE,
    });
    files.sort();
  }
  const out: FileAnnotation[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = await readFile(ws.toAbs(rel), "utf8");
    } catch {
      continue;
    }
    const parsed = parseMarkers(text);
    for (const a of parsed.annotations) {
      let createdAt = firstSeenAt.get(a.id);
      if (!createdAt) {
        createdAt = now().toISOString();
        firstSeenAt.set(a.id, createdAt);
      }
      out.push({ ...a, file: rel, created_at: createdAt });
    }
  }
  return out;
}

export async function findAnnotation(
  ws: Workspace,
  id: string,
  firstSeenAt: AnnotationCreatedAtMap,
): Promise<FileAnnotation | null> {
  const list = await listAnnotations(ws, firstSeenAt);
  return list.find((a) => a.id === id) ?? null;
}

export type TargetAnchor = { start: number; end: number };

export type AddAnnotationInput = {
  path: string;
  target_anchor: TargetAnchor;
  type: "note" | "suggestion";
  content: string;
  author: string;
};

export type AddAnnotationResult = {
  annotation: {
    id: string;
    file: string;
    type: "note" | "suggestion";
    author: string;
    content: string;
    target_content: string;
    target_anchor: TargetAnchor;
  };
  newContent: string;
};

/**
 * Wrap the target region in a begin/end annotation pair and write the file.
 * Markers occupy full lines; if the cut isn't at a line boundary we splice
 * newlines the same way createMention does (slice 4 contract).
 */
export async function addAnnotation(
  ws: Workspace,
  input: AddAnnotationInput,
): Promise<AddAnnotationResult> {
  const abs = ws.toAbs(input.path);
  const original = await readFile(abs, "utf8");
  const { start, end } = input.target_anchor;
  if (start < 0 || end > original.length || start > end) {
    throw new Error(
      `addAnnotation: invalid target_anchor [${start}, ${end}] for file length ${original.length}`,
    );
  }
  const before = original.slice(0, start);
  const target = original.slice(start, end);
  const after = original.slice(end);

  const beginPrefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const endSuffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const normalizedTarget = target.length === 0 || target.endsWith("\n") ? target : `${target}\n`;

  const id = input.type === "note" ? generateNoteId() : generateSuggestionId();
  const begin = formatAnnotationBegin({
    type: input.type,
    id,
    author: input.author,
    instruction: input.content,
  });
  const endMarker = formatAnnotationEnd(id);

  const newContent = `${before}${beginPrefix}${begin}\n${normalizedTarget}${endMarker}${endSuffix}${after}`;
  await writeFile(abs, newContent, "utf8");
  return {
    annotation: {
      id,
      file: input.path,
      type: input.type,
      author: input.author,
      content: input.content,
      target_content: normalizedTarget,
      target_anchor: input.target_anchor,
    },
    newContent,
  };
}

export type UpdateAnnotationResult =
  | { kind: "ok"; file: string; type: "note" | "suggestion"; author: string }
  | { kind: "not-found" }
  | { kind: "forbidden"; author: string };

/**
 * Replace the begin marker's content payload in place. The author scope is
 * enforced by the caller (the MCP tool checks `author === agentName`); we
 * also surface the on-disk author so the caller can render the rejection
 * message.
 */
export async function updateAnnotation(
  ws: Workspace,
  id: string,
  content: string,
  options: { requireAuthor?: string; firstSeenAt: AnnotationCreatedAtMap },
): Promise<UpdateAnnotationResult> {
  const target = await findAnnotation(ws, id, options.firstSeenAt);
  if (!target) return { kind: "not-found" };
  if (options.requireAuthor !== undefined && target.author !== options.requireAuthor) {
    return { kind: "forbidden", author: target.author };
  }
  const abs = ws.toAbs(target.file);
  const original = await readFile(abs, "utf8");
  const beginLine = formatAnnotationBegin({
    type: target.type,
    id,
    author: target.author,
    instruction: content,
  });
  const newContent =
    original.slice(0, target.beginLineStart) +
    `${beginLine}\n` +
    original.slice(target.beginLineEnd);
  await writeFile(abs, newContent, "utf8");
  return { kind: "ok", file: target.file, type: target.type, author: target.author };
}

export type RemoveAnnotationResult =
  | { kind: "ok"; file: string; type: "note" | "suggestion"; author: string }
  | { kind: "not-found" }
  | { kind: "forbidden"; author: string };

/**
 * Strip the begin/end pair; leave the target prose in place. This is the
 * `note` lifecycle's only mutation (the `reject` action for a suggestion is
 * the same operation).
 */
export async function removeAnnotation(
  ws: Workspace,
  id: string,
  options: { requireAuthor?: string; firstSeenAt: AnnotationCreatedAtMap },
): Promise<RemoveAnnotationResult> {
  const target = await findAnnotation(ws, id, options.firstSeenAt);
  if (!target) return { kind: "not-found" };
  if (options.requireAuthor !== undefined && target.author !== options.requireAuthor) {
    return { kind: "forbidden", author: target.author };
  }
  const abs = ws.toAbs(target.file);
  const original = await readFile(abs, "utf8");
  const newContent =
    original.slice(0, target.beginLineStart) +
    target.targetContent +
    original.slice(target.endLineEnd);
  await writeFile(abs, newContent, "utf8");
  options.firstSeenAt.delete(id);
  return { kind: "ok", file: target.file, type: target.type, author: target.author };
}

export type AcceptSuggestionResult =
  | { kind: "ok"; file: string; author: string; replacement: string }
  | { kind: "not-found" }
  | { kind: "not-suggestion" };

/**
 * Swap the target region for the suggestion's content and remove the
 * begin/end pair. Used by the editor's side-card Accept button (and only by
 * the editor; the agent never accepts its own suggestion).
 *
 * The replacement is applied verbatim: no further markdown transformation,
 * no escaping, no fence rewrites. That contract is explicit in the spec.
 */
export async function acceptSuggestion(
  ws: Workspace,
  id: string,
  firstSeenAt: AnnotationCreatedAtMap,
): Promise<AcceptSuggestionResult> {
  const target = await findAnnotation(ws, id, firstSeenAt);
  if (!target) return { kind: "not-found" };
  if (target.type !== "suggestion") return { kind: "not-suggestion" };
  const abs = ws.toAbs(target.file);
  const original = await readFile(abs, "utf8");
  // The decoded content is the proposed replacement (markdown source). It
  // replaces the entire begin/end pair plus the target region between them.
  const replacement = ensureTrailingNewline(decodeAnnotationContent(target.instruction));
  const newContent =
    original.slice(0, target.beginLineStart) + replacement + original.slice(target.endLineEnd);
  await writeFile(abs, newContent, "utf8");
  firstSeenAt.delete(id);
  return { kind: "ok", file: target.file, author: target.author, replacement };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
