import { resolveWorkspaceFileReference } from "../../../shared/lib/paths";
import { isNoteImagePath } from "../../notes/noteImages";

type MarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  label?: string;
  referenceType?: string;
  children?: MarkdownNode[];
};

export const PROJECT_MARKDOWN_IMAGE_PREFIX = "monocode-project-image:";

function normalizedDefinitionId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Keep reference image definitions available when Streamdown splits blocks. */
export function collectMarkdownImageDefinitions(
  markdown: string,
): Map<string, string> {
  const definitions = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; length: number } | undefined;
  for (const line of lines) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (
        close &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      )
        fence = undefined;
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (open) {
      fence = { marker: open[1][0], length: open[1].length };
      continue;
    }

    const match = line.match(
      /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>\n]+)>|(\S+))(?:\s+.*)?\s*$/,
    );
    if (!match) continue;
    const identifier = normalizedDefinitionId(match[1] ?? "");
    const url = match[2] ?? match[3];
    // CommonMark uses the first definition for a label.
    if (identifier && url && !definitions.has(identifier))
      definitions.set(identifier, url);
  }
  return definitions;
}

function localProjectImageUrl(url: string, cwd?: string): string | undefined {
  const value = url.trim();
  if (
    !value ||
    isNoteImagePath(value) ||
    value.startsWith("data:image/") ||
    (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value))
  )
    return undefined;
  const file = resolveWorkspaceFileReference(value, cwd);
  if (!file || file.path.startsWith("remote://")) return undefined;
  return `${PROJECT_MARKDOWN_IMAGE_PREFIX}${encodeURIComponent(file.path)}`;
}

/** Normalize local file links before URL sanitizing; keep all other URLs intact. */
export function remarkWorkspaceFileLinks({
  cwd,
  imageDefinitions,
  documentImages = false,
}: {
  cwd?: string;
  imageDefinitions?: () => ReadonlyMap<string, string>;
  /** Document images retain their source for document-relative, root-checked resolution. */
  documentImages?: boolean;
}) {
  return function transform(tree: MarkdownNode) {
    const definitions = new Map<string, string>();
    const collect = (node: MarkdownNode) => {
      if (
        node.type === "definition" &&
        node.identifier &&
        node.url
      ) {
        const identifier = normalizedDefinitionId(node.identifier);
        if (!definitions.has(identifier)) definitions.set(identifier, node.url);
      }
      for (const child of node.children ?? []) collect(child);
    };
    collect(tree);

    function visit(node: MarkdownNode) {
      if (node.type === "image" && node.url) {
        if (!documentImages) node.url = localProjectImageUrl(node.url, cwd) ?? node.url;
      } else if (node.type === "imageReference") {
        const identifier = normalizedDefinitionId(
          node.identifier ?? node.label ?? "",
        );
        const definition =
          definitions.get(identifier) ?? imageDefinitions?.().get(identifier);
        const imageUrl = definition
          ? documentImages ? definition : localProjectImageUrl(definition, cwd)
          : undefined;
        if (imageUrl) {
          node.type = "image";
          node.url = imageUrl;
          delete node.identifier;
          delete node.label;
          delete node.referenceType;
        }
      } else if ((node.type === "link" || node.type === "definition") && node.url) {
        const file = resolveWorkspaceFileReference(node.url, cwd);
        if (file) {
          const path = file.path.startsWith("/") ? file.path : `/${file.path}`;
          let href = path.split("/").map(encodeURIComponent).join("/");
          // Preserve a UNC path as a path, not a protocol-relative web origin.
          if (href.startsWith("//")) href = `/%2F${href.slice(2)}`;
          const target = file.navigation;
          node.url =
            href +
            (target
              ? `:${target.line}${target.column ? `:${target.column}` : ""}`
              : "");
        }
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
