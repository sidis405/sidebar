export type ConflictPayload = {
  path: string;
  ours: string;
  theirs: string;
  /** sha256 of `theirs` — used as the base hash when resolving via "take theirs". */
  theirsHash: string;
};

export type ConflictModalProps = {
  conflict: ConflictPayload;
  onKeepOurs: () => void;
  onTakeTheirs: () => void;
  onMergeView: () => void;
  onCancel: () => void;
};

export function ConflictModal({
  conflict,
  onKeepOurs,
  onTakeTheirs,
  onMergeView,
  onCancel,
}: ConflictModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal>
      <div className="modal">
        <header>
          <h2>conflict</h2>
          <p>
            <code>{conflict.path}</code> changed on disk while your buffer had
            unsaved edits.
          </p>
        </header>
        <section className="merge-preview">
          <div>
            <h3>yours (buffer)</h3>
            <pre>{conflict.ours}</pre>
          </div>
          <div>
            <h3>theirs (disk)</h3>
            <pre>{conflict.theirs}</pre>
          </div>
        </section>
        <footer>
          <button onClick={onMergeView}>merge view</button>
          <button onClick={onTakeTheirs}>take theirs</button>
          <button onClick={onKeepOurs} className="primary">
            keep yours
          </button>
          <button onClick={onCancel} className="link">
            close
          </button>
        </footer>
      </div>
    </div>
  );
}
