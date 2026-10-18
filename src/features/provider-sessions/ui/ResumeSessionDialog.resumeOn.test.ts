// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderConversationList } from "./ProviderConversationList";
import { emptyProviderListState } from "../model/conversationStore";
import type { ProviderConversation } from "../model/providerSessions";

const row: ProviderConversation = {
  key: '["claude","/home/.claude","native-one"]',
  provider: "claude",
  nativeId: "native-one",
  sourceRoot: "/home/.claude",
  providerAccountId: "default",
  title: "Saved session title",
  cwd: "/repo",
  updatedAt: 1_700_000_000,
  archived: false,
  monocodeSessionId: null,
};

const props = {
  provider: "claude" as const,
  state: { ...emptyProviderListState, status: "ready" as const, rows: [row] },
  showArchived: false,
  openingKey: null,
  actionError: null,
  onShowArchivedChange: vi.fn(),
  onRefresh: vi.fn(),
  onLoadMore: vi.fn(),
  onOpen: vi.fn(),
  onArchive: vi.fn(),
  onDismissActionError: vi.fn(),
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openMenu(): Promise<HTMLElement> {
  const card = document.body.querySelector<HTMLElement>("[data-session-card]");
  if (!card) throw new Error("Missing conversation row");
  await act(async () => {
    card.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
  });
  const menu = document.body.querySelector<HTMLElement>(
    '[role="menu"][aria-label="Conversation actions"]',
  );
  if (!menu) throw new Error("Missing menu");
  return menu;
}

describe("Resume on another account", () => {
  it("offers Resume on <account> with the cost note and picks it", async () => {
    const onResumeOn = vi.fn();
    await act(async () =>
      root.render(
        createElement(ProviderConversationList, {
          ...props,
          resumeOnAccounts: [
            { id: "default", label: "Default account" },
            { id: "account-1", label: "imnakul" },
          ],
          onResumeOn,
        }),
      ),
    );
    const menu = await openMenu();
    expect(menu.textContent).toContain("Resume on imnakul");
    expect(menu.textContent).toContain("is not cached");
    expect(menu.textContent).not.toContain("Resume on Default account");
    const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.includes("Resume on imnakul"),
    );
    await act(async () => item?.click());
    expect(onResumeOn).toHaveBeenCalledWith(row, "account-1");
  });

  it("is hidden for Codex rows and when no handler is given", async () => {
    await act(async () =>
      root.render(
        createElement(ProviderConversationList, {
          ...props,
          provider: "codex" as const,
          state: {
            ...props.state,
            rows: [{ ...row, provider: "codex" as const }],
          },
          resumeOnAccounts: [{ id: "account-1", label: "imnakul" }],
          onResumeOn: vi.fn(),
        }),
      ),
    );
    expect((await openMenu()).textContent).not.toContain("Resume on");
  });
});
