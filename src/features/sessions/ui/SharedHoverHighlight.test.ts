import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELECTOR,
  findHoverTarget,
  isPointerInContinuityGap,
  isTargetDisabled,
  resolveSharedHoverAction,
  SHARED_HOVER_CONTINUITY_ATTR,
  shouldHideOnFocusOut,
  type SharedHoverAction,
} from "./SharedHoverHighlight";

interface MockElementOptions {
  tagName?: string;
  attributes?: Record<string, string>;
  parent?: MockDOMElement | null;
}

class MockDOMElement {
  readonly tagName: string;
  readonly attributes: Record<string, string>;
  parentElement: MockDOMElement | null;

  constructor({
    tagName = "div",
    attributes = {},
    parent = null,
  }: MockElementOptions = {}) {
    this.tagName = tagName;
    this.attributes = { ...attributes };
    this.parentElement = parent;
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, val: string): void {
    this.attributes[name] = val;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  closest(selector: string): MockDOMElement | null {
    let cur: MockDOMElement | null = this;
    while (cur) {
      if (cur.matches(selector)) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  matches(selector: string): boolean {
    const selectors = selector.split(",").map((s) => s.trim());
    for (const sel of selectors) {
      if (sel === `[${SHARED_HOVER_CONTINUITY_ATTR}]`) {
        if (this.hasAttribute(SHARED_HOVER_CONTINUITY_ATTR)) return true;
      } else if (sel === "[data-shared-hover-item]") {
        if (this.hasAttribute("data-shared-hover-item")) return true;
      } else if (sel.startsWith('[role="') && sel.endsWith('"]')) {
        const role = sel.slice(7, -2);
        if (this.getAttribute("role") === role) return true;
      } else if (
        sel.startsWith('[role="') &&
        sel.includes('"]:not(:disabled)')
      ) {
        const role = sel.slice(7, sel.indexOf('"]:not(:disabled)'));
        if (
          this.getAttribute("role") === role &&
          !this.hasAttribute("disabled")
        ) {
          return true;
        }
      } else if (sel === "button" && this.tagName.toLowerCase() === "button") {
        return true;
      }
    }
    return false;
  }

  contains(other: unknown): boolean {
    let cur = other as MockDOMElement | null;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
}

if (typeof globalThis.Element === "undefined") {
  globalThis.Element = MockDOMElement as unknown as typeof Element;
}
if (typeof globalThis.HTMLElement === "undefined") {
  globalThis.HTMLElement = MockDOMElement as unknown as typeof HTMLElement;
}

function createMockElement(options: MockElementOptions = {}): HTMLElement {
  return new MockDOMElement(options) as unknown as HTMLElement;
}

function evaluateHoverStep(
  pointerTarget: EventTarget | null,
  currentTarget: HTMLElement | null,
  root: HTMLElement,
  selector: string = DEFAULT_SELECTOR,
): SharedHoverAction {
  const hit = findHoverTarget(pointerTarget, root, selector);
  const inContinuity = isPointerInContinuityGap(pointerTarget, currentTarget, root);
  return resolveSharedHoverAction({
    currentTarget,
    isCurrentlyVisible: currentTarget !== null,
    hitTarget: hit,
    isHitDisabled: isTargetDisabled(hit),
    inContinuityGap: inContinuity,
  });
}

describe("SharedHoverHighlight continuity and decision logic", () => {
  describe("isTargetDisabled", () => {
    it("recognizes disabled, aria-disabled, and data-shared-hover-disabled", () => {
      const normal = createMockElement();
      expect(isTargetDisabled(normal)).toBe(false);

      const nativeDisabled = createMockElement({ attributes: { disabled: "" } });
      expect(isTargetDisabled(nativeDisabled)).toBe(true);

      const ariaDisabled = createMockElement({
        attributes: { "aria-disabled": "true" },
      });
      expect(isTargetDisabled(ariaDisabled)).toBe(true);

      const explicitDisabled = createMockElement({
        attributes: { "data-shared-hover-disabled": "true" },
      });
      expect(isTargetDisabled(explicitDisabled)).toBe(true);

      expect(isTargetDisabled(null)).toBe(false);
    });
  });

  describe("production decision sequence & disabled target regression", () => {
    const root = createMockElement({ tagName: "div" });
    const continuityGroup = createMockElement({
      tagName: "div",
      attributes: { [SHARED_HOVER_CONTINUITY_ATTR]: "true" },
      parent: root as unknown as MockDOMElement,
    });
    const enabledTargetA = createMockElement({
      tagName: "button",
      attributes: { role: "menuitemcheckbox" },
      parent: continuityGroup as unknown as MockDOMElement,
    });
    const enabledTargetB = createMockElement({
      tagName: "button",
      attributes: { role: "menuitemcheckbox" },
      parent: continuityGroup as unknown as MockDOMElement,
    });
    const nativeDisabledItem = createMockElement({
      tagName: "button",
      attributes: { role: "menuitemcheckbox", disabled: "" },
      parent: continuityGroup as unknown as MockDOMElement,
    });
    const ariaDisabledItem = createMockElement({
      tagName: "button",
      attributes: { role: "menuitemcheckbox", "aria-disabled": "true" },
      parent: continuityGroup as unknown as MockDOMElement,
    });
    const customDisabledItem = createMockElement({
      tagName: "button",
      attributes: {
        role: "menuitemcheckbox",
        "data-shared-hover-disabled": "true",
      },
      parent: continuityGroup as unknown as MockDOMElement,
    });
    const sectionDivider = createMockElement({
      tagName: "div",
      attributes: { role: "separator" },
      parent: root as unknown as MockDOMElement,
    });
    const sectionLabel = createMockElement({
      tagName: "div",
      parent: root as unknown as MockDOMElement,
    });
    const outsidePopover = createMockElement({ tagName: "div" });

    it("hides marker when entering a native disabled role-based item in a continuity group (not retained)", () => {
      // 1. Enabled Target A is active
      const step1 = evaluateHoverStep(enabledTargetA, null, root);
      expect(step1).toEqual({ type: "activate", target: enabledTargetA });

      // 2. Pointer enters a native disabled role-based item inside the same continuity group.
      // 3. Target discovery MUST identify the disabled item rather than returning null.
      const discoveredTarget = findHoverTarget(nativeDisabledItem, root);
      expect(discoveredTarget).toBe(nativeDisabledItem);
      expect(isTargetDisabled(discoveredTarget)).toBe(true);

      // 4. The resulting action is hide, and 5. old target A is not retained.
      const step2 = evaluateHoverStep(
        nativeDisabledItem,
        enabledTargetA,
        root,
      );
      expect(step2).toEqual({ type: "hide" });
    });

    it("demonstrates regression contrast: old :not(:disabled) selector erroneously retained old target", () => {
      const buggySelector = [
        "[data-shared-hover-item]",
        '[role="menuitem"]:not(:disabled)',
        '[role="menuitemcheckbox"]:not(:disabled)',
        '[role="option"]:not(:disabled)',
      ].join(",");

      // With old :not(:disabled) selector, target discovery returned null for disabled item
      expect(
        findHoverTarget(nativeDisabledItem, root, buggySelector),
      ).toBeNull();

      // Which caused the continuity gap logic to treat it as an internal gap and retain target A!
      expect(
        evaluateHoverStep(
          nativeDisabledItem,
          enabledTargetA,
          root,
          buggySelector,
        ),
      ).toEqual({ type: "retain" });
    });

    it("hides marker when entering an aria-disabled item inside continuity group", () => {
      const action = evaluateHoverStep(ariaDisabledItem, enabledTargetA, root);
      expect(action).toEqual({ type: "hide" });
    });

    it("hides marker when entering a data-shared-hover-disabled item inside continuity group", () => {
      const action = evaluateHoverStep(customDisabledItem, enabledTargetA, root);
      expect(action).toEqual({ type: "hide" });
    });

    it("smoothly transitions Target A -> internal continuity gap -> Target B", () => {
      // Pointer in internal gap of continuity container
      const gapAction = evaluateHoverStep(continuityGroup, enabledTargetA, root);
      expect(gapAction).toEqual({ type: "retain" });

      // Pointer enters enabled Target B
      const targetBAction = evaluateHoverStep(enabledTargetB, enabledTargetA, root);
      expect(targetBAction).toEqual({ type: "activate", target: enabledTargetB });
    });

    it("does not show marker or invent target when entering empty gap before any target is activated", () => {
      const action = evaluateHoverStep(continuityGroup, null, root);
      expect(action).toEqual({ type: "hide" });
    });

    it("hides marker when pointer enters ordinary non-continuity blank space on root", () => {
      const action = evaluateHoverStep(root, enabledTargetA, root);
      expect(action).toEqual({ type: "hide" });
    });

    it("hides marker when pointer enters section divider or section label", () => {
      expect(evaluateHoverStep(sectionDivider, enabledTargetA, root)).toEqual({
        type: "hide",
      });
      expect(evaluateHoverStep(sectionLabel, enabledTargetA, root)).toEqual({
        type: "hide",
      });
    });

    it("hides marker when pointer leaves the popover root", () => {
      const action = evaluateHoverStep(outsidePopover, enabledTargetA, root);
      expect(action).toEqual({ type: "hide" });
    });
  });

  describe("resolveSharedHoverAction state transitions", () => {
    const targetA = createMockElement({ tagName: "button" });
    const targetB = createMockElement({ tagName: "button" });
    const disabledTarget = createMockElement({
      tagName: "button",
      attributes: { disabled: "" },
    });

    it("activates target A as a first appearance when initially unhighlighted", () => {
      const action = resolveSharedHoverAction({
        currentTarget: null,
        isCurrentlyVisible: false,
        hitTarget: targetA,
        isHitDisabled: false,
        inContinuityGap: false,
      });

      expect(action).toEqual({
        type: "activate",
        target: targetA,
      });
    });

    it("preserves target A and marker visibility when pointer moves into an internal continuity gap", () => {
      const action = resolveSharedHoverAction({
        currentTarget: targetA,
        isCurrentlyVisible: true,
        hitTarget: null,
        isHitDisabled: false,
        inContinuityGap: true,
      });

      expect(action).toEqual({ type: "retain" });
    });

    it("positions target B as a continuation when moving from the continuity gap", () => {
      const action = resolveSharedHoverAction({
        currentTarget: targetA,
        isCurrentlyVisible: true,
        hitTarget: targetB,
        isHitDisabled: false,
        inContinuityGap: true,
      });

      expect(action).toEqual({
        type: "activate",
        target: targetB,
      });
    });

    it("retains target when hovering the already active target", () => {
      const action = resolveSharedHoverAction({
        currentTarget: targetA,
        isCurrentlyVisible: true,
        hitTarget: targetA,
        isHitDisabled: false,
        inContinuityGap: false,
      });

      expect(action).toEqual({ type: "retain" });
    });

    it("hides marker when target is disabled", () => {
      const action = resolveSharedHoverAction({
        currentTarget: targetA,
        isCurrentlyVisible: true,
        hitTarget: disabledTarget,
        isHitDisabled: true,
        inContinuityGap: true,
      });

      expect(action).toEqual({ type: "hide" });
    });
  });
});

describe("shouldHideOnFocusOut (L-129)", () => {
  it("keeps the marker when a hovered row moves focus into its flyout", () => {
    expect(
      shouldHideOnFocusOut({ focusLeftList: true, pointerOverList: true }),
    ).toBe(false);
  });

  it("hides when keyboard focus leaves the list", () => {
    expect(
      shouldHideOnFocusOut({ focusLeftList: true, pointerOverList: false }),
    ).toBe(true);
  });

  it("ignores focus moves inside the list", () => {
    expect(
      shouldHideOnFocusOut({ focusLeftList: false, pointerOverList: false }),
    ).toBe(false);
  });
});
