// @vitest-environment happy-dom
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> | undefined }[] = [];
let notices: unknown[] = [];
let receiving = true;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "mobile_phone_notifications_list")
      return Promise.resolve({ receiving, stalled: false, paired: true, onPhone: notices, earlier: [], icons: {} });
    return Promise.resolve();
  }),
}));
let emit: () => void = () => {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: () => void) => {
    emit = handler;
    return Promise.resolve(() => {});
  }),
}));

import { usePhoneNotificationBanners } from "./usePhoneNotificationBanners";
import { PHONE_BANNERS_KEY } from "../model/phoneBanners";
import { setSharePanelOpen, setShareView } from "../model/shareView";

const notice = (key: string, postedAt = 1) => ({
  key, package: "com.whatsapp", app: "WhatsApp", title: "Asha", text: "Hi", postedAt,
});
const shown = () => calls.filter((c) => c.cmd === "show_notification");
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Probe(): null {
  usePhoneNotificationBanners();
  return null;
}

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  calls.length = 0;
  notices = [notice("old")];
  receiving = true;
  localStorage.setItem("monocode.notifications", "1");
  localStorage.setItem(PHONE_BANNERS_KEY, "1");
  setSharePanelOpen(false);
  setShareView("share");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

async function mount(): Promise<void> {
  act(() => root.render(createElement(Probe)));
  await flush();
}

describe("usePhoneNotificationBanners", () => {
  it("seeds silently, then shows a new notice with the hari-phone id (AC-F3, F10)", async () => {
    await mount();
    expect(shown()).toHaveLength(0);
    notices = [notice("old"), notice("new", 2)];
    emit();
    await flush();
    expect(shown()).toHaveLength(1);
    expect(shown()[0].args).toMatchObject({ sessionId: "hari-phone:new", title: "Hari-Phone · WhatsApp", sound: false });
  });

  it("stays quiet when the switch or app notifications are off (AC-F1)", async () => {
    await mount();
    localStorage.setItem(PHONE_BANNERS_KEY, "0");
    notices = [notice("old"), notice("n1", 2)];
    emit();
    await flush();
    localStorage.setItem(PHONE_BANNERS_KEY, "1");
    localStorage.setItem("monocode.notifications", "0");
    notices = [notice("old"), notice("n1", 2), notice("n2", 3)];
    emit();
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("stays quiet while Share shows Notifications in a focused window (AC-F11)", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await mount();
    setSharePanelOpen(true);
    setShareView("notifications");
    notices = [notice("old"), notice("new", 2)];
    emit();
    await flush();
    expect(shown()).toHaveLength(0);
  });
});
