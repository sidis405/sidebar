import { useCallback, useEffect, useMemo, useState } from "react";
import { ConflictModal, type ConflictPayload } from "./ConflictModal.tsx";
import { Editor } from "./Editor.tsx";
import { FileTree } from "./FileTree.tsx";
import { useWs } from "./useWs.ts";
import type { ServerMessage, TreeNode } from "../shared/protocol.ts";

type OpenFile = {
  path: string;
  /** Contents currently on disk, as last known by the editor. */
  diskContent: string;
  diskHash: string;
  /** Contents in the editor buffer. */
  buffer: string;
};

export function App() {
  const ws = useWs();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [open, setOpen] = useState<OpenFile | null>(null);
  const [conflict, setConflict] = useState<ConflictPayload | null>(null);
  const dirtyPaths = useMemo(() => {
    const s = new Set<string>();
    if (open && open.buffer !== open.diskContent) s.add(open.path);
    return s;
  }, [open]);

  // Wire up server -> client message handling.
  useEffect(() => {
    return ws.subscribe((msg: ServerMessage) => {
      switch (msg.kind) {
        case "welcome":
          // Header text is set elsewhere from tree state; nothing to do.
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
            if (dirty) {
              // Preserve the buffer; tree update already removed the entry.
              return prev;
            }
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
        case "error":
          // Surface server errors via the console for V1; richer UI lands later.
          console.error("[sidebar] server error:", msg.message, msg.cause ?? "");
          return;
      }
    });
  }, [ws]);

  // Ask for the tree as soon as we're connected.
  useEffect(() => {
    if (ws.state === "open") ws.send({ kind: "list" });
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
      // Update the open buffer's path optimistically; the server's
      // subsequent diskChanged/treeChanged will reconcile content.
      setOpen((prev) => (prev && prev.path === from ? { ...prev, path: to } : prev));
    },
    [ws],
  );
  const handleDelete = useCallback(
    (path: string, confirmIfDirty: boolean) => {
      if (confirmIfDirty) {
        const ok = window.confirm(
          `${path} has unsaved edits. Delete anyway?`,
        );
        if (!ok) return;
      }
      ws.send({ kind: "delete", path });
      setOpen((prev) => (prev && prev.path === path ? null : prev));
    },
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
          />
        ) : (
          <div className="empty-state">
            <p>select a markdown file from the tree to open it.</p>
          </div>
        )}
      </main>
      {conflict && (
        <ConflictModal
          conflict={conflict}
          onKeepOurs={() => {
            // Refresh our notion of disk so the next save is rebased on theirs.
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
            // V1 merge view is the side-by-side panel that's already visible
            // in the modal; the action keeps the modal open until the user
            // picks ours/theirs. This button focuses the merge area for
            // keyboard users.
            const el = document.querySelector(".merge-preview");
            (el as HTMLElement | null)?.scrollIntoView({ behavior: "smooth" });
          }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  );
}
