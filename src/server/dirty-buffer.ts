// Tracks the editor's dirty-buffer state per workspace file path.
//
// The CodeMirror editor in the browser holds the source of truth for buffer
// state; it pushes a `dirty` notification over the WebSocket whenever the
// dirty status of a path flips. The MCP `read_doc` tool reads from this
// store to populate `is_draft` and `draft_age_seconds`.
//
// State is process-local and transient (Q15 / ADR-0005). Disconnect of the
// last editor tab clears everything: a draft only exists while an editor is
// holding it.

export type DirtyBufferTracker = {
  setDirty: (path: string, isDirty: boolean) => void;
  isDirty: (path: string) => boolean;
  draftAgeSeconds: (path: string) => number;
  clearAll: () => void;
};

export function createDirtyBufferTracker(now: () => number = Date.now): DirtyBufferTracker {
  // Stores the timestamp at which the path went dirty. Removing the entry
  // means the buffer is clean.
  const dirtyAt = new Map<string, number>();
  return {
    setDirty(path, isDirty) {
      if (isDirty) {
        if (!dirtyAt.has(path)) dirtyAt.set(path, now());
      } else {
        dirtyAt.delete(path);
      }
    },
    isDirty(path) {
      return dirtyAt.has(path);
    },
    draftAgeSeconds(path) {
      const t = dirtyAt.get(path);
      if (t === undefined) return 0;
      return Math.max(0, Math.floor((now() - t) / 1000));
    },
    clearAll() {
      dirtyAt.clear();
    },
  };
}
