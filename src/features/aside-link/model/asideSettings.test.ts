import { describe, expect, it } from "vitest";
import { parseLinkStatus, parsePort } from "./asideSettings";

const STATUS = {
  enabled: true,
  port: 4518,
  listening: true,
  status: "",
  attached: false,
  projectPath: "C:/app/aside-link/CLI",
};

describe("parseLinkStatus", () => {
  it("accepts the desktop status", () => {
    expect(parseLinkStatus(STATUS)).toEqual(STATUS);
  });

  it("rejects missing or mistyped fields", () => {
    expect(() => parseLinkStatus(null)).toThrow("missing");
    expect(() => parseLinkStatus({ ...STATUS, port: "4518" })).toThrow("port");
    expect(() => parseLinkStatus({ ...STATUS, attached: undefined })).toThrow("attached");
  });
});

describe("parsePort", () => {
  it("allows only unprivileged ports", () => {
    expect(parsePort(" 4518 ")).toBe(4518);
    expect(parsePort("1023")).toBeNull();
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("45a")).toBeNull();
    expect(parsePort("")).toBeNull();
  });
});
