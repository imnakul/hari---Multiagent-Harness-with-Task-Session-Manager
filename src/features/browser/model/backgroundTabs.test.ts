import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const { browserStore, markShowing } = await import("./browserTabs");
const {
  backgroundNotice: notice,
  dismissBackgroundNotice,
  openInBackgroundTab,
} = await import("./backgroundTabs");

describe("open in background tab (L-224)", () => {
  afterEach(() => dismissBackgroundNotice());

  it("adds a tab with the page waiting to load, without switching to it", () => {
    const before = browserStore();
    openInBackgroundTab("https://example.com/a");
    const after = browserStore();
    expect(after.activeId).toBe(before.activeId);
    const added = after.tabs.at(-1)!;
    expect(added.pending).toBe("https://example.com/a");
    // Saved with its address, so it comes back after a restart.
    expect(added.url).toBe("https://example.com/a");
  });

  it("offers Show only when no Browser is on screen", () => {
    openInBackgroundTab("https://example.com/b");
    openInBackgroundTab("https://example.com/c");
    expect(notice()).toMatchObject({ count: 2, tab: browserStore().tabs.at(-1)!.id });
    dismissBackgroundNotice();
    const hide = markShowing();
    openInBackgroundTab("https://example.com/d");
    expect(notice()).toBeNull();
    hide();
  });

  it("ignores anything but web links", () => {
    const count = browserStore().tabs.length;
    openInBackgroundTab("file:///C:/secret.txt");
    expect(browserStore().tabs).toHaveLength(count);
  });
});
