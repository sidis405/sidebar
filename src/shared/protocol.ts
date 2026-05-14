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

export type VerbDescriptor = {
  name: string;
  /** `replace` and `annotation` cover human verbs; agent verbs use `agent`. */
  kind: "human-replace" | "human-annotation" | "agent";
  builtin: boolean;
};

export type VerbCatalogSnapshot = {
  human: VerbDescriptor[];
  agent: VerbDescriptor[];
};

export type PendingMentionView = {
  id: string;
  file: string;
  origin: "human" | "agent";
  verb: string;
  author: string;
  instruction: string;
  /** True when target_content is empty/whitespace-only. */
  orphan: boolean;
  /** ISO timestamp the mention was first observed. */
  created_at: string;
  /** Present when an MCP client has claimed the mention. */
  inProgress?: { agent: string; claimedAt: number };
};

export type ConnectedAgentView = {
  name: string;
  /** UNIX ms timestamp. */
  connectedAt: number;
};

export type RecentEventView = {
  id: number;
  kind: string;
  at: string;
  mention_id?: string;
  file?: string;
  agent?: string;
  author?: string;
  verb?: string;
  origin?: string;
  reason?: string;
  resolution?: string;
};

export type StatusSnapshot = {
  pendingMentions: PendingMentionView[];
  connectedAgents: ConnectedAgentView[];
  recentEvents: RecentEventView[];
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
  | { kind: "dirty"; path: string; isDirty: boolean }
  /** Cmd-K mention creation (slice 4). */
  | {
      kind: "createMention";
      path: string;
      startOffset: number;
      endOffset: number;
      verb: string;
      instruction: string;
    }
  /** Status drawer right-click "cancel mention". */
  | { kind: "cancelMention"; mentionId: string }
  /** Status drawer right-click "release stuck claim". */
  | { kind: "releaseClaim"; mentionId: string }
  /** Editor asks for the verb catalog (built-ins + custom). */
  | { kind: "verbCatalog" }
  /** Editor asks for the current status snapshot. */
  | { kind: "statusRequest" };

export type ServerMessage =
  | { kind: "welcome"; workspaceRoot: string; scope: string }
  | { kind: "tree"; nodes: TreeNode[] }
  | { kind: "treeChanged"; nodes: TreeNode[] }
  | { kind: "fileOpen"; path: string; content: string; diskHash: string }
  | { kind: "saved"; path: string; diskHash: string }
  | { kind: "diskChanged"; path: string; diskHash: string; content: string }
  | { kind: "diskRemoved"; path: string }
  | { kind: "saveConflict"; path: string; diskHash: string; content: string }
  | { kind: "verbCatalog"; catalog: VerbCatalogSnapshot }
  | {
      kind: "mentionCreated";
      mentionId: string;
      file: string;
    }
  | { kind: "status"; snapshot: StatusSnapshot }
  | { kind: "error"; message: string; cause?: string };
