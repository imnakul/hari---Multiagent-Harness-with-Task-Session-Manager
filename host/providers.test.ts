import { expect, it } from "vitest";
import {
  REMOTE_PROVIDERS,
  isRemoteProvider,
  requireHostDescriptor,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import { hostProviders } from "./providers";
import { HARNESSES } from "../src/features/sessions/model/session";

it("exposes supported harnesses through the host and rejects desktop-only Antigravity CLI", () => {
  expect(Object.keys(hostProviders).sort()).toEqual(
    [...REMOTE_PROVIDERS].sort(),
  );
  // The CLI path needs its local native bridge; ACP remains remotely supported.
  expect([...REMOTE_PROVIDERS].sort()).toEqual(
    HARNESSES.filter((provider) => provider !== "antigravity-cli").sort(),
  );
  expect(isRemoteProvider("antigravity-cli")).toBe(false);
  expect(() => requireHostDescriptor({
    protocolVersion: 1,
    environmentId: "host",
    name: "fixture",
    providers: ["antigravity-cli" as RemoteProvider],
    capabilities: [],
  })).toThrow("incompatible MonoCode Host");
  for (const provider of REMOTE_PROVIDERS) {
    expect(isRemoteProvider(provider)).toBe(true);
    expect(hostProviders[provider].send).toBeTypeOf("function");
    expect(hostProviders[provider].cancel).toBeTypeOf("function");
    expect(hostProviders[provider].bind).toBeTypeOf("function");
    expect(hostProviders[provider].approve).toBeTypeOf("function");
  }
  expect(
    requireHostDescriptor({
      protocolVersion: 1,
      environmentId: "host",
      name: "fixture",
      providers: [...REMOTE_PROVIDERS],
      capabilities: [],
    }).providers,
  ).toHaveLength(REMOTE_PROVIDERS.length);
});
