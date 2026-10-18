// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { EditorPane, LayoutNode } from "../model/layout";
import { PaneTree } from "./PaneTree";

const paneProps = vi.hoisted(() => vi.fn());

vi.mock("../../files/ui/FilePane", async () => {
  const { createElement } = await import("react");
  return {
    FilePane: ({
      pane,
      visible,
      deferBody,
    }: {
      pane: EditorPane;
      visible: boolean;
      deferBody?: boolean;
    }) =>
      createElement(
        "div",
        {
          "data-file-pane": pane.id,
          "data-pane-visible": visible,
          "data-defer-body": deferBody,
        },
        createElement("div", { "data-pane-body": "" }),
      ),
  };
});

vi.mock("../../sessions/ui/SessionPane", () => ({
  SessionPane: (props: Record<string, unknown>) => {
    paneProps(props);
    const localActions = [
      props.onReviewFix,
      props.onFormReply,
      props.onBranch,
      props.onSidechat,
    ];
    return createElement("div", {
      "data-local-session-actions": localActions
        .map((action) => typeof action === "function")
        .join(","),
    });
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  paneProps.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fakeAnimations();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

function split(dir: "right" | "down", ...children: LayoutNode[]): LayoutNode {
  return {
    type: "split",
    id: `split-${dir}`,
    dir,
    children,
    sizes: children.map(() => 1 / children.length),
  };
}

function render(
  layout: LayoutNode,
  ids: string[],
  sessions: ComponentProps<typeof PaneTree>["sessions"] = [],
  controls: Partial<ComponentProps<typeof PaneTree>> = {},
) {
  const noop = vi.fn();
  const props: ComponentProps<typeof PaneTree> = {
    visible: true,
    layout,
    sessions,
    editorPanes: ids.map((id) => ({ id, files: [], activeFileId: "" })),
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: ids[0],
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onCloseOtherFiles: noop,
    onReorderFiles: noop,
    onFileDirtyChange: noop,
    onFileErrorCountChange: noop,
    onRatio: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onStop: noop,
    onCompactContext: noop,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onApproval: noop,
    onReviewFix: noop,
    onQuestionReply: noop,
    onFormReply: noop,
    onBranch: noop,
    onSidechat: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
    onMovePane: noop,
    onDetachPane: noop,
    onNewTerminal: noop,
    ...controls,
  };
  act(() => root.render(createElement(PaneTree, props)));
  return props;
}

type FakeAnimation = {
  target: HTMLElement;
  keyframes: Keyframe[];
  finish: () => void;
};

/** Records each slide and lets a test end it. */
function fakeAnimations(): FakeAnimation[] {
  const animations: FakeAnimation[] = [];
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (
    this: HTMLElement,
    keyframes,
  ) {
    const animation = {
      onfinish: null as (() => void) | null,
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
    };
    animations.push({
      target: this,
      keyframes: keyframes as Keyframe[],
      finish: () => animation.onfinish?.(),
    });
    return animation as unknown as Animation;
  });
  return animations;
}

function enterFrom(id: string) {
  return (
    container
      .querySelector(`[data-pane-id="${id}"] > [data-pane-content]`)
      ?.getAttribute("data-pane-enter") ?? undefined
  );
}

describe("pane enter animation", () => {
  it("leaves panes alone on mount", () => {
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });

  it("slides a new pane in from the edge it was split on", () => {
    render(leaf("a"), ["a"]);
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    expect(enterFrom("a")).toBeUndefined();
    expect(enterFrom("b")).toBe("right");

    render(split("right", leaf("a"), split("down", leaf("b"), leaf("c"))), [
      "a",
      "b",
      "c",
    ]);
    expect(enterFrom("c")).toBe("bottom");
  });

  it("clears the animation once it finishes", () => {
    const animations = fakeAnimations();
    render(leaf("a"), ["a"]);
    render(split("right", leaf("b"), leaf("a")), ["a", "b"]);
    expect(enterFrom("b")).toBe("left");
    // The new pane grows from the left edge and pushes its neighbour over.
    const boxes = animations.filter((entry) => entry.target.dataset.paneId);
    expect(boxes.map((entry) => entry.target.dataset.paneId)).toEqual([
      "b",
      "a",
    ]);
    expect(boxes[0].keyframes[0]).toMatchObject({ width: "0%" });

    act(() => animations[0].finish());
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });

  it("shows a file's tabs at once but mounts its body after the slide", () => {
    const animations = fakeAnimations();
    render(leaf("a"), ["a"]);
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    const pane = () => container.querySelector('[data-file-pane="b"]')!;
    expect(pane().getAttribute("data-defer-body")).toBe("true");

    act(() => animations[0].finish());
    expect(pane().getAttribute("data-defer-body")).toBe("false");
    const reveal = animations.at(-1)!;
    expect(reveal.target.hasAttribute("data-pane-body")).toBe(true);
    expect(reveal.keyframes[0]).toMatchObject({ opacity: 0 });
  });

  it("slides a closed file pane out before removing it", () => {
    const animations = fakeAnimations();
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    render(leaf("a"), ["a"]);
    const leaving = container.querySelector<HTMLElement>('[data-pane-id="b"]')!;
    expect(leaving.hasAttribute("data-pane-leaving")).toBe(true);
    expect(leaving.querySelector('[data-file-pane="b"]')).not.toBeNull();
    const out = animations.find((entry) => entry.target === leaving)!;
    expect(out.keyframes[1]).toMatchObject({ left: "100%", width: "0%" });

    act(() => out.finish());
    expect(container.querySelector('[data-pane-id="b"]')).toBeNull();
  });

  it("undoes focus scrolling while the pane slides in", () => {
    render(leaf("a"), ["a"]);
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    const box = container.querySelector<HTMLElement>('[data-pane-id="b"]')!;
    box.scrollLeft = 300;
    act(() => box.dispatchEvent(new Event("scroll")));
    expect(box.scrollLeft).toBe(0);
  });

  it("does not animate a pane swapped in place", () => {
    render(split("right", leaf("a"), leaf("b")), ["a", "b"]);
    render(split("right", leaf("a"), leaf("c")), ["a", "c"]);
    expect(container.querySelector("[data-pane-enter]")).toBeNull();
  });

  it("keeps local session actions connected inside the animated pane", () => {
    const session = {
      ...newSession("codex", "/tmp/project"),
      id: "session",
    };
    render(leaf("existing"), ["existing"]);
    render(split("right", leaf("existing"), leaf("session")), ["existing"], [session]);

    const actions = container.querySelector<HTMLElement>(
      "[data-local-session-actions]",
    );
    expect(actions?.getAttribute("data-local-session-actions")).toBe(
      "true,true,true,true",
    );
    expect(actions?.closest('[data-pane-enter="right"]')).not.toBeNull();
  });

  it("forwards Cloud and Claude RC controls to a normal empty chat and later split panes", () => {
    const session = { ...newSession("claude", "/tmp/project"), id: "claude-chat" };
    const onCloudLaunchOutcome = vi.fn();
    const onRemoteControlChange = vi.fn();
    const remoteControlDesired = new Set([session.id]);
    const controls = { onCloudLaunchOutcome, onRemoteControlChange, remoteControlDesired };

    render(leaf(session.id), [], [session], controls);
    expect(paneProps.mock.lastCall?.[0]).toMatchObject({
      session,
      inSplit: false,
      ...controls,
    });
    expect(paneProps.mock.lastCall?.[0].onCloudLaunchOutcome).toBe(onCloudLaunchOutcome);
    expect(paneProps.mock.lastCall?.[0].onRemoteControlChange).toBe(onRemoteControlChange);
    expect(paneProps.mock.lastCall?.[0].remoteControlDesired).toBe(remoteControlDesired);

    const nextDesired = new Set<string>();
    render(split("right", leaf("editor"), leaf(session.id)), ["editor"], [session], {
      ...controls,
      remoteControlDesired: nextDesired,
    });
    expect(paneProps.mock.lastCall?.[0]).toMatchObject({
      session,
      inSplit: true,
      onCloudLaunchOutcome,
      onRemoteControlChange,
    });
    expect(paneProps.mock.lastCall?.[0].remoteControlDesired).toBe(nextDesired);
  });
});

it("updates file pane visibility when switching workspace tabs", () => {
  const props = render(leaf("a"), ["a"]);
  const pane = container.querySelector('[data-file-pane="a"]')!;
  expect(pane.getAttribute("data-pane-visible")).toBe("true");
  act(() => root.render(createElement(PaneTree, { ...props, visible: false })));
  expect(pane.getAttribute("data-pane-visible")).toBe("false");
  act(() => root.render(createElement(PaneTree, props)));
  expect(pane.getAttribute("data-pane-visible")).toBe("true");
});
