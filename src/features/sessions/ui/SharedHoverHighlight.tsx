import { useEffect, useRef } from "react";
import {
  describeElement,
  describeSurface,
  isPerfDebugEnabled,
  paintsOwnHoverFill,
  reportHoverDebug,
} from "../../../shared/debug/perfDebug";

export const SHARED_HOVER_CONTINUITY_ATTR = "data-shared-hover-continuity";

export const DEFAULT_SELECTOR = [
  "[data-shared-hover-item]",
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
].join(",");

export type SharedHoverAction =
  | { type: "activate"; target: HTMLElement }
  | { type: "retain" }
  | { type: "hide" };

export function isTargetDisabled(element: HTMLElement | null): boolean {
  if (!element) return false;
  return (
    element.hasAttribute("disabled") ||
    element.hasAttribute("data-shared-hover-disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}

export function findHoverTarget(
  node: EventTarget | null,
  root: HTMLElement,
  selector: string = DEFAULT_SELECTOR,
): HTMLElement | null {
  const element = node instanceof Element ? node : null;
  const explicit = element?.closest(
    "[data-shared-hover-item]",
  ) as HTMLElement | null;
  const hit = explicit ?? (element?.closest(selector) as HTMLElement | null);
  return hit && root.contains(hit) ? hit : null;
}

export function isPointerInContinuityGap(
  node: EventTarget | null,
  currentTarget: HTMLElement | null,
  root: HTMLElement,
): boolean {
  if (!currentTarget) return false;
  const element = node instanceof Element ? node : null;
  if (!element) return false;
  const region = element.closest(
    `[${SHARED_HOVER_CONTINUITY_ATTR}]`,
  ) as HTMLElement | null;
  return Boolean(
    region && root.contains(region) && region.contains(currentTarget),
  );
}

export function resolveSharedHoverAction({
  currentTarget,
  isCurrentlyVisible,
  hitTarget,
  isHitDisabled = isTargetDisabled(hitTarget),
  inContinuityGap = false,
}: {
  currentTarget: HTMLElement | null;
  isCurrentlyVisible: boolean;
  hitTarget: HTMLElement | null;
  isHitDisabled?: boolean;
  inContinuityGap?: boolean;
}): SharedHoverAction {
  if (hitTarget) {
    if (isHitDisabled) {
      return { type: "hide" };
    }
    if (currentTarget === hitTarget && isCurrentlyVisible) {
      return { type: "retain" };
    }
    return {
      type: "activate",
      target: hitTarget,
    };
  }

  if (currentTarget && isCurrentlyVisible && inContinuityGap) {
    return { type: "retain" };
  }

  return { type: "hide" };
}

/**
 * Whether focus leaving the list hides the marker. While the pointer is over
 * the list the pointer owns the marker: a menu row that opens a flyout moves
 * focus into the flyout, and hiding there made every next hover snap instead
 * of gliding (L-129).
 */
export function shouldHideOnFocusOut({
  focusLeftList,
  pointerOverList,
}: {
  focusLeftList: boolean;
  pointerOverList: boolean;
}): boolean {
  return focusLeftList && !pointerOverList;
}

export type SharedHoverReflow =
  | { type: "reposition" }
  | { type: "activate"; target: HTMLElement }
  | { type: "hide"; reason: string };

/**
 * What to do when the layout changed under the highlight (not the pointer):
 * keep the marker on its item at the item's new rect, move it to whatever now
 * sits under a still pointer, or hide it when nothing hoverable is there.
 */
export function resolveSharedHoverReflow({
  targetConnected,
  pointerKnown,
  pointerInsideTarget,
  hitTarget,
  inContinuityGap,
}: {
  targetConnected: boolean;
  /** False after keyboard navigation or once the pointer left the list. */
  pointerKnown: boolean;
  pointerInsideTarget: boolean;
  /** The hoverable item now under the pointer, if any. */
  hitTarget: HTMLElement | null;
  inContinuityGap: boolean;
}): SharedHoverReflow {
  const usable = hitTarget && !isTargetDisabled(hitTarget) ? hitTarget : null;
  if (!targetConnected) {
    return pointerKnown && usable
      ? { type: "activate", target: usable }
      : { type: "hide", reason: "item was removed or re-rendered" };
  }
  if (!pointerKnown || pointerInsideTarget) return { type: "reposition" };
  if (usable) return { type: "activate", target: usable };
  if (!hitTarget && inContinuityGap) return { type: "reposition" };
  return { type: "hide", reason: "layout changed and the item left the pointer" };
}

/** The non-item element the pointer crossed, for the Performance overlay. */
function describeGap(node: EventTarget | null): string {
  if (!(node instanceof Element)) return "an empty gap";
  const tag = node.tagName.toLowerCase();
  const classes = [...node.classList].slice(0, 3).join(".");
  return classes ? `<${tag}.${classes}>` : `<${tag}>`;
}

export function SharedHoverHighlight({
  selector = DEFAULT_SELECTOR,
}: {
  selector?: string;
}): React.JSX.Element {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const marker = markerRef.current;
    const root = marker?.parentElement;
    if (!marker || !root) return;

    let target: HTMLElement | null = null;
    let frame = 0;
    // Last pointer position over the list, to find what sits under a still
    // cursor after the layout changes. Cleared by keyboard use and on leave.
    let pointer: { x: number; y: number } | null = null;
    // Box the marker was last placed at, so a reflow that changes nothing
    // (including the observer's first callback) never interrupts a glide.
    let applied = { x: 0, y: 0, width: 0, height: 0 };
    // One observer for the list and its hovered item: layout changes that
    // fire no scroll or resize event (a side pane opening, a card re-wrapping).
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => refresh());
    resizeObserver?.observe(root);

    const setTarget = (next: HTMLElement | null): void => {
      if (target === next) return;
      if (target) {
        target.removeAttribute("data-shared-hover-active");
        resizeObserver?.unobserve(target);
      }
      target = next;
      if (next) {
        next.setAttribute("data-shared-hover-active", "true");
        resizeObserver?.observe(next);
      }
    };

    const position = (
      next: HTMLElement,
      report = true,
      animate = true,
    ): void => {
      const rootRect = root.getBoundingClientRect();
      const rect = next.getBoundingClientRect();
      const first = marker.dataset.visible !== "true" || !animate;
      if (report && isPerfDebugEnabled())
        reportHoverDebug({
          kind: first ? "snap" : "glide",
          surface: describeSurface(root),
          item: describeElement(next),
          ownFill: paintsOwnHoverFill(next),
        });
      if (first) marker.style.transition = "none";
      // Snap to whole pixels: fractional translate/width blurs the marker's
      // edges, which reads as a smaller box next to a crisp selected pill.
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const x = Math.round(rect.left - rootRect.left + root.scrollLeft);
      const y = Math.round(rect.top - rootRect.top + root.scrollTop);
      applied = { x, y, width, height };
      marker.style.width = `${width}px`;
      marker.style.height = `${height}px`;
      marker.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      marker.style.borderRadius = getComputedStyle(next).borderRadius;
      const danger = next.dataset.sharedHoverTone === "danger";
      marker.dataset.sharedHoverHighlightTone = danger ? "danger" : "default";
      marker.classList.toggle("bg-red-500/15", danger);
      // The moving highlight must honor the Menu item highlight setting like
      // selected rows do (index.css reads --popover-highlight-opacity). A
      // fixed class here would freeze it at 8% forever; the var() expression
      // stays live so slider changes repaint immediately.
      marker.style.background = danger
        ? ""
        : "color-mix(in srgb, var(--color-content) var(--popover-highlight-opacity), transparent)";
      if (first) {
        void marker.offsetWidth;
        marker.style.transition = "";
      }
      marker.dataset.visible = "true";
      marker.style.opacity = "1";
    };

    const hide = (reason: string): void => {
      if (isPerfDebugEnabled() && marker.dataset.visible === "true")
        reportHoverDebug({
          kind: "hide",
          surface: describeSurface(root),
          item: describeElement(target),
          ownFill: false,
          reason,
        });
      setTarget(null);
      marker.dataset.visible = "false";
      marker.style.opacity = "0";
    };

    const show = (next: HTMLElement | null): void => {
      const action = resolveSharedHoverAction({
        currentTarget: target,
        isCurrentlyVisible: marker.dataset.visible === "true",
        hitTarget: next,
        isHitDisabled: isTargetDisabled(next),
        inContinuityGap: false,
      });

      if (action.type === "activate") {
        if (target === action.target) return;
        setTarget(action.target);
        position(action.target);
      } else if (action.type === "hide") {
        hide("focus moved to a disabled item");
      }
    };

    // Re-measure after the layout moved or resized the hovered item, without
    // a glide: the marker should be at the item's new box, not chase it.
    const reflow = (): void => {
      if (!target) return;
      const connected = target.isConnected;
      const point = pointer;
      let hit: HTMLElement | null = null;
      let inside = false;
      if (point) {
        if (connected) {
          const rect = target.getBoundingClientRect();
          inside =
            point.x >= rect.left &&
            point.x <= rect.right &&
            point.y >= rect.top &&
            point.y <= rect.bottom;
        }
        if (!inside) {
          const under = document.elementFromPoint(point.x, point.y);
          hit = findHoverTarget(under, root, selector);
        }
      }
      const gap =
        !inside &&
        connected &&
        isPointerInContinuityGap(
          point ? document.elementFromPoint(point.x, point.y) : null,
          target,
          root,
        );
      const action = resolveSharedHoverReflow({
        targetConnected: connected,
        pointerKnown: point !== null,
        pointerInsideTarget: inside,
        hitTarget: hit,
        inContinuityGap: gap,
      });
      if (action.type === "hide") hide(action.reason);
      else if (action.type === "activate") {
        setTarget(action.target);
        position(action.target, true, false);
      } else {
        const rootRect = root.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const moved =
          Math.round(rect.width) !== applied.width ||
          Math.round(rect.height) !== applied.height ||
          Math.round(rect.left - rootRect.left + root.scrollLeft) !==
            applied.x ||
          Math.round(rect.top - rootRect.top + root.scrollTop) !== applied.y;
        if (moved) position(target, false, false);
      }
    };

    function refresh(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reflow);
    }

    const onPointerMove = (event: PointerEvent): void => {
      pointer = { x: event.clientX, y: event.clientY };
      const hit = findHoverTarget(event.target, root, selector);
      const inContinuity = isPointerInContinuityGap(event.target, target, root);
      const action = resolveSharedHoverAction({
        currentTarget: target,
        isCurrentlyVisible: marker.dataset.visible === "true",
        hitTarget: hit,
        isHitDisabled: isTargetDisabled(hit),
        inContinuityGap: inContinuity,
      });

      if (action.type === "activate") {
        if (target === action.target) return;
        setTarget(action.target);
        position(action.target);
      } else if (action.type === "hide") {
        hide(
          hit
            ? "pointer is over a disabled item"
            : `pointer crossed ${describeGap(event.target)}, outside this list's glide region`,
        );
      }
    };

    const onPointerLeave = (): void => {
      pointer = null;
      hide("pointer left the list");
    };
    const onKeyDown = (): void => {
      pointer = null;
    };
    const onFocusIn = (event: FocusEvent): void =>
      show(findHoverTarget(event.target, root, selector));
    const onFocusOut = (event: FocusEvent): void => {
      if (
        shouldHideOnFocusOut({
          focusLeftList: !root.contains(event.relatedTarget as Node | null),
          pointerOverList: pointer !== null,
        })
      )
        hide("focus left the list");
    };

    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      target?.removeAttribute("data-shared-hover-active");
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [selector]);

  return (
    <span
      ref={markerRef}
      aria-hidden
      data-shared-hover-highlight
      className="pointer-events-none absolute left-0 top-0 z-[1] opacity-0 will-change-transform transition-[transform,width,height,opacity,background-color] duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
    />
  );
}
