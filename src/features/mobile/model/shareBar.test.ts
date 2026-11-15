import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  currentKeybindings,
  loadShareBarShortcut,
  saveKeybindingOverride,
  saveQuickComposerShortcut,
  saveShareBarEnabled,
  saveShareBarShortcut,
  SHARE_BAR_COMMAND,
  SHARE_BAR_DEFAULT_SHORTCUT,
} from "../../settings/model/settings";
import { setShareBarShortcut } from "./shareBar";

vi.mock("../../../platform/tauri/platform", () => ({
  IS_MAC: false,
  IS_WIN: true,
  IS_LINUX: false,
  HAS_NATIVE_GLASS: true,
  MOD: "Ctrl+",
  ALT: "Alt+",
  SHIFT: "Shift+",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const data = new Map<string, string>();

beforeEach(() => {
  data.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(invoke).mockClear();
});

it("defaults to Ctrl+Alt+H and lists it under Shortcuts", () => {
  expect(loadShareBarShortcut()).toBe(SHARE_BAR_DEFAULT_SHORTCUT);
  const row = currentKeybindings().find((entry) => entry.command === SHARE_BAR_COMMAND);
  expect(row?.keys).toBe("Ctrl+Alt+H");
  saveShareBarEnabled(false);
  expect(currentKeybindings().find((entry) => entry.command === SHARE_BAR_COMMAND)?.keys).toBe("Disabled");
});

it("keeps its chord out of other commands and theirs out of it", () => {
  expect(() => saveKeybindingOverride("App: Search", { shortcut: SHARE_BAR_DEFAULT_SHORTCUT })).toThrow(
    `Already used by ${SHARE_BAR_COMMAND}`,
  );
  expect(() => saveQuickComposerShortcut(SHARE_BAR_DEFAULT_SHORTCUT)).toThrow(`Already used by ${SHARE_BAR_COMMAND}`);
  expect(() => saveShareBarShortcut("Control+Shift+Space")).toThrow("Already used by App: Quick Composer");
  saveShareBarShortcut("Control+Option+KeyJ");
  expect(loadShareBarShortcut()).toBe("Control+Option+KeyJ");
});

it("claims the shortcut through the backend", async () => {
  await setShareBarShortcut(true, "Control+Option+KeyJ");
  expect(invoke).toHaveBeenCalledWith("share_bar_set_enabled", { enabled: true, shortcut: "Control+Option+KeyJ" });
});
