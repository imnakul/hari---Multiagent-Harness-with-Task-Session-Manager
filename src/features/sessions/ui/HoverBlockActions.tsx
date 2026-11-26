import { useContext, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import { copyFormattedText } from "../../../platform/tauri/clipboard";
import { BlockActions } from "./BlockActions";
import { MarkdownTableContext } from "./markdownBlockContext";
import {
  altClickContent,
  hoverTargetAt,
  listContent,
  sectionContent,
  type HoverTarget,
} from "./hoverBlockTargets";

const HOST_ATTRIBUTE = "data-hover-actions-host";
const COPIED_ATTRIBUTE = "data-block-copied";
const COPIED_MS = 900;

/**
 * Fork (L-401): one floating action row per agent reply. Hovering a heading
 * offers its section (the heading and everything under it); hovering a list
 * offers the whole list. Alt+click copies one paragraph or list item. Code,
 * tables, quotes, diagrams and images keep their own rows (L-197).
 *
 * The row is portalled into the hovered element so it scrolls with it; the
 * host gets `position: relative` from index.css while it holds the row.
 */
export function HoverBlockActions({
  rootRef,
  source,
}: {
  /** Element around the Streamdown root; events are delegated from here. */
  rootRef: RefObject<HTMLElement | null>;
  /** The reply's Markdown, read at click time. */
  source: string;
}): ReactElement | null {
  const { streaming } = useContext(MarkdownTableContext);
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const anchor = useRef<HTMLElement | null>(null);
  anchor.current = target?.element ?? null;

  useEffect(() => {
    const wrapper = rootRef.current;
    if (!wrapper) return;
    const markdownRoot = (): HTMLElement | null => wrapper.querySelector<HTMLElement>(".agent-markdown");
    const onOver = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const root = markdownRoot();
      if (!root || !(event.target instanceof Element)) return;
      // Moving onto the row itself keeps it.
      if (event.target.closest("[data-hover-actions]")) return;
      const next = hoverTargetAt(event.target, root);
      setTarget((current) =>
        current?.element === next?.element && current?.kind === next?.kind ? current : next,
      );
    };
    const onLeave = (): void => setTarget(null);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onClick = (event: MouseEvent): void => {
      if (!event.altKey || event.button !== 0) return;
      const root = markdownRoot();
      if (!root || !(event.target instanceof Element)) return;
      const hit = altClickContent(event.target, root);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      const { element, content } = hit;
      void copyFormattedText(content.text, content.html ?? content.text).then(
        () => {
          setAnnouncement(element.tagName === "LI" ? "List item copied" : "Paragraph copied");
          element.removeAttribute(COPIED_ATTRIBUTE);
          // A reflow restarts the flash when the same block is copied twice.
          void element.offsetWidth;
          element.setAttribute(COPIED_ATTRIBUTE, "");
          const timer = setTimeout(() => {
            element.removeAttribute(COPIED_ATTRIBUTE);
            timers.delete(timer);
          }, COPIED_MS);
          timers.add(timer);
        },
        (failure: unknown) =>
          setAnnouncement(`Could not copy. ${failure instanceof Error ? failure.message : String(failure)}`),
      );
    };
    wrapper.addEventListener("pointerover", onOver);
    wrapper.addEventListener("pointerleave", onLeave);
    wrapper.addEventListener("click", onClick, true);
    return () => {
      wrapper.removeEventListener("pointerover", onOver);
      wrapper.removeEventListener("pointerleave", onLeave);
      wrapper.removeEventListener("click", onClick, true);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [rootRef]);

  // Only the element that holds the row is positioned; the mark goes when the row moves on.
  useEffect(() => {
    const host = target?.element;
    if (!host) return;
    host.setAttribute(HOST_ATTRIBUTE, target.kind);
    return () => host.removeAttribute(HOST_ATTRIBUTE);
  }, [target]);

  // Only after an Alt+click copy: a live region in every reply would crowd the
  // transcript's own status messages.
  const status = announcement ? (
    <span role="status" className="sr-only">
      {announcement}
    </span>
  ) : null;
  if (!target || streaming || !target.element.isConnected) return status;
  const { kind, element } = target;
  return (
    <>
      {status}
      {createPortal(
        <div data-hover-actions="" className="markdown-hover-actions">
          <BlockActions
            label={kind}
            anchor={anchor}
            className="rounded-lg border border-content/10 bg-surface p-0.5 shadow-sm"
            content={() => {
              const root = rootRef.current?.querySelector<HTMLElement>(".agent-markdown");
              if (!root || !element.isConnected) return null;
              return kind === "section"
                ? sectionContent(element, root, sourceRef.current)
                : listContent(element);
            }}
          />
        </div>,
        element,
      )}
    </>
  );
}
