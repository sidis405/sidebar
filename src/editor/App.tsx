import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ServerMessage,
  StatusSnapshot,
  TreeNode,
  VerbCatalogSnapshot,
} from "../shared/protocol.ts";
import { CmdK, type CmdKAnchor } from "./CmdK.tsx";
import { ConflictModal, type ConflictPayload } from "./ConflictModal.tsx";
import { Editor } from "./Editor.tsx";
import { FileTree } from "./FileTree.tsx";
import { StatusDrawer } from "./StatusDrawer.tsx";
import { useWs } from "./useWs.ts";

type OpenFile = {
  path: string;
  /** Contents currently on disk, as last known by the editor. */
  diskContent: string;
  diskHash: string;
  /** Contents in the editor buffer. */
  buffer: string;
};

type CmdKState = {
  open: true;
  startOffset: number;
  endOffset: number;
  anchor: CmdKAnchor;
};

export function App() {
  const ws = useWs();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [conflict, setConflict] = useState<ConflictPayload | null>(null);
  const [catalog, setCatalog] = useState<VerbCatalogSnapshot | null>(null);
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [cmdk, setCmdk] = useState<CmdKState | null>(null);
  const dirtyPaths = useMemo(() => {
    const s = new Set<string>();
    if (open && open.buffer !== open.diskContent) s.add(open.path);
    return s;
  }, [open]);

  // Mirror the editor's dirty-buffer state to the server so MCP `read_doc`
  // can populate `is_draft` and `draft_age_seconds` for connected agents
  // (ADR-0005, spec: Dirty Buffer During Agent Action).
  const lastReportedDirty = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (ws.state !== "open") return;
    const isDirty = open ? open.buffer !== open.diskContent : false;
    if (open) {
      const last = lastReportedDirty.current.get(open.path);
      if (last !== isDirty) {
        lastReportedDirty.current.set(open.path, isDirty);
        ws.send({ kind: "dirty", path: open.path, isDirty });
      }
    }
  }, [open, ws]);

  useEffect(() => {
    return ws.subscribe((msg: ServerMessage) => {
      switch (msg.kind) {
        case "welcome":
          return;
        case "tree":
        case "treeChanged":
          setTree(msg.nodes);
          return;
        case "fileOpen":
          setOpen({
            path: msg.path,
            diskContent: msg.content,
            diskHash: msg.diskHash,
            buffer: msg.content,
          });
          return;
        case "saved":
          setOpen((prev) =>
            prev && prev.path === msg.path
              ? { ...prev, diskContent: prev.buffer, diskHash: msg.diskHash }
              : prev,
          );
          return;
        case "diskChanged":
          setOpen((prev) => {
            if (!prev || prev.path !== msg.path) return prev;
            const dirty = prev.buffer !== prev.diskContent;
            if (dirty) {
              setConflict({
                path: msg.path,
                ours: prev.buffer,
                theirs: msg.content,
                theirsHash: msg.diskHash,
              });
              return prev;
            }
            return {
              path: msg.path,
              diskContent: msg.content,
              diskHash: msg.diskHash,
              buffer: msg.content,
            };
          });
          return;
        case "diskRemoved":
          setOpen((prev) => {
            if (!prev || prev.path !== msg.path) return prev;
            const dirty = prev.buffer !== prev.diskContent;
            if (dirty) return prev;
            return null;
          });
          return;
        case "saveConflict":
          setOpen((prev) => {
            if (!prev || prev.path !== msg.path) return prev;
            setConflict({
              path: msg.path,
              ours: prev.buffer,
              theirs: msg.content,
              theirsHash: msg.diskHash,
            });
            return prev;
          });
          return;
        case "verbCatalog":
          setCatalog(msg.catalog);
          return;
        case "status":
          setStatus(msg.snapshot);
          return;
        case "mentionCreated":
          // Server has rewritten the file with the marker; the watcher will
          // broadcast diskChanged shortly. Close the popover so the editor
          // refreshes naturally.
          setCmdk(null);
          return;
        case "error":
          console.error("[sidebar] server error:", msg.message, msg.cause ?? "");
          return;
      }
    });
  }, [ws]);

  // Once connected, pull the verb catalog + first status snapshot.
  useEffect(() => {
    if (ws.state !== "open") return;
    ws.send({ kind: "list" });
    ws.send({ kind: "verbCatalog" });
    ws.send({ kind: "statusRequest" });
  }, [ws.state, ws.send]);

  const handleOpen = useCallback(
    (path: string) => {
      ws.send({ kind: "open", path });
    },
    [ws],
  );
  const handleSave = useCallback(() => {
    if (!open) return;
    ws.send({ kind: "save", path: open.path, content: open.buffer, baseHash: open.diskHash });
  }, [open, ws]);
  const handleNewFile = useCallback(
    (parent: string, name: string) => {
      ws.send({ kind: "newFile", parent, name });
    },
    [ws],
  );
  const handleNewFolder = useCallback(
    (parent: string, name: string) => {
      ws.send({ kind: "newFolder", parent, name });
    },
    [ws],
  );
  const handleRename = useCallback(
    (from: string, to: string) => {
      ws.send({ kind: "rename", from, to });
      setOpen((prev) => (prev && prev.path === from ? { ...prev, path: to } : prev));
    },
    [ws],
  );
  const handleDelete = useCallback(
    (path: string, confirmIfDirty: boolean) => {
      if (confirmIfDirty) {
        const ok = window.confirm(`${path} has unsaved edits. Delete anyway?`);
        if (!ok) return;
      }
      ws.send({ kind: "delete", path });
      setOpen((prev) => (prev && prev.path === path ? null : prev));
    },
    [ws],
  );

  const handleCmdK = useCallback(
    (selection: {
      startOffset: number;
      endOffset: number;
      anchor: CmdKAnchor;
    }) => {
      if (!open) return;
      // The Cmd-K popover wants byte offsets in the doc as it sits on disk.
      // If the buffer is dirty, ask the user to save first; otherwise the
      // marker would be inserted into a stale on-disk version.
      if (open.buffer !== open.diskContent) {
        window.alert(
          "Save the file (Cmd-S) before creating a mention. The marker is written to disk, and your unsaved buffer would conflict with the marker insertion.",
        );
        return;
      }
      setCmdk({ open: true, ...selection });
    },
    [open],
  );

  const submitCmdK = useCallback(
    (verb: string, instruction: string) => {
      if (!open || !cmdk) return;
      ws.send({
        kind: "createMention",
        path: open.path,
        startOffset: cmdk.startOffset,
        endOffset: cmdk.endOffset,
        verb,
        instruction,
      });
    },
    [ws, open, cmdk],
  );

  const cancelMention = useCallback(
    (id: string) => ws.send({ kind: "cancelMention", mentionId: id }),
    [ws],
  );
  const releaseClaim = useCallback(
    (id: string) => ws.send({ kind: "releaseClaim", mentionId: id }),
    [ws],
  );

  const isDirty = open ? open.buffer !== open.diskContent : false;

  return (
    <div className="app">
      <aside className="sidebar">
        <FileTree
          nodes={tree}
          selectedPath={open?.path ?? null}
          onOpen={handleOpen}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onDelete={handleDelete}
          dirtyPaths={dirtyPaths}
        />
      </aside>
      <main className="editor-pane">
        <header className="editor-header">
          <span className="filename">
            {open ? open.path : "no file open"}
            {isDirty && <span className="dirty">●</span>}
          </span>
          <span className={`connection ${ws.state}`}>
            {ws.state === "open" && "connected"}
            {ws.state === "connecting" && "connecting..."}
            {ws.state === "reconnecting" && `reconnecting (attempt ${ws.attempts})...`}
            {ws.state === "closed" && "disconnected"}
          </span>
        </header>
        {open ? (
          <Editor
            value={open.buffer}
            onChange={(v) => setOpen((prev) => (prev ? { ...prev, buffer: v } : prev))}
            onSaveRequest={handleSave}
            onCmdK={handleCmdK}
          />
        ) : (
          <div className="empty-state">
            <p>select a markdown file from the tree to open it.</p>
          </div>
        )}
      </main>
      <StatusDrawer
        snapshot={status}
        onCancelMention={cancelMention}
        onReleaseClaim={releaseClaim}
        onOpenFile={handleOpen}
      />
      {cmdk && (
        <CmdK
          catalog={catalog}
          anchor={cmdk.anchor}
          onCancel={() => setCmdk(null)}
          onSubmit={submitCmdK}
        />
      )}
      {conflict && (
        <ConflictModal
          conflict={conflict}
          onKeepOurs={() => {
            setOpen((prev) =>
              prev && prev.path === conflict.path
                ? { ...prev, diskContent: conflict.theirs, diskHash: conflict.theirsHash }
                : prev,
            );
            setConflict(null);
          }}
          onTakeTheirs={() => {
            setOpen((prev) =>
              prev && prev.path === conflict.path
                ? {
                    path: prev.path,
                    diskContent: conflict.theirs,
                    diskHash: conflict.theirsHash,
                    buffer: conflict.theirs,
                  }
                : prev,
            );
            setConflict(null);
          }}
          onMergeView={() => {
            const el = document.querySelector(".merge-preview");
            (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth" });
          }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  );
}
