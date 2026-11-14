import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatUptime,
  parsePcApps,
  parsePcShortcuts,
  parsePcStats,
  parseRing,
  parseWakeCards,
  pcError,
  PHONE_STATS_MAX_MS,
  sortPcApps,
  statsWantUntil,
} from "@/features/pc/pcModel";

describe("parsePcStats", () => {
  it("keeps valid fields and drops impossible ones", () => {
    const stats = parsePcStats({
      cpu: 23.5,
      gpu: 140,
      memory: { used: 8, total: 16 },
      disks: [
        { name: "C:", free: 10, total: 100 },
        { name: "D:", free: 200, total: 100 },
        { free: 1, total: 2 },
      ],
      network: { down: 1024 },
      uptime: 3600,
    });
    expect(stats).toEqual({
      cpu: 23.5,
      memory: { used: 8, total: 16 },
      disks: [{ name: "C:", free: 10, total: 100 }],
      network: { down: 1024, up: undefined },
      uptime: 3600,
    });
  });

  it("reads nothing from a malformed answer", () => {
    expect(parsePcStats(null)).toEqual({ disks: [] });
    expect(parsePcStats({ memory: { used: 20, total: 10 } })).toEqual({ disks: [] });
  });
});

describe("parsePcApps and sortPcApps", () => {
  const apps = parsePcApps({
    apps: [
      { pid: 10, identity: "10:1", name: "code.exe", title: "Editor", cpu: 5, memory: 300, self: false },
      { pid: 11, identity: "11:1", name: "chrome.exe", title: "", cpu: 40, memory: 100, protected: true },
      { pid: 12, identity: "12:1", name: "MonoCode.exe", title: "MonoCode", memory: 900, self: true },
      { pid: 0, identity: "0:0", name: "idle" },
      { pid: 13, name: "no-identity.exe" },
    ],
  });

  it("skips rows without pid, identity or name", () => {
    expect(apps.map((app) => app.pid)).toEqual([10, 11, 12]);
    expect(apps[1]?.protected).toBe(true);
    expect(apps[2]?.self).toBe(true);
    expect(apps[2]?.cpu).toBeUndefined();
  });

  it("sorts by CPU (unknown last), memory and name", () => {
    expect(sortPcApps(apps, "cpu").map((app) => app.pid)).toEqual([11, 10, 12]);
    expect(sortPcApps(apps, "memory").map((app) => app.pid)).toEqual([12, 10, 11]);
    expect(sortPcApps(apps, "name").map((app) => app.pid)).toEqual([11, 10, 12]);
  });
});

describe("parsePcShortcuts", () => {
  it("defaults found to true and running to false", () => {
    expect(parsePcShortcuts({ apps: [{ id: "a", name: "Claude" }, { id: "b", name: "Old", found: false }, { name: "x" }] })).toEqual([
      { id: "a", name: "Claude", self: false, found: true, running: false },
      { id: "b", name: "Old", self: false, found: false, running: false },
    ]);
  });
});

describe("parseWakeCards", () => {
  it("keeps cards with a real MAC and IPv4 broadcast", () => {
    expect(
      parseWakeCards({
        cards: [
          { name: "Ethernet", mac: "aa:bb:cc:dd:ee:ff", broadcast: "192.168.1.255" },
          { mac: "00:00:00:00:00:00", broadcast: "192.168.1.255" },
          { mac: "AA:BB:CC:DD:EE:FF", broadcast: "192.168.1.300" },
          { mac: "AA-BB-CC-DD-EE-FF", broadcast: "10.0.0.255" },
          { mac: "11:22:33:44:55:66", broadcast: "10.0.0.255", wifi: true },
        ],
      }),
    ).toEqual([
      { name: "Ethernet", mac: "AA:BB:CC:DD:EE:FF", broadcast: "192.168.1.255", wifi: false },
      { name: "Network card", mac: "11:22:33:44:55:66", broadcast: "10.0.0.255", wifi: true },
    ]);
  });

  it("reads a stored plain list", () => {
    expect(parseWakeCards([{ mac: "11:22:33:44:55:66", broadcast: "10.0.0.255" }])).toHaveLength(1);
  });
});

describe("ring and stats.want", () => {
  const now = 1_000_000_000;

  it("ignores an old or malformed start, but always stops", () => {
    expect(parseRing({ action: "start", at: now - 30_000 }, now)).toBe("start");
    expect(parseRing({ action: "start", at: now - 5 * 60_000 }, now)).toBeNull();
    expect(parseRing({ action: "start" }, now)).toBeNull();
    expect(parseRing({ action: "stop", at: 0 }, now)).toBe("stop");
    expect(parseRing({ action: "explode", at: now }, now)).toBeNull();
  });

  it("clamps how long the phone keeps sending stats", () => {
    expect(statsWantUntil({ until: now + 45_000 }, now)).toBe(now + 45_000);
    expect(statsWantUntil({ until: now + 60 * 60_000 }, now)).toBe(now + PHONE_STATS_MAX_MS);
    expect(statsWantUntil({ until: now - 1 }, now)).toBeNull();
    expect(statsWantUntil({}, now)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats bytes and uptime", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 ** 3)).toBe("20 GB");
    expect(formatUptime(14 * 60)).toBe("14 m");
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe("5 h 12 m");
    expect(formatUptime(3 * 86_400 + 4 * 3600)).toBe("3 d 4 h");
  });

  it("explains an older MonoCode", () => {
    expect(pcError(new Error("Unsupported mobile operation: pc.stats"))).toBe("Update MonoCode on your computer to use this.");
    expect(pcError("Timed out")).toBe("Timed out");
  });
});
