import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_RUNNER_DEFAULT,
  COMPACT_MODEL_LABELS_DEFAULT,
  DETAILED_CONTEXT_DEFAULT,
  AUTOSAVE_DEFAULT,
  COLLAPSED_PROJECT_RAIL_MODE_DEFAULT,
  searchSettings,
  SETTINGS_INDEX,
  settingsSectionsByGroup,
  MODEL_CONTROLS_DEFAULT,
  DIFF_VIEWER_DEFAULT,
  FORMAT_ON_SAVE_DEFAULT,
  FILE_TAB_MODE_DEFAULT,
  FOLLOW_UP_BEHAVIOR_DEFAULT,
  GRID_ARCADE_ENABLED_DEFAULT,
  isSettingsSectionId,
  KEYBINDINGS,
  LIVE_AGENTS_ENABLED_DEFAULT,
  TAB_ANIMATIONS_ENABLED_DEFAULT,
  loadComposerRunner,
  loadCompactModelLabels,
  loadDetailedContext,
  loadComposerEffortVisible,
  loadAutosave,
  loadCollapsedProjectRailMode,
  loadModelControls,
  loadDiffViewer,
  loadKeybindingOverrides,
  loadFormatOnSave,
  loadFileTabMode,
  loadFollowUpBehavior,
  loadGridArcadeEnabled,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadRemainingQuota,
  loadAllAccountsUsage,
  ALL_ACCOUNTS_USAGE_DEFAULT,
  saveAllAccountsUsage,
  subscribeAllAccountsUsage,
  keybindingPressed,
  matchCustomKeybinding,
  loadQuickComposerShortcut,
  loadTabAnimationsEnabled,
  NOTES_ENABLED_DEFAULT,
  REMAINING_QUOTA_DEFAULT,
  saveComposerRunner,
  saveCompactModelLabels,
  saveDetailedContext,
  saveComposerEffortVisible,
  saveAutosave,
  saveCollapsedProjectRailMode,
  saveModelControls,
  saveDiffViewer,
  saveFormatOnSave,
  saveFileTabMode,
  saveFollowUpBehavior,
  saveGridArcadeEnabled,
  saveLiveAgentsEnabled,
  saveNotesEnabled,
  saveRemainingQuota,
  SETTINGS_SECTIONS,
  settingsSectionDescription,
  settingsSectionLabel,
  subscribeDetailedContext,
  subscribeFollowUpBehavior,
  subscribeRemainingQuota,
  subscribeCompactModelLabels,
  AI_HELPER_CHANGE_EVENT,
  loadAiHelperSettings,
  parseAiHelperSettings,
  saveAiHelperSettings,
  saveKeybindingOverride,
  type KeybindingOverride,
  saveQuickComposerShortcut,
  saveTabAnimationsEnabled,
} from "./settings";
import { IS_MAC, IS_WIN, MOD, SHIFT } from "../../../platform/tauri/platform";

const KEY = "monocode.composerRunner";
const MODEL_CONTROLS_KEY = "monocode.modelControls";
const LEGACY_EFFORT_VISIBLE_KEY = "monocode.composerEffortVisible";
const NOTES_KEY = "monocode.notesEnabled";
const KEYBINDING_OVERRIDES_KEY = "monocode.keybindingOverrides";
const QUICK_COMPOSER_SHORTCUT_KEY = "monocode.quickComposerShortcut";
const LIVE_AGENTS_KEY = "monocode.liveAgentsEnabled";
const GRID_ARCADE_KEY = "monocode.gridArcadeEnabled";
const DIFF_VIEWER_KEY = "monocode.diffViewer";
const FORMAT_ON_SAVE_KEY = "monocode.formatOnSave";
const AUTOSAVE_KEY = "monocode.autosave";
const FILE_TAB_MODE_KEY = "monocode.fileTabMode";
const FOLLOW_UP_BEHAVIOR_KEY = "monocode.followUpBehavior";
const DETAILED_CONTEXT_KEY = "monocode.detailedContext";
const REMAINING_QUOTA_KEY = "monocode.remainingQuota";
const COMPACT_MODEL_LABELS_KEY = "monocode.compactModelLabels";
const ALL_ACCOUNTS_USAGE_KEY = "monocode.allAccountsUsage";
const TAB_ANIMATIONS_KEY = "monocode.tabAnimationsEnabled";
const COLLAPSED_PROJECT_RAIL_MODE_KEY = "monocode.collapsedProjectRailMode";
const AI_HELPER_KEY = "monocode.aiHelper";

describe("AI helper setting", () => {
  beforeEach(mockLocalStorage);

  it("defaults invalid and malformed preferences to automatic", () => {
    expect(parseAiHelperSettings(null)).toEqual({ mode: "automatic" });
    expect(parseAiHelperSettings("x")).toEqual({ mode: "automatic" });
    expect(parseAiHelperSettings({ mode: "other" })).toEqual({
      mode: "automatic",
    });
    expect(
      parseAiHelperSettings({ mode: "custom", primary: { provider: "cursor" } }),
    ).toEqual({ mode: "automatic" });
    expect(
      parseAiHelperSettings({
        mode: "custom",
        primary: { provider: "opencode", accountId: "account-a" },
      }),
    ).toEqual({ mode: "automatic" });
    localStorage.setItem(AI_HELPER_KEY, "{");
    expect(loadAiHelperSettings()).toEqual({ mode: "automatic" });
  });

  it("drops invalid and duplicate fallbacks", () => {
    expect(
      parseAiHelperSettings({
        mode: "custom",
        primary: { provider: "codex", model: "gpt-5.5" },
        fallback: {
          provider: "codex",
          accountId: "default",
          model: "gpt-5.5",
        },
      }),
    ).toEqual({
      mode: "custom",
      primary: { provider: "codex", model: "gpt-5.5" },
      fallback: null,
    });
    expect(
      parseAiHelperSettings({
        mode: "custom",
        primary: { provider: "claude" },
        fallback: { provider: "grok" },
      }),
    ).toEqual({
      mode: "custom",
      primary: { provider: "claude" },
      fallback: null,
    });
  });

  it("rejects overlong models and persists changes with event detail", () => {
    expect(
      parseAiHelperSettings({
        mode: "custom",
        primary: { provider: "opencode", model: ` ${"x".repeat(201)} ` },
      }),
    ).toEqual({ mode: "automatic" });

    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      const next = {
        mode: "custom",
        primary: { provider: "codex", accountId: "work", model: "gpt-5.5" },
        fallback: { provider: "claude", model: "sonnet" },
      } as const;
      const listener = vi.fn((event: Event) => {
        expect((event as CustomEvent).detail).toEqual(next);
      });
      target.addEventListener(AI_HELPER_CHANGE_EVENT, listener);
      saveAiHelperSettings(next);
      expect(localStorage.getItem(AI_HELPER_KEY)).toBe(JSON.stringify(next));
      expect(loadAiHelperSettings()).toEqual(next);
      expect(listener).toHaveBeenCalledTimes(1);
      target.removeEventListener(AI_HELPER_CHANGE_EVENT, listener);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("follow-up behavior setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FOLLOW_UP_BEHAVIOR_KEY);
  });

  it("defaults to steer", () => {
    expect(FOLLOW_UP_BEHAVIOR_DEFAULT).toBe("steer");
    expect(loadFollowUpBehavior()).toBe("steer");
  });

  it("persists queue behavior", () => {
    saveFollowUpBehavior("queue");
    expect(loadFollowUpBehavior()).toBe("queue");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, "interrupt");
    expect(loadFollowUpBehavior()).toBe("steer");
  });

  it("safely falls back when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage quota exceeded");
        },
        setItem: () => {
          throw new Error("storage quota exceeded");
        },
        removeItem: () => {},
      },
      configurable: true,
    });
    expect(loadFollowUpBehavior()).toBe("steer");
    expect(() => saveFollowUpBehavior("queue")).not.toThrow();
  });

  it("notifies subscribers when setting changes and cleans up", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      let callCount = 0;
      const unsubscribe = subscribeFollowUpBehavior(() => {
        callCount++;
      });

      saveFollowUpBehavior("queue");
      expect(callCount).toBe(1);

      saveFollowUpBehavior("steer");
      expect(callCount).toBe(2);

      unsubscribe();
      saveFollowUpBehavior("queue");
      expect(callCount).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("composer runner setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to on", () => {
    expect(COMPOSER_RUNNER_DEFAULT).toBe(true);
    expect(loadComposerRunner()).toBe(true);
  });

  it("persists an off switch", () => {
    saveComposerRunner(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(loadComposerRunner()).toBe(false);
    saveComposerRunner(true);
    expect(loadComposerRunner()).toBe(true);
  });
});

describe("model controls setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(MODEL_CONTROLS_KEY);
    localStorage.removeItem(LEGACY_EFFORT_VISIBLE_KEY);
  });

  it("keeps options in the model menu by default", () => {
    expect(MODEL_CONTROLS_DEFAULT).toBe("menu");
    expect(loadModelControls()).toBe("menu");
  });

  it("persists the beside-picker preference", () => {
    saveModelControls("beside");
    expect(localStorage.getItem(MODEL_CONTROLS_KEY)).toBe("beside");
    expect(loadModelControls()).toBe("beside");
    saveModelControls("menu");
    expect(loadModelControls()).toBe("menu");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(MODEL_CONTROLS_KEY, "everywhere");
    expect(loadModelControls()).toBe("menu");
  });

  it("migrates the previous effort-control toggle", () => {
    localStorage.setItem(LEGACY_EFFORT_VISIBLE_KEY, "1");
    expect(loadModelControls()).toBe("beside");
    localStorage.setItem(LEGACY_EFFORT_VISIBLE_KEY, "0");
    localStorage.removeItem(MODEL_CONTROLS_KEY);
    expect(loadModelControls()).toBe("menu");
  });
});

describe("notes enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(NOTES_KEY);
  });

  it("defaults to on", () => {
    expect(NOTES_ENABLED_DEFAULT).toBe(true);
    expect(loadNotesEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveNotesEnabled(false);
    expect(localStorage.getItem(NOTES_KEY)).toBe("0");
    expect(loadNotesEnabled()).toBe(false);
    saveNotesEnabled(true);
    expect(loadNotesEnabled()).toBe(true);
  });
});

describe("keybinding overrides", () => {
  beforeEach(mockLocalStorage);

  const key = (
    code: string,
    modifiers: Partial<{
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
    }> = {},
  ) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });

  it("persists a custom shortcut and matches only that combination", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+Shift+KeyM" });
    expect(localStorage.getItem(KEYBINDING_OVERRIDES_KEY)).toBe(
      '{"App: Search":{"shortcut":"Command+Shift+KeyM"}}',
    );
    expect(
      keybindingPressed(
        "App: Search",
        key("KeyM", { metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe(true);
    expect(
      keybindingPressed("App: Search", key("KeyK", { metaKey: true }), true),
    ).toBe(false);
    expect(
      matchCustomKeybinding(key("KeyM", { metaKey: true, shiftKey: true })),
    ).toBe("App: Search");

    saveKeybindingOverride("App: Search", {});
    expect(localStorage.getItem(KEYBINDING_OVERRIDES_KEY)).toBeNull();
  });

  it("matches real keyboard events whose modifiers are prototype accessors", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Control+Shift+KeyM" });
    // Browsers define metaKey/ctrlKey/altKey/shiftKey on KeyboardEvent.prototype,
    // so they are not own properties and must be read, never spread.
    const prototyped = Object.create({
      code: "KeyM",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
    }) as Parameters<typeof keybindingPressed>[1];

    expect(keybindingPressed("App: Search", prototyped, false)).toBe(true);
    expect(matchCustomKeybinding(prototyped)).toBe("App: Search");
  });

  it("serves a cached value without letting callers mutate it", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+KeyY" });
    const first = loadKeybindingOverrides();
    (first as Record<string, KeybindingOverride>)["App: Go to File"] = {
      disabled: true,
    };
    expect(loadKeybindingOverrides()["App: Go to File"]).toBeUndefined();
  });

  it("disables a shortcut and restores the default", () => {
    saveKeybindingOverride("App: Search", { disabled: true });
    expect(loadKeybindingOverrides()).toEqual({
      "App: Search": { disabled: true },
    });
    expect(
      keybindingPressed("App: Search", key("KeyK", { metaKey: true }), true),
    ).toBe(false);
  });

  it("rejects a shortcut already used by another command", () => {
    saveKeybindingOverride("App: Search", { shortcut: "Command+KeyY" });
    expect(() =>
      saveKeybindingOverride("App: Go to File", { shortcut: "Command+KeyY" }),
    ).toThrow("Already used by App: Search");
  });

  it("rejects a shortcut that shadows another command's default", () => {
    // `App: Go to File` is bound to the platform modifier, so hardcoding
    // Control here clashes with nothing on macOS and the assertion passes
    // vacuously.
    const mod = IS_MAC ? "Command" : "Control";
    expect(() =>
      saveKeybindingOverride("App: Search", { shortcut: `${mod}+KeyP` }),
    ).toThrow("Already used by App: Go to File");
    expect(() =>
      saveKeybindingOverride("Tab: New", { shortcut: "Control+Tab" }),
    ).toThrow("Already used by Tab: Cycle Next");
  });

  it("protects every chord in the grouped tab activation range", () => {
    const mod = IS_MAC ? "Command" : "Control";
    for (const digit of [1, 4, 8]) {
      expect(() =>
        saveKeybindingOverride("App: Search", {
          shortcut: `${mod}+Digit${digit}`,
        }),
      ).toThrow("Already used by Tab: Activate 1–8");
    }
  });

  it("rejects a chord the command cannot use and invalid chords", () => {
    expect(() =>
      saveKeybindingOverride("Tab: Activate 1–8", { shortcut: "Control+KeyM" }),
    ).toThrow("needs a number key");
    expect(() =>
      saveKeybindingOverride("App: Search", { shortcut: "KeyK" }),
    ).toThrow("not a valid shortcut");
  });

  it("normalises modifier order when reading stored shortcuts", () => {
    localStorage.setItem(
      KEYBINDING_OVERRIDES_KEY,
      JSON.stringify({ "App: Search": { shortcut: "Shift+Command+KeyM" } }),
    );
    expect(loadKeybindingOverrides()).toEqual({
      "App: Search": { shortcut: "Command+Shift+KeyM" },
    });
  });

  it("ignores malformed, unknown, and invalid stored overrides", () => {
    localStorage.setItem(
      KEYBINDING_OVERRIDES_KEY,
      JSON.stringify({
        "Unknown: Command": { disabled: true },
        "App: Search": { shortcut: "KeyK" },
        "Tab: New": { shortcut: "Command+KeyT" },
      }),
    );
    expect(loadKeybindingOverrides()).toEqual({
      "Tab: New": { shortcut: "Command+KeyT" },
    });
    localStorage.setItem(KEYBINDING_OVERRIDES_KEY, "not-json");
    expect(loadKeybindingOverrides()).toEqual({});
  });
});

describe("quick composer shortcut setting", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the existing shortcut and persists a custom binding", () => {
    expect(loadQuickComposerShortcut()).toBe(
      IS_WIN ? "Control+Shift+Space" : "Command+Shift+Space",
    );
    saveQuickComposerShortcut("Command+Option+KeyK");
    expect(localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY)).toBe(
      "Command+Option+KeyK",
    );
    expect(loadQuickComposerShortcut()).toBe("Command+Option+KeyK");
  });

  it("ignores malformed stored bindings", () => {
    localStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, "Shift+Space");
    expect(loadQuickComposerShortcut()).toBe(
      IS_WIN ? "Control+Shift+Space" : "Command+Shift+Space",
    );
  });
});

describe("live agents enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(LIVE_AGENTS_KEY);
  });

  it("defaults to on", () => {
    expect(LIVE_AGENTS_ENABLED_DEFAULT).toBe(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveLiveAgentsEnabled(false);
    expect(localStorage.getItem(LIVE_AGENTS_KEY)).toBe("0");
    expect(loadLiveAgentsEnabled()).toBe(false);
    saveLiveAgentsEnabled(true);
    expect(loadLiveAgentsEnabled()).toBe(true);
  });
});

describe("grid arcade enabled setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(GRID_ARCADE_KEY);
  });

  it("defaults to on", () => {
    expect(GRID_ARCADE_ENABLED_DEFAULT).toBe(true);
    expect(loadGridArcadeEnabled()).toBe(true);
  });

  it("persists an off switch", () => {
    saveGridArcadeEnabled(false);
    expect(localStorage.getItem(GRID_ARCADE_KEY)).toBe("0");
    expect(loadGridArcadeEnabled()).toBe(false);
    saveGridArcadeEnabled(true);
    expect(loadGridArcadeEnabled()).toBe(true);
  });
});

describe("workspace navigation keybindings", () => {
  it("keeps separate shortcuts for the project rail and session sidebar", () => {
    expect(
      KEYBINDINGS.filter((row) =>
        ["App: Toggle Sidebar", "App: Toggle Session Sidebar"].includes(
          row.command,
        ),
      ),
    ).toEqual([
      { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
      {
        command: "App: Toggle Session Sidebar",
        keys: `${MOD}${SHIFT}B`,
        when: "Always",
      },
    ]);
  });
  it("documents the command palette and reload shortcuts", () => {
    expect(
      KEYBINDINGS.filter((row) =>
        ["App: Command Palette", "View: Reload"].includes(row.command),
      ),
    ).toEqual([
      {
        command: "App: Command Palette",
        keys: `${MOD}${SHIFT}P`,
        when: "Always",
      },
      {
        command: "View: Reload",
        keys: `${MOD}${SHIFT}R`,
        when: "Always",
      },
    ]);
  });
  it("documents the draft workspace toggle", () => {
    expect(
      KEYBINDINGS.find((row) => row.command === "Composer: Toggle Workspace"),
    ).toEqual({
      command: "Composer: Toggle Workspace",
      keys: `${MOD}${SHIFT}G`,
      when: "Draft session composer",
    });
  });
  it("documents session and project cycling in the shortcut list", () => {
    const rows = KEYBINDINGS.filter((row) =>
      /^(Session|Project): (Previous|Next)$/.test(row.command),
    );
    expect(rows.map((row) => row.command)).toEqual([
      "Session: Previous",
      "Session: Next",
      "Project: Previous",
      "Project: Next",
    ]);
    expect(
      rows.every(
        (row) => row.when === "!overlay && (!textFocus || emptyComposer)",
      ),
    ).toBe(true);
  });
  it("documents same-tab session switching", () => {
    expect(
      KEYBINDINGS.filter((row) => row.command.includes("in Current Tab")),
    ).toEqual([
      {
        command: "Session: Previous in Current Tab",
        keys: `${MOD}↑`,
        when: "!overlay && (!textFocus || emptyComposer)",
      },
      {
        command: "Session: Next in Current Tab",
        keys: `${MOD}↓`,
        when: "!overlay && (!textFocus || emptyComposer)",
      },
    ]);
  });
});

describe("format on save setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FORMAT_ON_SAVE_KEY);
  });

  it("defaults to on", () => {
    expect(FORMAT_ON_SAVE_DEFAULT).toBe(true);
    expect(loadFormatOnSave()).toBe(true);
  });

  it("persists an off switch", () => {
    saveFormatOnSave(false);
    expect(localStorage.getItem(FORMAT_ON_SAVE_KEY)).toBe("0");
    expect(loadFormatOnSave()).toBe(false);
    saveFormatOnSave(true);
    expect(loadFormatOnSave()).toBe(true);
  });
});

describe("autosave setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(AUTOSAVE_KEY);
  });

  it("defaults to off and persists changes", () => {
    expect(AUTOSAVE_DEFAULT).toBe(false);
    expect(loadAutosave()).toBe(false);
    saveAutosave(true);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBe("1");
    expect(loadAutosave()).toBe(true);
  });
});

describe("diff viewer setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DIFF_VIEWER_KEY);
  });

  it("defaults to the editor layout", () => {
    expect(DIFF_VIEWER_DEFAULT).toBe("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("persists the unified layout", () => {
    saveDiffViewer("unified");
    expect(localStorage.getItem(DIFF_VIEWER_KEY)).toBe("unified");
    expect(loadDiffViewer()).toBe("unified");
    saveDiffViewer("editor");
    expect(loadDiffViewer()).toBe("editor");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(DIFF_VIEWER_KEY, "split");
    expect(loadDiffViewer()).toBe("editor");
  });
});

describe("experimentation section metadata", () => {
  it("registers experimentation as a valid settings section", () => {
    expect(isSettingsSectionId("experimentation")).toBe(true);
    expect(
      SETTINGS_SECTIONS.some((section) => section.id === "experimentation"),
    ).toBe(true);
    expect(settingsSectionLabel("experimentation")).toBe("Experimentation");
    expect(settingsSectionDescription("experimentation")).toBe(
      "Preview features that may change or use estimated data.",
    );
    expect(searchSettings("compact model labels")).toContainEqual(
      expect.objectContaining({
        section: "experimentation",
        settingId: "compact-model-labels",
      }),
    );
  });
});

describe("detailed context setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(DETAILED_CONTEXT_KEY);
  });

  it("defaults to off", () => {
    expect(DETAILED_CONTEXT_DEFAULT).toBe(false);
    expect(loadDetailedContext()).toBe(false);
  });

  it("persists on and off switches", () => {
    saveDetailedContext(true);
    expect(localStorage.getItem(DETAILED_CONTEXT_KEY)).toBe("1");
    expect(loadDetailedContext()).toBe(true);

    saveDetailedContext(false);
    expect(localStorage.getItem(DETAILED_CONTEXT_KEY)).toBe("0");
    expect(loadDetailedContext()).toBe(false);
  });

  it("safely falls back to false for invalid stored values", () => {
    localStorage.setItem(DETAILED_CONTEXT_KEY, "invalid");
    expect(loadDetailedContext()).toBe(false);

    localStorage.setItem(DETAILED_CONTEXT_KEY, "");
    expect(loadDetailedContext()).toBe(false);
  });

  it("safely falls back to false when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage quota exceeded");
        },
        setItem: () => {
          throw new Error("storage quota exceeded");
        },
        removeItem: () => {},
      },
      configurable: true,
    });
    expect(loadDetailedContext()).toBe(false);
    expect(() => saveDetailedContext(true)).not.toThrow();
  });

  it("notifies subscribers when the setting changes", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      let callCount = 0;
      const unsubscribe = subscribeDetailedContext(() => {
        callCount++;
      });

      saveDetailedContext(true);
      expect(callCount).toBe(1);

      saveDetailedContext(false);
      expect(callCount).toBe(2);

      unsubscribe();
      saveDetailedContext(true);
      expect(callCount).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("remaining quota setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(REMAINING_QUOTA_KEY);
  });

  it("defaults to off", () => {
    expect(REMAINING_QUOTA_DEFAULT).toBe(false);
    expect(loadRemainingQuota()).toBe(false);
  });

  it("persists on and off switches", () => {
    saveRemainingQuota(true);
    expect(localStorage.getItem(REMAINING_QUOTA_KEY)).toBe("1");
    expect(loadRemainingQuota()).toBe(true);

    saveRemainingQuota(false);
    expect(localStorage.getItem(REMAINING_QUOTA_KEY)).toBe("0");
    expect(loadRemainingQuota()).toBe(false);
  });

  it("safely falls back to false for invalid stored values", () => {
    localStorage.setItem(REMAINING_QUOTA_KEY, "invalid");
    expect(loadRemainingQuota()).toBe(false);

    localStorage.setItem(REMAINING_QUOTA_KEY, "");
    expect(loadRemainingQuota()).toBe(false);
  });

  it("safely falls back to false when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage access denied");
        },
        setItem: () => {
          throw new Error("storage access denied");
        },
        removeItem: () => {},
      },
      configurable: true,
    });
    expect(loadRemainingQuota()).toBe(false);
    expect(() => saveRemainingQuota(true)).not.toThrow();
  });

  it("notifies subscribers when the setting changes", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      let callCount = 0;
      const unsubscribe = subscribeRemainingQuota(() => {
        callCount++;
      });

      saveRemainingQuota(true);
      expect(callCount).toBe(1);

      saveRemainingQuota(false);
      expect(callCount).toBe(2);

      unsubscribe();
      saveRemainingQuota(true);
      expect(callCount).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

});

describe("all accounts usage setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ALL_ACCOUNTS_USAGE_KEY);
  });

  it("defaults to off", () => {
    expect(ALL_ACCOUNTS_USAGE_DEFAULT).toBe(false);
    expect(loadAllAccountsUsage()).toBe(false);
  });

  it("persists on and off switches", () => {
    saveAllAccountsUsage(true);
    expect(localStorage.getItem(ALL_ACCOUNTS_USAGE_KEY)).toBe("1");
    expect(loadAllAccountsUsage()).toBe(true);

    saveAllAccountsUsage(false);
    expect(localStorage.getItem(ALL_ACCOUNTS_USAGE_KEY)).toBe("0");
    expect(loadAllAccountsUsage()).toBe(false);
  });

  it("is independent of the remaining quota setting", () => {
    saveRemainingQuota(true);
    expect(loadAllAccountsUsage()).toBe(false);
    saveAllAccountsUsage(true);
    saveRemainingQuota(false);
    expect(loadAllAccountsUsage()).toBe(true);
  });

  it("safely falls back to false for invalid stored values", () => {
    localStorage.setItem(ALL_ACCOUNTS_USAGE_KEY, "invalid");
    expect(loadAllAccountsUsage()).toBe(false);
  });

  it("safely falls back to false when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage access denied");
        },
        setItem: () => {
          throw new Error("storage access denied");
        },
        removeItem: () => {},
      },
      configurable: true,
    });
    expect(loadAllAccountsUsage()).toBe(false);
    expect(() => saveAllAccountsUsage(true)).not.toThrow();
  });

  it("notifies subscribers when the setting changes", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      let callCount = 0;
      const unsubscribe = subscribeAllAccountsUsage(() => {
        callCount++;
      });

      saveAllAccountsUsage(true);
      expect(callCount).toBe(1);

      unsubscribe();
      saveAllAccountsUsage(false);
      expect(callCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("compact model labels setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(COMPACT_MODEL_LABELS_KEY);
  });

  it("defaults off and persists its value", () => {
    expect(COMPACT_MODEL_LABELS_DEFAULT).toBe(false);
    expect(loadCompactModelLabels()).toBe(false);
    saveCompactModelLabels(true);
    expect(localStorage.getItem(COMPACT_MODEL_LABELS_KEY)).toBe("1");
    expect(loadCompactModelLabels()).toBe(true);
  });

  it("notifies subscribers when the setting changes", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    try {
      let calls = 0;
      const unsubscribe = subscribeCompactModelLabels(() => calls++);
      saveCompactModelLabels(true);
      saveCompactModelLabels(false);
      expect(calls).toBe(2);
      unsubscribe();
      saveCompactModelLabels(true);
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("file tab mode setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(FILE_TAB_MODE_KEY);
  });

  it("opens files beside chat by default", () => {
    expect(FILE_TAB_MODE_DEFAULT).toBe("pane");
    expect(loadFileTabMode()).toBe("pane");
  });

  it("persists top-level file tabs", () => {
    saveFileTabMode("workspace");
    expect(localStorage.getItem(FILE_TAB_MODE_KEY)).toBe("workspace");
    expect(loadFileTabMode()).toBe("workspace");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(FILE_TAB_MODE_KEY, "window");
    expect(loadFileTabMode()).toBe("pane");
  });
});

describe("tab animations setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(TAB_ANIMATIONS_KEY);
  });

  it("defaults to off", () => {
    expect(TAB_ANIMATIONS_ENABLED_DEFAULT).toBe(false);
    expect(loadTabAnimationsEnabled()).toBe(false);
  });

  it("persists an off switch", () => {
    saveTabAnimationsEnabled(false);
    expect(localStorage.getItem(TAB_ANIMATIONS_KEY)).toBe("0");
    expect(loadTabAnimationsEnabled()).toBe(false);
    saveTabAnimationsEnabled(true);
    expect(loadTabAnimationsEnabled()).toBe(true);
  });
});

describe("collapsed project rail setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(COLLAPSED_PROJECT_RAIL_MODE_KEY);
  });

  it("defaults to the icon rail", () => {
    expect(COLLAPSED_PROJECT_RAIL_MODE_DEFAULT).toBe("compact");
    expect(loadCollapsedProjectRailMode()).toBe("compact");
  });

  it("persists the hidden mode and ignores unknown values", () => {
    saveCollapsedProjectRailMode("hidden");
    expect(localStorage.getItem(COLLAPSED_PROJECT_RAIL_MODE_KEY)).toBe(
      "hidden",
    );
    expect(loadCollapsedProjectRailMode()).toBe("hidden");

    localStorage.setItem(COLLAPSED_PROJECT_RAIL_MODE_KEY, "floating");
    expect(loadCollapsedProjectRailMode()).toBe("compact");
  });
});

describe("settings navigation", () => {
  it("lists every section under exactly one rail group", () => {
    const groups = settingsSectionsByGroup();
    expect(groups.map((group) => group.label)).toEqual([
      "App",
      "Agents",
      "Workspace",
    ]);
    expect(groups.flatMap((group) => group.sections.map((s) => s.id))).toEqual([
      "general",
      "connections",
      "appearance",
      "keybindings",
      "experimentation",
      "chat",
      "providers",
      "mcp",
      "skills",
      "prompts",
      "monos",
      "inbox",
      "archive",
      "worktrees",
      "migration",
    ]);
  });

  it("points every indexed setting at a real section", () => {
    const sections = new Set(
      settingsSectionsByGroup().flatMap((group) =>
        group.sections.map((section) => section.id),
      ),
    );
    for (const entry of SETTINGS_INDEX) {
      expect(sections.has(entry.section), entry.id).toBe(true);
    }
  });
});

describe("settings search", () => {
  it("returns nothing for an empty query", () => {
    expect(searchSettings("   ")).toEqual([]);
  });

  it("ranks label matches over keyword matches, and pages last", () => {
    expect(searchSettings("glass").map((result) => result.label)).toEqual([
      "Glass strength",
      "Main pane glass",
      "Blur radius",
      "Sidebar opacity",
      "Appearance",
    ]);
  });

  it("finds a setting by a word that is not in its label", () => {
    expect(searchSettings("steer")[0]).toMatchObject({
      section: "chat",
      sectionLabel: "Chat",
      settingId: "follow-up",
      label: "Follow-up behavior",
    });

    expect(searchSettings("prettier")[0]).toMatchObject({
      section: "chat",
      settingId: "format-on-save",
      label: "Format on save",
    });

    expect(searchSettings("reuse current").map((result) => result.settingId)).toEqual([
      "file-opening-behavior",
      "session-opening-behavior",
    ]);
  });

  it("returns a whole page with no setting id", () => {
    expect(searchSettings("skills")).toEqual([
      {
        section: "skills",
        sectionLabel: "Skills",
        settingId: null,
        label: "Skills",
      },
    ]);
  });

  it("caps the result list", () => {
    expect(searchSettings("e", 4)).toHaveLength(4);
  });
});
