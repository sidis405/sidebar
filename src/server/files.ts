import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { sha256 } from "./hash.js";
import type { Workspace } from "./workspace.js";

export type ReadResult = { content: string; hash: string };

export async function readWorkspaceFile(
  ws: Workspace,
  relPath: string,
): Promise<ReadResult> {
  const safe = assertSafeRel(relPath);
  assertInScope(ws, safe);
  const content = await readFile(ws.toAbs(safe), "utf8");
  return { content, hash: sha256(content) };
}

export type SaveOutcome =
  | { kind: "saved"; hash: string }
  | { kind: "conflict"; diskHash: string; content: string };

export async function saveWorkspaceFile(
  ws: Workspace,
  relPath: string,
  content: string,
  baseHash: string,
): Promise<SaveOutcome> {
  const safe = assertSafeRel(relPath);
  assertInScope(ws, safe);
  const abs = ws.toAbs(safe);
  try {
    const onDisk = await readFile(abs, "utf8");
    const diskHash = sha256(onDisk);
    if (diskHash !== baseHash) {
      return { kind: "conflict", diskHash, content: onDisk };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // First save of a file the editor just created in-memory: only accept
    // if the editor declared an empty base.
    if (baseHash !== sha256("")) {
      return { kind: "conflict", diskHash: sha256(""), content: "" };
    }
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return { kind: "saved", hash: sha256(content) };
}

export async function createFile(
  ws: Workspace,
  parent: string,
  name: string,
): Promise<string> {
  validateName(name);
  if (!name.endsWith(".md")) {
    throw new Error(`new file must end in .md (got ${name})`);
  }
  const rel = joinRel(parent, name);
  assertInScope(ws, rel);
  const abs = ws.toAbs(rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, "", { encoding: "utf8", flag: "wx" });
  return rel;
}

export async function createFolder(
  ws: Workspace,
  parent: string,
  name: string,
): Promise<string> {
  validateName(name);
  const rel = joinRel(parent, name);
  await mkdir(ws.toAbs(rel), { recursive: false });
  return rel;
}

export async function renamePath(
  ws: Workspace,
  from: string,
  to: string,
): Promise<void> {
  const safeFrom = assertSafeRel(from);
  const safeTo = assertSafeRel(to);
  // node:fs/promises rename silently clobbers an existing destination on
  // POSIX. Stat first and refuse rather than destroying the user's content.
  // (A concurrent write between this stat and the rename below would surface
  // via the editor's conflict modal on next save anyway, but for tree CRUD
  // we want the clearer "destination already exists" failure.)
  const toAbs = ws.toAbs(safeTo);
  try {
    await stat(toAbs);
    throw new Error(`destination already exists: ${to}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(dirname(toAbs), { recursive: true });
  await rename(ws.toAbs(safeFrom), toAbs);
}

export async function deletePath(ws: Workspace, relPath: string): Promise<void> {
  const safe = assertSafeRel(relPath);
  await rm(ws.toAbs(safe), { recursive: true, force: false });
}

function assertSafeRel(rel: string): string {
  if (rel === "") throw new Error("path is empty");
  // The protocol declares POSIX paths. Backslashes are directory separators
  // on Windows after we hand the string to node:path, so posix.normalize
  // would let "sub\\..\\..\\outside.md" pass while the filesystem treats it
  // as a parent-directory traversal. Reject up front.
  if (rel.includes("\\")) throw new Error(`path uses backslash separators: ${rel}`);
  if (rel.includes("\0")) throw new Error(`path contains NUL: ${rel}`);
  const norm = posix.normalize(rel);
  if (norm.startsWith("..") || norm.startsWith("/") || norm === ".") {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return norm;
}

function assertInScope(ws: Workspace, safeRel: string): void {
  if (!ws.matches(safeRel)) {
    throw new Error(`path is outside workspace scope (${ws.scope}): ${safeRel}`);
  }
}

function joinRel(parent: string, name: string): string {
  validateName(name);
  if (!parent) return name;
  return assertSafeRel(posix.join(parent, name));
}

function validateName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error(`invalid name: ${JSON.stringify(name)}`);
  }
  if (name === "." || name === "..") {
    throw new Error(`invalid name: ${JSON.stringify(name)}`);
  }
}
