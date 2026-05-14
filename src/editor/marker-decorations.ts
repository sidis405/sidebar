import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { parseMarkers } from "../shared/markers.ts";

// CodeMirror decorations for sidebar markers (slice 4 focus: mentions).
//
// Spec: Editor (V1) — "Marker syntax (HTML comments) hidden by decoration
// and rendered as gutter bars, side cards, and verb pills."
//
// Slice 4 ships the minimum: dim the begin/end marker lines so the raw HTML
// comments are visually de-emphasized, render a verb pill at the end of the
// begin line, and surface a red gutter on malformed/orphaned markers. Slice 5
// (annotations) reuses the same plumbing for note/suggestion markers.

const beginLineDeco = Decoration.line({ class: "cm-sidebar-marker cm-sidebar-marker-begin" });
const endLineDeco = Decoration.line({ class: "cm-sidebar-marker cm-sidebar-marker-end" });
const malformedLineDeco = Decoration.line({ class: "cm-sidebar-marker-malformed" });
const orphanBeginDeco = Decoration.line({
  class: "cm-sidebar-marker cm-sidebar-marker-begin cm-sidebar-marker-orphan",
});

class VerbPillWidget extends WidgetType {
  constructor(
    readonly verb: string,
    readonly author: string,
    readonly orphan: boolean,
  ) {
    super();
  }
  override eq(other: VerbPillWidget): boolean {
    return other.verb === this.verb && other.author === this.author && other.orphan === this.orphan;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `cm-verb-pill${this.orphan ? " cm-verb-pill-orphan" : ""}`;
    el.textContent = `${this.verb} · ${this.author}${this.orphan ? " (orphan)" : ""}`;
    return el;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();
  const parsed = parseMarkers(doc);
  const builder = new RangeSetBuilder<Decoration>();

  // Build a flat, sorted list of (offset, deco) entries so RangeSetBuilder
  // gets them in order. CodeMirror requires strictly ascending starts.
  type Entry = { from: number; deco: Decoration };
  const entries: Entry[] = [];

  for (const m of parsed.mentions) {
    const beginDeco = m.orphan ? orphanBeginDeco : beginLineDeco;
    entries.push({ from: m.beginLineStart, deco: beginDeco });
    // Verb pill at the start of the begin line (CodeMirror line widget).
    entries.push({
      from: m.beginLineStart,
      deco: Decoration.widget({
        widget: new VerbPillWidget(m.verb, m.author, m.orphan),
        side: -1,
      }),
    });
    entries.push({ from: m.endLineStart, deco: endLineDeco });
  }
  for (const range of parsed.malformedRanges) {
    entries.push({ from: range.start, deco: malformedLineDeco });
  }

  entries.sort((a, b) => a.from - b.from);
  for (const e of entries) builder.add(e.from, e.from, e.deco);
  return builder.finish();
}

export const sidebarMarkerDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
