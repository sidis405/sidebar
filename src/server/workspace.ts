import { existsSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import fastGlob from "fast-glob";
import picomatch from "picomatch";
import type { TreeNode } from "../shared/protocol.js";

export type Workspace = {
  /** Absolute path of the workspace's logical root (e.g. <cwd>/docs). */
  root: string;
  /** Original scope glob as the user supplied it, e.g. "docs/**\/*.md". */
  scope: string;
  /** Glob applied relative to `root`, e.g. "**\/*.md". */
  innerGlob: string;
  /** Match a workspace-relative path against the inner glob. */
  matches: (relPath: string) => boolean;
  toAbs: (relPath: string) => string;
};

const DEFAULT_SCOPE = "docs/**/*.md";

export function defaultScope(): string {
  return DEFAULT_SCOPE;
}

export function isDefaultScope(scope: string): boolean {
  return scope === DEFAULT_SCOPE;
}

export function defaultScopeDirExists(cwd: string): boolean {
  return existsSync(join(cwd, "docs"));
}

export function createWorkspace(cwd: string, scope: string): Workspace {
  const prefix = staticPrefix(scope);
  const root = prefix ? resolve(cwd, prefix) : resolve(cwd);
  const innerGlob = prefix ? scope.slice(prefix.length + 1) : scope;
  const matcher = picomatch(innerGlob || "**", { dot: false });
  return {
    root,
    scope,
    innerGlob: innerGlob || "**",
    matches: (relPath) => matcher(relPath),
    toAbs: (relPath) => join(root, ...relPath.split("/")),
  };
}

export async function buildTree(ws: Workspace): Promise<TreeNode[]> {
  const ignores = ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/.sidebar/**"];
  const [files, dirs] = await Promise.all([
    fastGlob(ws.innerGlob, {
      cwd: ws.root,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ignores,
    }),
    // Surface empty directories too so the user can navigate into folders
    // that hold no files yet.
    fastGlob("**", {
      cwd: ws.root,
      onlyDirectories: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ignores,
    }),
  ]);
  return toTree(files.sort(), dirs.sort());
}

type DirNode = {
  readonly _dir: true;
  name: string;
  path: string;
  children: Map<string, DirNode | TreeNode>;
};

function isDirNode(v: DirNode | TreeNode): v is DirNode {
  return (v as DirNode)._dir === true;
}

function toTree(filePaths: string[], dirPaths: string[]): TreeNode[] {
  const root: DirNode = { _dir: true, name: "", path: "", children: new Map() };

  const ensureDir = (parts: string[]): DirNode => {
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      const existing = cur.children.get(part);
      if (existing && isDirNode(existing)) {
        cur = existing;
      } else {
        // Either no entry, or a file shadowing the same name (can't actually
        // happen on a real fs, but be defensive). Replace with a fresh dir.
        const fresh: DirNode = { _dir: true, name: part, path, children: new Map() };
        cur.children.set(part, fresh);
        cur = fresh;
      }
    }
    return cur;
  };

  for (const d of dirPaths) ensureDir(d.split("/"));

  for (const f of filePaths) {
    const parts = f.split("/");
    const parent = ensureDir(parts.slice(0, -1));
    const leaf = parts[parts.length - 1];
    parent.children.set(leaf, { id: f, name: leaf, path: f, kind: "file" });
  }

  return emit(root);
}

function emit(dir: DirNode): TreeNode[] {
  const folders: DirNode[] = [];
  const files: TreeNode[] = [];
  for (const child of dir.children.values()) {
    if (isDirNode(child)) folders.push(child);
    else files.push(child);
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  const out: TreeNode[] = [];
  for (const f of folders) {
    out.push({
      id: f.path,
      name: f.name,
      path: f.path,
      kind: "dir",
      children: emit(f),
    });
  }
  out.push(...files);
  return out;
}

export function startWatcher(
  ws: Workspace,
  onTreeChange: () => void,
  onExternalEdit: (relPath: string) => void,
): FSWatcher {
  const watcher = chokidar.watch(".", {
    cwd: ws.root,
    ignoreInitial: true,
    persistent: true,
    ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/.sidebar/**"],
  });
  const normalize = (p: string) => p.split(sep).join(posix.sep);
  watcher.on("add", () => onTreeChange());
  watcher.on("unlink", () => onTreeChange());
  watcher.on("addDir", () => onTreeChange());
  watcher.on("unlinkDir", () => onTreeChange());
  watcher.on("change", (p) => {
    const rel = normalize(p);
    if (ws.matches(rel)) onExternalEdit(rel);
  });
  return watcher;
}

function staticPrefix(scope: string): string | null {
  const wildIdx = scope.search(/[*?[]/);
  if (wildIdx === -1) return scope;
  if (wildIdx === 0) return null;
  const before = scope.slice(0, wildIdx);
  const lastSlash = before.lastIndexOf("/");
  return lastSlash === -1 ? null : before.slice(0, lastSlash);
}
