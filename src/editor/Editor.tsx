import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages as fenceLanguages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { markdownLivePreview } from "./markdown-live-preview.ts";
import { sidebarMarkerDecorations } from "./marker-decorations.ts";

const markdownVisuals = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "bold" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "bold" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "bold" },
  { tag: t.heading4, fontSize: "1.05em", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#3478f6", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "ui-monospace, Menlo, monospace" },
]);

export type EditorProps = {
  value: string;
  onChange: (v: string) => void;
  onSaveRequest: () => void;
  onCmdK: (selection: {
    startOffset: number;
    endOffset: number;
    anchor: { top: number; left: number };
  }) => void;
  readOnly?: boolean;
};

export function Editor({ value, onChange, onSaveRequest, onCmdK, readOnly }: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSaveRequest);
  const onCmdKRef = useRef(onCmdK);
  onChangeRef.current = onChange;
  onSaveRef.current = onSaveRequest;
  onCmdKRef.current = onCmdK;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        lineNumbers(),
        drawSelection(),
        bracketMatching(),
        highlightActiveLine(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          {
            key: "Mod-k",
            preventDefault: true,
            run: (view) => {
              const sel = view.state.selection.main;
              const coords = view.coordsAtPos(sel.from) ?? { left: 0, top: 0 };
              onCmdKRef.current({
                startOffset: sel.from,
                endOffset: sel.to,
                anchor: { top: coords.top + 22, left: coords.left },
              });
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        // Lazy-loaded grammars for fenced code blocks. Each language package
        // imports on first encounter so the SPA stays small until a doc
        // actually uses it.
        markdown({ base: markdownLanguage, codeLanguages: fenceLanguages }),
        syntaxHighlighting(defaultHighlightStyle),
        syntaxHighlighting(markdownVisuals),
        markdownLivePreview,
        sidebarMarkerDecorations,
        EditorView.lineWrapping,
        EditorState.readOnly.of(!!readOnly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (file open, take-theirs) without losing
  // local user edits between renders.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="cm-host" ref={hostRef} />;
}
