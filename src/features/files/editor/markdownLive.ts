import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Obsidian-style live Markdown for CodeMirror: the text stays plain Markdown,
 * but headings, emphasis, links, lists, task boxes, quotes and rules are shown
 * formatted, and their syntax characters (`#`, `**`, `[]()`, `- [ ]`…) are
 * hidden except on the lines the caret or selection is on.
 *
 * `collectLiveSpecs` is pure (state in, plain specs out) so the rules are unit
 * tested; the view plugin only turns specs into decorations.
 */

/** One formatting instruction for a range of the document. */
export type LiveSpec =
  | { kind: "hide"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; className: string; url?: string }
  | { kind: "line"; at: number; className: string }
  | { kind: "bullet"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean }
  | { kind: "rule"; from: number; to: number }
  | { kind: "image"; from: number; to: number; url: string; alt: string };

export type MarkdownLiveOptions = {
  /** Image URL → displayable src, or null to keep the Markdown text. */
  resolveImage?: (url: string) => Promise<string | null> | string | null;
  /** Opens a link the user Ctrl/Cmd+clicked. */
  openLink?: (url: string) => void;
};

const BULLET_MARKS = new Set(["-", "*", "+"]);
const LINKED_URL_PARENTS = new Set(["Link", "Image", "Autolink"]);
const SYNTAX = "cm-live-syntax";

/**
 * Formatting for the parsed Markdown in `ranges`. Syntax on `activeLines`
 * (1-based) stays visible so it can be edited.
 */
export function collectLiveSpecs(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  activeLines: ReadonlySet<number>,
): LiveSpec[] {
  const doc = state.doc;
  const specs: LiveSpec[] = [];
  const lineNumber = (pos: number): number => doc.lineAt(pos).number;
  const isActive = (from: number, to: number = from): boolean => {
    const last = lineNumber(to);
    for (let line = lineNumber(from); line <= last; line += 1)
      if (activeLines.has(line)) return true;
    return false;
  };
  const text = (from: number, to: number): string => doc.sliceString(from, to);
  const eachLine = (from: number, to: number, className: string): void => {
    const last = lineNumber(to);
    for (let line = lineNumber(from); line <= last; line += 1)
      specs.push({ kind: "line", at: doc.line(line).from, className });
  };
  /** Hides a leading mark and the spaces after it, up to the line end. */
  const hideLeading = (from: number, to: number): void => {
    const lineEnd = doc.lineAt(from).to;
    let end = to;
    while (end < lineEnd && text(end, end + 1) === " ") end += 1;
    specs.push({ kind: "hide", from, to: end });
  };
  /** Hides a trailing mark (closing `##`) and the spaces before it. */
  const hideTrailing = (from: number, to: number): void => {
    const lineStart = doc.lineAt(from).from;
    let start = from;
    while (start > lineStart && text(start - 1, start) === " ") start -= 1;
    specs.push({ kind: "hide", from: start, to });
  };

  const visit = (node: SyntaxNode): boolean | void => {
    const { from, to, name } = node;
    const heading = /^(ATX|Setext)Heading(\d)$/.exec(name);
    if (heading) {
      specs.push({
        kind: "line",
        at: doc.lineAt(from).from,
        className: `cm-live-h${heading[2]}`,
      });
      return;
    }
    switch (name) {
      case "HeaderMark": {
        if (node.parent?.name.startsWith("Setext")) {
          specs.push({ kind: "mark", from, to, className: SYNTAX });
        } else if (!isActive(from)) {
          if (from === doc.lineAt(from).from) hideLeading(from, to);
          else hideTrailing(from, to);
        }
        return;
      }
      case "Emphasis":
        specs.push({ kind: "mark", from, to, className: "cm-live-em" });
        return;
      case "StrongEmphasis":
        specs.push({ kind: "mark", from, to, className: "cm-live-strong" });
        return;
      case "Strikethrough":
        specs.push({ kind: "mark", from, to, className: "cm-live-strike" });
        return;
      case "InlineCode":
        specs.push({ kind: "mark", from, to, className: "cm-live-code" });
        return;
      case "EmphasisMark":
      case "StrikethroughMark":
      case "CodeMark": {
        if (isActive(from)) specs.push({ kind: "mark", from, to, className: SYNTAX });
        else specs.push({ kind: "hide", from, to });
        return;
      }
      case "FencedCode":
      case "CodeBlock": {
        eachLine(from, to, "cm-live-codeblock");
        if (name === "FencedCode") {
          specs.push({ kind: "line", at: doc.lineAt(from).from, className: "cm-live-fence" });
          const closing = doc.lineAt(to);
          if (closing.number !== lineNumber(from) && /^\s*(```|~~~)/.test(closing.text))
            specs.push({ kind: "line", at: closing.from, className: "cm-live-fence" });
        }
        // Nothing inside a code block is Markdown.
        return false;
      }
      case "Link": {
        const marks = node.getChildren("LinkMark");
        const url = node.getChild("URL");
        const open = marks[0];
        const close = marks[1];
        if (!open || !close) return;
        specs.push({
          kind: "mark",
          from: open.to,
          to: close.from,
          className: "cm-live-link",
          url: url ? text(url.from, url.to) : undefined,
        });
        if (!isActive(from, to)) {
          specs.push({ kind: "hide", from: open.from, to: open.to });
          specs.push({ kind: "hide", from: close.from, to: url ? to : close.to });
        }
        return;
      }
      case "Autolink": {
        const url = node.getChild("URL");
        if (url)
          specs.push({
            kind: "mark",
            from: url.from,
            to: url.to,
            className: "cm-live-link",
            url: text(url.from, url.to),
          });
        if (!isActive(from, to))
          for (const mark of node.getChildren("LinkMark"))
            specs.push({ kind: "hide", from: mark.from, to: mark.to });
        return false;
      }
      case "URL": {
        if (node.parent && LINKED_URL_PARENTS.has(node.parent.name)) return;
        specs.push({
          kind: "mark",
          from,
          to,
          className: "cm-live-link",
          url: text(from, to),
        });
        return;
      }
      case "Image": {
        const url = node.getChild("URL");
        const marks = node.getChildren("LinkMark");
        if (url && marks[0] && marks[1] && !isActive(from, to)) {
          specs.push({
            kind: "image",
            from,
            to,
            url: text(url.from, url.to),
            alt: text(marks[0].to, marks[1].from),
          });
        } else {
          specs.push({ kind: "mark", from, to, className: SYNTAX });
        }
        return false;
      }
      case "ListMark": {
        const mark = text(from, to);
        const hasTask = !!node.parent?.getChild("Task");
        if (isActive(from)) {
          specs.push({ kind: "mark", from, to, className: "cm-live-list-mark" });
        } else if (hasTask) {
          hideLeading(from, to);
        } else if (BULLET_MARKS.has(mark)) {
          specs.push({ kind: "bullet", from, to });
        } else {
          specs.push({ kind: "mark", from, to, className: "cm-live-list-mark" });
        }
        return;
      }
      case "TaskMarker": {
        const checked = /x/i.test(text(from, to));
        if (!isActive(from)) specs.push({ kind: "task", from, to, checked });
        const task = node.parent;
        if (checked && task && task.to > to)
          specs.push({ kind: "mark", from: to, to: task.to, className: "cm-live-task-done" });
        return;
      }
      case "Blockquote":
        eachLine(from, to, "cm-live-quote");
        return;
      case "QuoteMark":
        if (isActive(from)) specs.push({ kind: "mark", from, to, className: SYNTAX });
        else hideLeading(from, to);
        return;
      case "HorizontalRule":
        if (isActive(from)) specs.push({ kind: "mark", from, to, className: SYNTAX });
        else specs.push({ kind: "rule", from, to });
        return;
      case "Table":
        eachLine(from, to, "cm-live-table");
        return;
      case "TableDelimiter":
        specs.push({ kind: "mark", from, to, className: SYNTAX });
        return;
      default:
        return;
    }
  };

  const tree = syntaxTree(state);
  for (const range of ranges)
    tree.iterate({ from: range.from, to: range.to, enter: (ref) => visit(ref.node) });
  return dedupe(specs);
}

/** Drops repeats (nodes seen from two visible ranges). */
function dedupe(specs: LiveSpec[]): LiveSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = JSON.stringify(spec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 1-based lines touched by the selection; none while the editor is blurred. */
export function activeLinesFor(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let line = state.doc.lineAt(range.from).number; line <= last; line += 1)
      lines.add(line);
  }
  return lines;
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-live-bullet";
    bullet.textContent = "•";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-live-task";
    box.setAttribute("aria-label", this.checked ? "Mark as not done" : "Mark as done");
    box.disabled = view.state.readOnly;
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", (event) => {
      event.preventDefault();
      if (view.state.readOnly) return;
      // Position read at click time: the widget can outlive edits before it.
      const pos = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(marker)) return;
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" },
        userEvent: "input.toggle",
      });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-live-rule";
    rule.setAttribute("role", "separator");
    return rule;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly resolve: MarkdownLiveOptions["resolveImage"],
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const frame = document.createElement("span");
    frame.className = "cm-live-image";
    const fallback = (): void => {
      frame.replaceChildren();
      frame.className = "cm-live-image cm-live-image-missing";
      frame.textContent = this.alt || this.url;
    };
    const show = (src: string | null): void => {
      if (!src) return fallback();
      const image = document.createElement("img");
      image.src = src;
      image.alt = this.alt;
      image.draggable = false;
      image.addEventListener("error", fallback);
      frame.replaceChildren(image);
    };
    try {
      const result = this.resolve?.(this.url) ?? null;
      if (result instanceof Promise) {
        frame.textContent = this.alt || "Image";
        result.then(show, fallback);
      } else {
        show(result);
      }
    } catch {
      fallback();
    }
    return frame;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const bulletWidget = Decoration.replace({ widget: new BulletWidget() });
const ruleWidget = Decoration.replace({ widget: new RuleWidget() });
const hidden = Decoration.replace({});

function toDecorations(
  specs: readonly LiveSpec[],
  options: MarkdownLiveOptions,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  // Replacements must not overlap; keep the first of any overlapping pair.
  const replaced: { from: number; to: number }[] = [];
  const replace = (from: number, to: number, decoration: Decoration): void => {
    if (to <= from) return;
    if (replaced.some((range) => from < range.to && to > range.from)) return;
    replaced.push({ from, to });
    ranges.push(decoration.range(from, to));
  };
  const ordered = [...specs].sort(
    (a, b) => ("from" in a ? a.from : a.at) - ("from" in b ? b.from : b.at),
  );
  for (const spec of ordered) {
    switch (spec.kind) {
      case "line":
        ranges.push(Decoration.line({ class: spec.className }).range(spec.at));
        break;
      case "mark":
        if (spec.to > spec.from)
          ranges.push(
            Decoration.mark({
              class: spec.className,
              attributes: spec.url
                ? { "data-live-url": spec.url, title: `${spec.url} (Ctrl/Cmd+click to open)` }
                : undefined,
            }).range(spec.from, spec.to),
          );
        break;
      case "hide":
        replace(spec.from, spec.to, hidden);
        break;
      case "bullet":
        replace(spec.from, spec.to, bulletWidget);
        break;
      case "rule":
        replace(spec.from, spec.to, ruleWidget);
        break;
      case "task":
        replace(
          spec.from,
          spec.to,
          Decoration.replace({ widget: new TaskWidget(spec.checked) }),
        );
        break;
      case "image":
        replace(
          spec.from,
          spec.to,
          Decoration.replace({
            widget: new ImageWidget(spec.url, spec.alt, options.resolveImage),
          }),
        );
        break;
    }
  }
  return Decoration.set(ranges, true);
}

function livePlugin(options: MarkdownLiveOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.focusChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        )
          this.decorations = this.build(update.view);
      }
      build(view: EditorView): DecorationSet {
        const specs = collectLiveSpecs(
          view.state,
          view.visibleRanges,
          activeLinesFor(view.state, view.hasFocus),
        );
        return toDecorations(specs, options);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const accent = "var(--user-accent-color, var(--color-accent))";
const tint = (percent: number): string =>
  `color-mix(in srgb, var(--color-content) ${percent}%, transparent)`;

/** Typography for live Markdown; CSS-in-JS because CodeMirror owns this DOM. */
const liveTheme = EditorView.theme({
  "&.cm-live-doc .cm-content": {
    fontFamily: "var(--font-sans)",
    fontSize: "14px",
    lineHeight: "1.65",
  },
  ".cm-live-h1": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.35" },
  ".cm-live-h2": { fontSize: "1.35em", fontWeight: "650", lineHeight: "1.4" },
  ".cm-live-h3": { fontSize: "1.18em", fontWeight: "600" },
  ".cm-live-h4, .cm-live-h5, .cm-live-h6": { fontWeight: "600" },
  ".cm-live-strong": { fontWeight: "700" },
  ".cm-live-em": { fontStyle: "italic" },
  ".cm-live-strike": { textDecoration: "line-through", color: tint(55) },
  ".cm-live-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: tint(9),
    borderRadius: "4px",
    padding: "0 3px",
  },
  ".cm-live-link": {
    color: accent,
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "text",
  },
  ".cm-live-syntax": { color: tint(40) },
  ".cm-live-list-mark": { color: tint(55) },
  ".cm-live-bullet": {
    display: "inline-block",
    width: "1ch",
    color: tint(60),
    textAlign: "center",
  },
  ".cm-live-task": {
    margin: "0 0.35em 0 0",
    verticalAlign: "-2px",
    accentColor: accent,
    cursor: "pointer",
  },
  ".cm-live-task-done": { color: tint(50), textDecoration: "line-through" },
  ".cm-line.cm-live-quote": {
    borderLeft: `2px solid ${tint(25)}`,
    paddingLeft: "10px",
    color: tint(75),
  },
  ".cm-line.cm-live-codeblock": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    backgroundColor: tint(6),
    paddingLeft: "10px",
  },
  ".cm-line.cm-live-fence": { color: tint(40) },
  ".cm-line.cm-live-table": { fontFamily: "var(--font-mono)", fontSize: "0.9em" },
  ".cm-live-rule": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
    borderTop: `1px solid ${tint(20)}`,
  },
  ".cm-live-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "320px",
    borderRadius: "6px",
    margin: "4px 0",
  },
  ".cm-live-image-missing": {
    color: tint(50),
    fontStyle: "italic",
  },
});

/** Ctrl/Cmd+click on a link opens it; a plain click keeps editing. */
function linkClicks(options: MarkdownLiveOptions): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      if (!options.openLink || !(event.ctrlKey || event.metaKey)) return false;
      const target = event.target;
      if (!(target instanceof Element)) return false;
      const url = target.closest("[data-live-url]")?.getAttribute("data-live-url");
      if (!url) return false;
      event.preventDefault();
      options.openLink(url);
      return true;
    },
  });
}

/** Live Markdown formatting. Needs a Markdown language (GFM base) loaded. */
export function markdownLive(options: MarkdownLiveOptions = {}): Extension {
  return [
    livePlugin(options),
    liveTheme,
    linkClicks(options),
    EditorView.editorAttributes.of({ class: "cm-live-doc" }),
  ];
}
