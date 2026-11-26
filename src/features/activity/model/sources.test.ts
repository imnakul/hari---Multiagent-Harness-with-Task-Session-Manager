// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { ActivityLog, ActivityNote, AwSummary } from "./activity";
import {
  ACTIVITY_SOURCES_KEY,
  DEFAULT_SOURCES,
  filterAw,
  filterLog,
  isBrowserApp,
  loadSources,
  saveSources,
  toggleSource,
} from "./sources";

const aw: AwSummary = {
  available: true,
  hasAfk: true,
  activeMs: 1000,
  activeSpans: [],
  apps: [
    { app: "chrome.exe", ms: 5 },
    { app: "Code", ms: 3 },
  ],
  hasWeb: true,
  sites: [{ domain: "a.com", ms: 5, titles: [] }],
  meetings: [{ start: 1, end: 2, label: "Call" }],
  meetingMs: 1,
};

function note(kind: "prompts" | "hourly", id: number): ActivityNote {
  // A minimal note: only the fields the filter reads matter.
  return { id, ts: id, kind } as unknown as ActivityNote;
}

describe("activity sources", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to MonoCode, Browser and Other apps", () => {
    expect(loadSources()).toEqual([...DEFAULT_SOURCES]);
    localStorage.setItem(ACTIVITY_SOURCES_KEY, "{bad");
    expect(loadSources()).toEqual([...DEFAULT_SOURCES]);
    localStorage.setItem(ACTIVITY_SOURCES_KEY, "[]");
    expect(loadSources()).toEqual([...DEFAULT_SOURCES]);
  });

  it("saves and reloads, ignoring unknown names", () => {
    saveSources(["phone", "monocode"]);
    expect(loadSources()).toEqual(["monocode", "phone"]);
  });

  it("keeps at least one source on", () => {
    expect(toggleSource(["phone"], "phone")).toEqual(["phone"]);
    expect(toggleSource(["monocode", "phone"], "phone")).toEqual(["monocode"]);
    expect(toggleSource(["monocode"], "phone")).toEqual(["monocode", "phone"]);
  });

  it("spots browsers by name", () => {
    for (const name of ["chrome.exe", "Chrome", "msedge", "Firefox", "brave", "Zen", "Google Chrome"]) {
      expect(isBrowserApp(name)).toBe(true);
    }
    for (const name of ["Code", "archive", "explorer.exe", "Zendesk"]) {
      expect(isBrowserApp(name)).toBe(false);
    }
  });

  it("splits ActivityWatch rows between Browser and Other apps", () => {
    const onlyBrowser = filterAw(aw, ["browser"]);
    expect(onlyBrowser.apps.map((row) => row.app)).toEqual(["chrome.exe"]);
    expect(onlyBrowser.sites).toHaveLength(1);
    expect(onlyBrowser.meetings).toEqual([]);
    const onlyOther = filterAw(aw, ["other"]);
    expect(onlyOther.apps.map((row) => row.app)).toEqual(["Code"]);
    expect(onlyOther.sites).toEqual([]);
    expect(onlyOther.meetingMs).toBe(1);
  });

  it("filters the log: events and prompt notes by MonoCode, hourly notes by desktop sources", () => {
    const log: ActivityLog = {
      events: [{ id: 1 } as unknown as ActivityLog["events"][number]],
      notes: [note("prompts", 1), note("hourly", 2)],
    };
    expect(filterLog(log, ["monocode"]).notes.map((n) => n.id)).toEqual([1]);
    expect(filterLog(log, ["browser"]).notes.map((n) => n.id)).toEqual([2]);
    expect(filterLog(log, ["browser"]).events).toEqual([]);
    expect(filterLog(log, ["phone"]).notes).toEqual([]);
    expect(filterLog(log, ["monocode", "other"]).notes).toHaveLength(2);
  });
});
