import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Markdown syntax tokens that should disappear on non-cursor lines so the
// reader sees rendered formatting instead of the raw characters. The list is
// drawn from the @lezer/markdown node names.
const SYNTAX_NODES = new Set<string>([
  "HeaderMark",
  "EmphasisMark",
  "StrongEmphasisMark",
  "LinkMark",
  "URL",
  "CodeMark",
  "ListMark",
  "QuoteMark",
  "TaskMarker",
  "StrikethroughMark",
]);

const syntaxDeco = Decoration.mark({ class: "cm-md-syntax" });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (SYNTAX_NODES.has(node.name)) {
          if (node.to > node.from) {
            builder.add(node.from, node.to, syntaxDeco);
          }
        }
      },
    });
  }
  return builder.finish();
}

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
