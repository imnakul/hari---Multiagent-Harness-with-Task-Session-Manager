import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsNav } from "../../../app/shell/SettingsRail";
import { SettingsView } from "../../settings/ui/SettingsView";
import {
  ALL_ACCOUNTS_USAGE_DEFAULT,
  saveAllAccountsUsage,
  COMPACT_MODEL_LABELS_DEFAULT,
  DETAILED_CONTEXT_DEFAULT,
  REMAINING_QUOTA_DEFAULT,
  saveCompactModelLabels,
  saveDetailedContext,
  saveRemainingQuota,
} from "../../settings/model/settings";

function mockLocalStorage(): void {
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

describe("SettingsRail with Experimentation", () => {
  it("renders Experimentation navigation item with its label and icon", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsNav, {
        section: "experimentation",
        onSelect: () => {},
        onClose: () => {},
      }),
    );

    expect(markup).toContain("Experimentation");
    expect(markup).toContain("<svg");
  });
});

describe("SettingsView Experimentation Page", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem("monocode.detailedContext");
    localStorage.removeItem("monocode.remainingQuota");
    localStorage.removeItem("monocode.compactModelLabels");
    localStorage.removeItem("monocode.allAccountsUsage");
  });

  it("renders section header and exact copy for the experimental toggles", () => {
    const markup = renderToStaticMarkup(
      createElement(SettingsView, {
        section: "experimentation",
        cwd: "E:/test",
        sessions: [],
        onClose: () => {},
        onOpenSession: () => {},
        onArchiveSession: () => {},
        onDeleteSession: () => {},
      }),
    );

    // Section header
    expect(markup).toContain("Experimentation");
    expect(markup).toContain(
      "Preview features that may change or use estimated data.",
    );

    // Detailed context row
    expect(markup).toContain("Detailed context");
    expect(markup).toContain(
      "Show the full context inspector with usage breakdowns, quota, costing, skills, and System &amp; Tools details. Values are estimated and might not be fully accurate yet.",
    );

    // Remaining quota row
    expect(markup).toContain("Remaining quota");
    expect(markup).toContain(
      "Show plan limits as quota remaining—for example, 42% left—instead of quota already used.",
    );

    expect(markup).toContain("Compact model labels");
    expect(markup).toContain(
      "Show each compact sidebar thread’s model, including the model handling its active turn when it differs from the next-turn selection.",
    );
  });

  it("defaults all switches to OFF and exposes switch semantics", () => {
    expect(DETAILED_CONTEXT_DEFAULT).toBe(false);
    expect(REMAINING_QUOTA_DEFAULT).toBe(false);
    expect(COMPACT_MODEL_LABELS_DEFAULT).toBe(false);

    const markup = renderToStaticMarkup(
      createElement(SettingsView, {
        section: "experimentation",
        cwd: "E:/test",
        sessions: [],
        onClose: () => {},
        onOpenSession: () => {},
        onArchiveSession: () => {},
        onDeleteSession: () => {},
      }),
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-label="Detailed context"');
    expect(markup).toContain('aria-label="Remaining quota"');
    expect(markup).toContain('aria-label="Compact model labels"');
    // All three are off by default: aria-checked should be "false".
    const checkedMatches = markup.match(/aria-checked="false"/g);
    expect(checkedMatches?.length).toBeGreaterThanOrEqual(3);
  });

  it("lists the All accounts usage switch, off by default", () => {
    expect(ALL_ACCOUNTS_USAGE_DEFAULT).toBe(false);
    const props = {
      section: "experimentation" as const,
      cwd: "E:/test",
      sessions: [],
      onClose: () => {},
      onOpenSession: () => {},
      onArchiveSession: () => {},
      onDeleteSession: () => {},
    };
    const off = renderToStaticMarkup(createElement(SettingsView, props));
    expect(off).toContain("All accounts usage");
    expect(off).toMatch(
      /aria-label="All accounts usage"[^>]*aria-checked="false"|aria-checked="false"[^>]*aria-label="All accounts usage"/,
    );

    saveAllAccountsUsage(true);
    const on = renderToStaticMarkup(createElement(SettingsView, props));
    expect(on).toMatch(
      /aria-label="All accounts usage"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="All accounts usage"/,
    );
  });

  it("reflects ON switch semantics when values are saved", () => {
    saveDetailedContext(true);
    saveRemainingQuota(true);
    saveCompactModelLabels(true);

    const markup = renderToStaticMarkup(
      createElement(SettingsView, {
        section: "experimentation",
        cwd: "E:/test",
        sessions: [],
        onClose: () => {},
        onOpenSession: () => {},
        onArchiveSession: () => {},
        onDeleteSession: () => {},
      }),
    );

    const checkedMatches = markup.match(/aria-checked="true"/g);
    expect(checkedMatches?.length).toBeGreaterThanOrEqual(3);
  });
});
