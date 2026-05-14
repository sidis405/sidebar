import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { languages as fenceLanguages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useMemo, useRef } from "react";
import { type Annotation, parseAnnotations } from "../shared/markers.ts";
import { markdownLivePreview } from "./markdown-live-preview.ts";

// Slice 5: side-card rendering for annotations.
//
// Spec: Editor (V1) — "Editor renders annotations as side cards anchored to
// the target region; suggestion side cards show Accept and Reject buttons.
// Annotation content is rendered in the side card by the same CodeMirror 6
// live-preview pipeline as the doc body."
//
// We parse the disk content (not the dirty buffer) because annotation
// authorship and target-region addressing only make sense relative to what
// the file currently is on disk; the agent reads the same on-disk view.
// Each card mounts a read-only CodeMirror view with the same live-preview
// pipeline as the main editor, so a suggestion's proposed markdown shows up
// rendered the way it would after acceptance.

const cardHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.2em", fontWeight: "bold" },
  { tag: t.heading2, fontSize: "1.1em", fontWeight: "bold" },
  { tag: t.heading3, fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#3478f6", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "ui-monospace, Menlo, monospace" },
]);

export type AnnotationCardsProps = {
  /** Latest on-disk content for the currently open file. */
  source: string;
  /** Currently open file path (used as a key so cards re-render on switch). */
  file: string;
  onAccept: (annotationId: string) => void;
  onReject: (annotationId: string) => void;
  onRemove: (annotationId: string) => void;
};

export function AnnotationCards({
  source,
  file,
  onAccept,
  onReject,
  onRemove,
}: AnnotationCardsProps) {
  const annotations = useMemo(() => parseAnnotations(source), [source]);
  if (annotations.length === 0) {
    return <aside className="annotation-cards is-empty" aria-label={`Annotations for ${file}`} />;
  }
  return (
    <aside className="annotation-cards" aria-label={`Annotations for ${file}`}>
      {annotations.map((a) => (
        <AnnotationCard
          key={a.id}
          annotation={a}
          onAccept={onAccept}
          onReject={onReject}
          onRemove={onRemove}
        />
      ))}
    </aside>
  );
}

function AnnotationCard({
  annotation,
  onAccept,
  onReject,
  onRemove,
}: {
  annotation: Annotation;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const cmHost = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!cmHost.current) return;
    const state = EditorState.create({
      doc: annotation.content,
      extensions: [
        EditorState.readOnly.of(true),
        markdown({ base: markdownLanguage, codeLanguages: fenceLanguages }),
        syntaxHighlighting(defaultHighlightStyle),
        syntaxHighlighting(cardHighlight),
        markdownLivePreview,
        EditorView.lineWrapping,
        EditorView.editable.of(false),
      ],
    });
    const view = new EditorView({ state, parent: cmHost.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [annotation.content]);

  return (
    <article
      className={`annotation-card annotation-card-${annotation.type}`}
      data-annotation-id={annotation.id}
      data-begin-line={annotation.beginLineNumber}
    >
      <header className="annotation-card-header">
        <code className="annotation-card-id">{annotation.id}</code>
        <span className="annotation-card-type">{annotation.type}</span>
        <span className="annotation-card-author">{annotation.author}</span>
        <span className="annotation-card-anchor">line {annotation.beginLineNumber}</span>
      </header>
      <div className="annotation-card-body" ref={cmHost} />
      <footer className="annotation-card-footer">
        {annotation.type === "suggestion" ? (
          <>
            <button
              type="button"
              className="annotation-card-accept"
              onClick={() => onAccept(annotation.id)}
            >
              Accept
            </button>
            <button
              type="button"
              className="annotation-card-reject"
              onClick={() => onReject(annotation.id)}
            >
              Reject
            </button>
          </>
        ) : (
          <button
            type="button"
            className="annotation-card-remove"
            onClick={() => onRemove(annotation.id)}
          >
            Remove
          </button>
        )}
      </footer>
    </article>
  );
}
