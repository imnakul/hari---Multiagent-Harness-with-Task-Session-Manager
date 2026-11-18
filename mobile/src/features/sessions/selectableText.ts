import { inlinePlain, parseMarkdown, type Inline, type MarkdownBlock } from "./markdownParser";

/** A run of a reply's plain text; code shows in monospace. */
export type TextRun = { text: string; code: boolean };

/**
 * Fork (Hari, L-351): a reply as one selectable page's text. Markdown markers
 * go (bold, links' brackets, fences); list markers and table cells stay as
 * plain text, and code keeps its own runs so it can show in monospace.
 * Neighbouring runs of one kind join, so the page has as few pieces as it can.
 */
export function selectableRuns(source: string): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, code: boolean) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.code === code) last.text += text;
    else runs.push({ text, code });
  };
  const inline = (parts: Inline[]) => {
    for (const part of parts) {
      if (part.type === "code") push(part.text, true);
      else if ("children" in part) inline(part.children);
      else push(part.text, false);
    }
  };
  const block = (item: MarkdownBlock, indent: string) => {
    switch (item.type) {
      case "paragraph":
      case "heading":
        push(indent, false);
        inline(item.inline);
        return;
      case "code":
        push(item.text.replace(/\n$/, ""), true);
        return;
      case "list":
        item.items.forEach((entry, index) => {
          if (index > 0) push("\n", false);
          push(`${indent}${item.ordered ? `${item.start + index}.` : "•"} `, false);
          entry.forEach((child, at) => {
            if (at > 0) push("\n", false);
            block(child, at > 0 ? `${indent}   ` : "");
          });
        });
        return;
      case "quote":
        blocks(item.children, `${indent}  `);
        return;
      case "table":
        push(
          item.rows.map((row) => `${indent}${row.map((cell) => inlinePlain(cell).trim()).join("  |  ")}`).join("\n"),
          false,
        );
        return;
      case "rule":
        push(`${indent}———`, false);
        return;
    }
  };
  const blocks = (items: MarkdownBlock[], indent: string) =>
    items.forEach((item, index) => {
      if (index > 0) push("\n\n", false);
      block(item, indent);
    });
  blocks(parseMarkdown(source), "");
  return runs;
}
