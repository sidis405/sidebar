// Wire protocol shared by the editor SPA and the sidebar server.
// Messages flow over a single WebSocket per editor tab. Both sides emit JSON.

export type TreeNode = {
  id: string;
  name: string;
  /** POSIX-style path relative to the workspace root. */
  path: string;
  kind: "file" | "dir";
  children?: TreeNode[];
};

export type ClientMessage =
  | { kind: "hello" }
  | { kind: "list" }
  | { kind: "open"; path: string }
  | { kind: "save"; path: string; content: string; baseHash: string }
  | { kind: "newFile"; parent: string; name: string }
  | { kind: "newFolder"; parent: string; name: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "delete"; path: string }
  /**
   * Editor reports whether the in-memory buffer for `path` matches disk.
   * The server forwards this into the dirty-buffer tracker that backs
   * `read_doc`'s `is_draft` / `draft_age_seconds` fields (ADR-0005).
   */
  | { kind: "dirty"; path: string; isDirty: boolean };

export type ServerMessage =
  | { kind: "welcome"; workspaceRoot: string; scope: string }
  | { kind: "tree"; nodes: TreeNode[] }
  | { kind: "treeChanged"; nodes: TreeNode[] }
  | { kind: "fileOpen"; path: string; content: string; diskHash: string }
  | { kind: "saved"; path: string; diskHash: string }
  | { kind: "diskChanged"; path: string; diskHash: string; content: string }
  | { kind: "diskRemoved"; path: string }
  | { kind: "saveConflict"; path: string; diskHash: string; content: string }
  | { kind: "error"; message: string; cause?: string };
