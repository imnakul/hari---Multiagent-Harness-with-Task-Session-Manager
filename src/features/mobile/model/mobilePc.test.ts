import { describe, expect, it } from "vitest";
import {
  mergePhoneStats,
  parsePhoneApps,
  parsePhoneStats,
  parsePhoneStatsList,
  phoneStatsParts,
} from "./mobilePc";

const GB = 1024 ** 3;

describe("parsePhoneStats", () => {
  it("keeps fields in range and drops the rest", () => {
    expect(
      parsePhoneStats({
        battery: 0.82,
        charging: true,
        temperature: 300,
        storageFree: 41 * GB,
        storageTotal: 128 * GB,
        network: "wifi",
      }),
    ).toEqual({ battery: 0.82, charging: true, storageFree: 41 * GB, storageTotal: 128 * GB, network: "wifi" });
    expect(parsePhoneStats({ battery: 2, network: "5g", storageFree: 9, storageTotal: 3 })).toEqual({});
    expect(parsePhoneStats(null)).toBeUndefined();
  });
});

describe("parsePhoneStatsList", () => {
  it("reads phones that never reported and ones that did", () => {
    expect(
      parsePhoneStatsList({
        phones: [
          { peer: "a", name: "Pixel", at: null, stats: null },
          { peer: "b", name: " ", at: 5, stats: { battery: 0.5 } },
          { name: "no peer" },
        ],
      }),
    ).toEqual([
      { peer: "a", name: "Pixel" },
      { peer: "b", name: "Phone", at: 5, stats: { battery: 0.5 } },
    ]);
    expect(parsePhoneStatsList("x")).toEqual([]);
  });
});

describe("mergePhoneStats", () => {
  it("replaces the same phone and adds a new one", () => {
    const rows = [{ peer: "a", name: "Pixel" }];
    const merged = mergePhoneStats(rows, { peer: "a", name: "Pixel", at: 9, stats: { battery: 0.1 } });
    expect(merged).toEqual([{ peer: "a", name: "Pixel", at: 9, stats: { battery: 0.1 } }]);
    expect(mergePhoneStats(merged, { peer: "b", name: "Tab", at: 1, stats: {} })).toHaveLength(2);
    expect(mergePhoneStats(merged, { peer: "b", name: "Tab" })).toBe(merged);
  });
});

describe("phoneStatsParts", () => {
  it("says battery, heat, storage and network in order", () => {
    expect(
      phoneStatsParts({
        battery: 0.816,
        charging: true,
        temperature: 33.6,
        storageFree: 41 * GB,
        storageTotal: 128 * GB,
        network: "cellular",
      }),
    ).toEqual(["82% · charging", "34 °C", "41 of 128 GB free", "Mobile data"]);
    expect(phoneStatsParts({})).toEqual([]);
  });
});

describe("parsePhoneApps", () => {
  it("skips rows without an id or name", () => {
    expect(
      parsePhoneApps({ apps: [{ id: "self", name: "Hari", detail: "This app" }, { id: "x" }, { id: "y", name: "Y" }] }),
    ).toEqual([
      { id: "self", name: "Hari", detail: "This app" },
      { id: "y", name: "Y", detail: "" },
    ]);
  });
});
