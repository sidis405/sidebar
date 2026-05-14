import { useEffect, useMemo, useRef, useState } from "react";
import type { VerbCatalogSnapshot } from "../shared/protocol.ts";

// Cmd-K mention/annotation creation popover.
//
// Spec: Editor (V1) — "Cmd-K mention/annotation creation. Inline popover
// anchored to the selection. Verb autocomplete from the configured set.
// Sidebar inserts the begin/end pair with a generated id and renders the
// decoration immediately."

export type CmdKAnchor = {
  /** Viewport-relative coordinates near the editor's selection. */
  top: number;
  left: number;
};

export type CmdKProps = {
  catalog: VerbCatalogSnapshot | null;
  anchor: CmdKAnchor;
  onCancel: () => void;
  onSubmit: (verb: string, instruction: string) => void;
};

export function CmdK({ catalog, anchor, onCancel, onSubmit }: CmdKProps) {
  const [verbQuery, setVerbQuery] = useState("");
  const [instruction, setInstruction] = useState("");
  const [highlight, setHighlight] = useState(0);
  const verbInputRef = useRef<HTMLInputElement | null>(null);

  // Only human verbs land in Cmd-K; agent verbs are exposed via the agent
  // MCP path (slice 6).
  const humanVerbs = useMemo(() => (catalog ? catalog.human.map((v) => v.name) : []), [catalog]);

  const filtered = useMemo(() => {
    const q = verbQuery.trim().toLowerCase();
    if (!q) return humanVerbs;
    return humanVerbs.filter((v) => v.toLowerCase().includes(q));
  }, [humanVerbs, verbQuery]);

  useEffect(() => {
    verbInputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlight(0);
  }, []);

  const submit = (verb: string) => {
    if (!verb) return;
    onSubmit(verb, instruction);
  };

  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="cmdk-popover"
        style={{ top: anchor.top, left: anchor.left }}
        role="dialog"
        aria-label="Create mention"
      >
        <div className="cmdk-row">
          <input
            ref={verbInputRef}
            className="cmdk-input"
            placeholder="verb (e.g. rephrase, factcheck)"
            value={verbQuery}
            onChange={(e) => setVerbQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(filtered.length - 1, h + 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const chosen =
                  filtered[highlight] ??
                  (verbQuery.trim().length > 0 ? verbQuery.trim() : humanVerbs[0]);
                if (chosen) submit(chosen);
              }
            }}
          />
        </div>
        <ul className="cmdk-list">
          {filtered.length === 0 && verbQuery.trim() !== "" && (
            <li className="cmdk-empty">
              No matching verb. Press Enter to use "{verbQuery.trim()}" anyway (will default to
              annotation mode at resolve time).
            </li>
          )}
          {filtered.slice(0, 8).map((v, i) => (
            <li
              key={v}
              className={`cmdk-item${i === highlight ? " is-highlighted" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(v);
              }}
            >
              {v}
            </li>
          ))}
        </ul>
        <div className="cmdk-row">
          <textarea
            className="cmdk-instruction"
            placeholder="instruction (optional)"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const chosen =
                  filtered[highlight] ??
                  (verbQuery.trim().length > 0 ? verbQuery.trim() : humanVerbs[0]);
                if (chosen) submit(chosen);
              }
            }}
            rows={2}
          />
        </div>
        <div className="cmdk-hint">
          enter inserts the marker. Cmd-Enter from the instruction field also submits. esc cancels.
        </div>
      </div>
    </div>
  );
}
