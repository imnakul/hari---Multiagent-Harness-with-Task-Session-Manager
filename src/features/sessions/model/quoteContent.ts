/**
 * The text of a rendered quote, read from its Markdown source tree (hast) so
 * renderer controls, labels and fade spans never end up in it (fork, L-188).
 * Keeps the quote's own structure: paragraphs, lists, code fences, nested
 * quotes. The outer quote's own `>` markers are left off.
 */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const BLOCK_TAGS = new Set([
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

export function quoteText(node: unknown): string {
  if (!isNode(node)) return "";
  return blocks(node.children ?? []).join("\n\n").trim();
}

function isNode(value: unknown): value is HastNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HastNode).type === "string"
  );
}

function isBlock(node: HastNode): boolean {
  return node.type === "element" && BLOCK_TAGS.has(node.tagName ?? "");
}

function blocks(children: HastNode[]): string[] {
  const out: string[] = [];
  let inline: HastNode[] = [];
  const flush = () => {
    const text = inlineText(inline).trim();
    if (text) out.push(text);
    inline = [];
  };
  for (const child of children) {
    if (!isBlock(child)) {
      inline.push(child);
      continue;
    }
    flush();
    const text = block(child);
    if (text) out.push(text);
  }
  flush();
  return out;
}

function block(node: HastNode): string {
  const children = node.children ?? [];
  const tag = node.tagName ?? "";
  if (/^h[1-6]$/.test(tag))
    return `${"#".repeat(Number(tag[1]))} ${inlineText(children).trim()}`;
  if (tag === "p") return inlineText(children).trim();
  if (tag === "hr") return "---";
  if (tag === "pre") {
    const code = children.find((child) => child.tagName === "code") ?? node;
    const language = codeLanguage(code);
    const text = plainText(code).replace(/\r?\n$/, "");
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }
  if (tag === "ul" || tag === "ol") {
    let index = Number(node.properties?.start ?? 1) || 1;
    return children
      .filter((child) => child.tagName === "li")
      .map((item) => {
        const marker = tag === "ol" ? `${index++}. ` : "- ";
        const body = blocks(item.children ?? []).join("\n\n");
        return marker + indent(body, " ".repeat(marker.length));
      })
      .join("\n");
  }
  if (tag === "blockquote")
    return blocks(children)
      .join("\n\n")
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  if (tag === "table")
    return rows(node)
      .map((cells) => `| ${cells.join(" | ")} |`)
      .join("\n");
  return blocks(children).join("\n\n");
}

function inlineText(children: HastNode[]): string {
  return children.map(inline).join("");
}

function inline(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type !== "element") return "";
  const children = node.children ?? [];
  switch (node.tagName) {
    case "br":
      return "\n";
    case "code":
      return `\`${plainText(node)}\``;
    case "strong":
    case "b":
      return `**${inlineText(children)}**`;
    case "em":
    case "i":
      return `*${inlineText(children)}*`;
    case "del":
    case "s":
      return `~~${inlineText(children)}~~`;
    case "a": {
      const label = inlineText(children);
      const href = node.properties?.href;
      return typeof href === "string" && href && href !== label
        ? `[${label}](${href})`
        : label;
    }
    case "img": {
      const alt = node.properties?.alt;
      return typeof alt === "string" ? alt : "";
    }
    default:
      return inlineText(children);
  }
}

function plainText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(plainText).join("");
}

function codeLanguage(code: HastNode): string {
  const names = code.properties?.className;
  const list = Array.isArray(names) ? names : [names];
  for (const name of list)
    if (typeof name === "string" && name.startsWith("language-"))
      return name.slice("language-".length);
  return "";
}

function rows(node: HastNode): string[][] {
  const out: string[][] = [];
  for (const child of node.children ?? []) {
    if (child.tagName === "tr")
      out.push(
        (child.children ?? [])
          .filter((cell) => cell.tagName === "td" || cell.tagName === "th")
          .map((cell) => inlineText(cell.children ?? []).trim()),
      );
    else if (child.type === "element") out.push(...rows(child));
  }
  return out;
}

function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line, index) => (index && line ? pad + line : line))
    .join("\n");
}
