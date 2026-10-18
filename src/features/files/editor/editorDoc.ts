import { diff } from "@codemirror/merge";
import type { Annotation, ChangeSpec, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  decodeLineEndings,
  encodeLineEndings,
  type LineEnding,
} from "../../sessions/model/lineEndings";

const DOC_DIFF = { scanLimit: 5_000, timeout: 100 };

/**
 * CodeMirror documents are LF-only: `EditorView({ doc })` splits on any line
 * break. Anything diffed against or inserted into a document must match, or a
 * lone `\r` insert (CRLF disk content vs. an LF document) becomes an extra
 * line break, doubling every line.
 */
export function normalizeLineBreaks(value: string): string {
  return value.includes("\r") ? value.replace(/\r\n?/g, "\n") : value;
}

export type { LineEnding } from "../../sessions/model/lineEndings";

/** The convention a file used before normalization; mixed files report the
 * first flavor matched (CRLF wins over lone CR). */
export function detectLineEnding(value: string): LineEnding {
  return value.includes("\r\n") ? "\r\n" : value.includes("\r") ? "\r" : "\n";
}

/** Re-apply a file's own line-ending convention to LF document text. */
export function restoreLineEnding(value: string, eol: LineEnding): string {
  return eol === "\n" ? value : value.replace(/\n/g, eol);
}

export function editorDocChanges(from: string, to: string): ChangeSpec[] {
  const target = normalizeLineBreaks(to);
  if (from === target) return [];
  return diff(from, target, DOC_DIFF).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: target.slice(change.fromB, change.toB),
  }));
}

export function replaceEditorDoc(
  view: EditorView,
  next: string,
  options?: {
    selection?: { anchor: number; head?: number };
    annotations?: readonly Annotation<unknown>[];
  },
): boolean {
  const prev = view.state.doc.toString();
  const target = normalizeLineBreaks(next);
  if (prev === target) return false;
  const changes = editorDocChanges(prev, target);
  view.dispatch({
    changes:
      changes.length > 0
        ? changes
        : { from: 0, to: view.state.doc.length, insert: target },
    selection: options?.selection,
    annotations: options?.annotations,
    scrollIntoView: false,
    effects: view.scrollSnapshot(),
  });
  return true;
}

/** Keep the caret at the same screen position across a layout-changing update. */
export function preserveEditorViewport(view: EditorView, mutate: () => void) {
  const head = view.state.selection.main.head;
  const before = view.coordsAtPos(head);
  const scroller = view.scrollDOM;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const offsetY = before ? before.top - scrollerTop : null;
  const scrollTop = scroller.scrollTop;
  const scrollLeft = scroller.scrollLeft;

  mutate();

  const restore = () => {
    if (!view.dom.isConnected) return;
    if (offsetY == null) {
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = scrollLeft;
      return;
    }
    const after = view.coordsAtPos(view.state.selection.main.head);
    if (!after) return;
    scroller.scrollTop +=
      after.top - scroller.getBoundingClientRect().top - offsetY;
  };
  restore();
  view.requestMeasure({
    key: preserveEditorViewport,
    read: () => {
      if (!view.dom.isConnected || offsetY == null) return null;
      const after = view.coordsAtPos(view.state.selection.main.head);
      return after
        ? after.top - scroller.getBoundingClientRect().top - offsetY
        : null;
    },
    write: (shift) => {
      if (!view.dom.isConnected) return;
      if (offsetY == null) {
        scroller.scrollTop = scrollTop;
        scroller.scrollLeft = scrollLeft;
      } else if (shift != null) scroller.scrollTop += shift;
    },
  });
}

export type EditorDiskSession = {
  applyDiskContent(rawContent: string): {
    text: string;
    lineEnding: LineEnding;
  };
  serializeForSave(canonicalText: string): string;
  serializeForStage(canonicalText: string): string;
};

/**
 * Encapsulate the external line-ending lifecycle for an open editor session.
 * Decodes raw disk text to canonical LF on load, remembers the external
 * convention, and serializes save/stage payloads back to that convention.
 */
export function createEditorDiskSession(
  initialLineEnding: LineEnding = "\n",
): EditorDiskSession {
  let currentEnding: LineEnding = initialLineEnding;
  return {
    applyDiskContent(rawContent: string): {
      text: string;
      lineEnding: LineEnding;
    } {
      const decoded = decodeLineEndings(rawContent);
      currentEnding = decoded.lineEnding;
      return decoded;
    },
    serializeForSave(canonicalText: string): string {
      return encodeLineEndings(canonicalText, currentEnding);
    },
    serializeForStage(canonicalText: string): string {
      return encodeLineEndings(canonicalText, currentEnding);
    },
  };
}

export function isDocDirty(current: Text, saved: Text | null): boolean {
  return saved ? !current.eq(saved) : false;
}
