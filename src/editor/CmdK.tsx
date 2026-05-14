import { useEffect, useMemo, useRef, useState } from "react";
import type { VerbCatalogSnapshot } from "../shared/protocol.ts";

// Cmd-K mention/annotation creation popover.
//
// Spec: Editor (V1) — "Cmd-K mention/annotation creation. Inline popover
// anchored to the selection. Verb autocomplete from the configured set.
// Sidebar inserts the begin/end pair with a generated id and renders the
// decoration immediately."
//
// Slice 5 extends the popover with a mode toggle: "mention" keeps the
// slice-4 verb-autocomplete flow; "note" and "suggestion" create
// annotations. Suggestion mode adds a second textarea for the proposed
// replacement text. The mode toggle is in the top row so the rest of the
// popover layout stays familiar.

export type CmdKAnchor = {
  /** Viewport-relative coordinates near the editor's selection. */
  top: number;
  left: number;
};

export type CmdKMode = "mention" | "note" | "suggestion";

export type CmdKSubmit =
  | { mode: "mention"; verb: string; instruction: string }
  | { mode: "note"; content: string }
  | { mode: "suggestion"; content: string };

export type CmdKProps = {
  catalog: VerbCatalogSnapshot | null;
  anchor: CmdKAnchor;
  onCancel: () => void;
  onSubmit: (payload: CmdKSubmit) => void;
};

export function CmdK({ catalog, anchor, onCancel, onSubmit }: CmdKProps) {
  const [mode, setMode] = useState<CmdKMode>("mention");
  const [verbQuery, setVerbQuery] = useState("");
  const [instruction, setInstruction] = useState("");
  const [annotationContent, setAnnotationContent] = useState("");
  const [highlight, setHighlight] = useState(0);
  const verbInputRef = useRef<HTMLInputElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  // Only human verbs land in Cmd-K; agent verbs are exposed via the agent
  // MCP path (slice 6).
  const humanVerbs = useMemo(() => (catalog ? catalog.human.map((v) => v.name) : []), [catalog]);

  const filtered = useMemo(() => {
    const q = verbQuery.trim().toLowerCase();
    if (!q) return humanVerbs;
    return humanVerbs.filter((v) => v.toLowerCase().includes(q));
  }, [humanVerbs, verbQuery]);

  useEffect(() => {
    if (mode === "mention") verbInputRef.current?.focus();
    else noteRef.current?.focus();
  }, [mode]);

  const submitMention = (verb: string) => {
    if (!verb) return;
    onSubmit({ mode: "mention", verb, instruction });
  };
  const submitAnnotation = () => {
    if (annotationContent.trim() === "") return;
    onSubmit(
      mode === "note"
        ? { mode: "note", content: annotationContent }
        : { mode: "suggestion", content: annotationContent },
    );
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
        aria-label="Create mention or annotation"
      >
        <div className="cmdk-mode-row" role="tablist" aria-label="Marker type">
          {(["mention", "note", "suggestion"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`cmdk-mode${mode === m ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setMode(m);
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "mention" && (
          <>
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
                    if (chosen) submitMention(chosen);
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
                    submitMention(v);
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
                    if (chosen) submitMention(chosen);
                  }
                }}
                rows={2}
              />
            </div>
            <div className="cmdk-hint">
              enter inserts the mention. Cmd-Enter from the instruction field also submits. esc
              cancels.
            </div>
          </>
        )}

        {mode === "note" && (
          <>
            <div className="cmdk-row">
              <textarea
                ref={noteRef}
                className="cmdk-instruction"
                placeholder="note (markdown)"
                value={annotationContent}
                onChange={(e) => setAnnotationContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitAnnotation();
                  }
                }}
                rows={3}
              />
            </div>
            <div className="cmdk-hint">
              the note attaches to the selected region. Cmd-Enter submits. esc cancels.
            </div>
          </>
        )}

        {mode === "suggestion" && (
          <>
            <div className="cmdk-row">
              <textarea
                ref={noteRef}
                className="cmdk-instruction"
                placeholder="proposed replacement text (markdown, replaces the region verbatim on accept)"
                value={annotationContent}
                onChange={(e) => setAnnotationContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitAnnotation();
                  }
                }}
                rows={4}
              />
            </div>
            <div className="cmdk-hint">
              the suggestion proposes a verbatim replacement. The human accepts or rejects in the
              side card. Cmd-Enter submits. esc cancels.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
