// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { McpSettings } from "./McpSettings";
import { clearMcpSettingsCache } from "../model/mcpSettingsCache";

const invoke = vi.fn();
const ask = vi.fn(async () => true);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearMcpSettingsCache();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude",
            name: "sentry",
            scope: "user",
            configPath: "/home/.claude.json",
            transport: "http",
          },
          {
            provider: "codex",
            name: "docs",
            scope: "user",
            configPath: "/home/.codex/config.toml",
            transport: "http",
          },
        ]
      : command === "claude_mcp_list"
        ? "sentry: https://mcp.example.com - ! Needs authentication"
        : undefined,
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMcpSettingsCache();
  container.remove();
  vi.unstubAllGlobals();
});

async function selectProject(path: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label^="Switch project"]')!
      .click(),
  );
  expect(
    document.querySelector('input[placeholder="Search projects..."]'),
  ).not.toBeNull();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>(
        `[role="dialog"] button[title="${path}"]`,
      )!
      .click(),
  );
}

it("lists servers and routes sign in through Claude MCP", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).toContain("Needs authentication");
  expect(container.textContent).toContain("Codex");
  const signIn = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Sign in",
  )!;
  await act(async () => signIn.click());
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/repo",
    provider: "claude",
    name: "sentry",
  });
});

it("toggles configured duplicate server rows by their full identity", async () => {
  const userServer = {
    provider: "claude",
    name: "docs",
    scope: "user",
    configPath: "/home/.claude.json",
    transport: "stdio",
    enabled: true,
  };
  const projectServer = {
    provider: "claude",
    name: "docs",
    scope: "project",
    configPath: "/repo/.mcp.json",
    transport: "stdio",
    enabled: false,
  };
  let configured = [userServer, projectServer];
  invoke.mockImplementation(
    async (command: string, args: Record<string, string>) => {
      if (command === "mcp_discover") return configured;
      if (command === "claude_mcp_list") return "";
      if (command === "mcp_set_enabled") {
        configured = configured.map((server) =>
          server.scope === args.scope && server.configPath === args.configPath
            ? { ...server, enabled: args.enabled as unknown as boolean }
            : server,
        );
        return undefined;
      }
      return undefined;
    },
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const userToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Claude Code, user, /home/.claude.json)"]',
  )!;
  const projectToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Claude Code, project, /repo/.mcp.json)"]',
  )!;
  expect(userToggle.getAttribute("aria-checked")).toBe("true");
  expect(projectToggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => userToggle.click());
  expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", {
    cwd: "/repo",
    provider: "claude",
    scope: "user",
    configPath: "/home/.claude.json",
    name: "docs",
    enabled: false,
  });
  expect(
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label$="docs (Claude Code, user, /home/.claude.json)"]',
      )
      ?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label$="docs (Claude Code, project, /repo/.mcp.json)"]',
      )
      ?.getAttribute("aria-checked"),
  ).toBe("false");
});

it("keeps a failed server toggle local to the matching duplicate row", async () => {
  const rows = [
    {
      provider: "codex",
      name: "docs",
      scope: "user",
      configPath: "/home/.codex/config.toml",
      transport: "stdio",
      enabled: true,
    },
    {
      provider: "codex",
      name: "docs",
      scope: "project",
      configPath: "/repo/.codex/config.toml",
      transport: "stdio",
      enabled: true,
    },
  ];
  const discover = vi.fn(async () => rows);
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") return discover();
    if (command === "mcp_set_enabled") throw new Error("Config is read-only");
    if (command === "claude_mcp_list") return "";
    return undefined;
  });
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const projectToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Codex, project, /repo/.codex/config.toml)"]',
  )!;
  const userToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Codex, user, /home/.codex/config.toml)"]',
  )!;
  await act(async () => projectToggle.click());
  expect(discover).toHaveBeenCalledTimes(1);
  const alerts = [...container.querySelectorAll<HTMLElement>('[role="alert"]')];
  expect(alerts).toHaveLength(1);
  expect(alerts[0].textContent).toContain("Config is read-only");
  const projectRow = [
    ...container.querySelectorAll(".overflow-hidden > div"),
  ].find((row) => row.textContent?.includes("/repo/.codex/config.toml"));
  const userRow = [
    ...container.querySelectorAll(".overflow-hidden > div"),
  ].find((row) => row.textContent?.includes("/home/.codex/config.toml"));
  expect(projectRow?.querySelector('[role="alert"]')).not.toBeNull();
  expect(userRow?.querySelector('[role="alert"]')).toBeNull();
  expect(projectToggle.getAttribute("aria-checked")).toBe("true");
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const playwright = {
  provider: "claude",
  name: "playwright",
  scope: "user",
  configPath: "/home/.claude.json",
  transport: "stdio",
  enabled: true,
};

function playwrightRow(): HTMLElement {
  return container.querySelector<HTMLElement>("[data-mcp-enabled]")!;
}

function playwrightSwitch(): HTMLButtonElement {
  return playwrightRow().querySelector<HTMLButtonElement>('[role="switch"]')!;
}

it("labels each switch by its state and mutes disabled servers", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [playwright, { ...playwright, name: "docs", enabled: false }]
      : command === "claude_mcp_list"
        ? ""
        : undefined,
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const rows = [
    ...container.querySelectorAll<HTMLElement>("[data-mcp-enabled]"),
  ];
  const on = rows.find((row) => row.dataset.mcpEnabled === "true")!;
  const off = rows.find((row) => row.dataset.mcpEnabled === "false")!;
  expect(on.textContent).toContain("playwright");
  expect(on.textContent).toContain("On");
  expect(on.textContent).not.toContain("Off");
  expect(
    on.querySelector('[role="switch"]')!.getAttribute("aria-label"),
  ).toMatch(/^Disable playwright /);
  expect(
    on.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("true");
  expect(off.textContent).toContain("Off");
  expect(
    off.querySelector('[role="switch"]')!.getAttribute("aria-label"),
  ).toMatch(/^Enable docs /);
  expect(off.querySelector(".text-content\\/45")?.textContent).toBe("docs");
  expect(on.querySelector(".text-content\\/45")?.textContent).not.toBe(
    "playwright",
  );
  expect(off.textContent).toContain("Disabled");
});

it("flips a switch in place without replacing the list or showing the loading state", async () => {
  let enabled = true;
  const write = deferred();
  const rediscover = deferred();
  let discoveries = 0;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") {
      discoveries += 1;
      if (discoveries > 1) await rediscover.promise;
      return [{ ...playwright, enabled }];
    }
    if (command === "mcp_set_enabled") {
      await write.promise;
      enabled = false;
      return undefined;
    }
    return command === "claude_mcp_list" ? "" : undefined;
  });
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const row = playwrightRow();
  await act(async () => playwrightSwitch().click());
  // Requested state and a per-row pending marker, never the page loading state.
  expect(container.textContent).not.toContain("Checking servers");
  expect(playwrightRow()).toBe(row);
  expect(row.dataset.mcpEnabled).toBe("false");
  expect(row.textContent).toContain("Saving…");
  expect(playwrightSwitch().disabled).toBe(true);
  await act(async () => write.resolve());
  // The background refresh is still running: the row keeps the new state.
  expect(container.textContent).not.toContain("Checking servers");
  expect(playwrightRow()).toBe(row);
  expect(row.dataset.mcpEnabled).toBe("false");
  expect(row.textContent).toContain("Off");
  await act(async () => rediscover.resolve());
  expect(container.textContent).not.toContain("Checking servers");
  expect(playwrightRow()).toBe(row);
  expect(row.dataset.mcpEnabled).toBe("false");
  expect(row.textContent).toContain("Disabled");
  expect(playwrightSwitch().getAttribute("aria-label")).toMatch(
    /^Enable playwright /,
  );
  expect(playwrightSwitch().disabled).toBe(false);
});

it("reverts only that row and shows its error when the change fails", async () => {
  const write = deferred();
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover") return [playwright];
    if (command === "mcp_set_enabled") return write.promise;
    return command === "claude_mcp_list" ? "" : undefined;
  });
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const row = playwrightRow();
  await act(async () => playwrightSwitch().click());
  expect(row.dataset.mcpEnabled).toBe("false");
  await act(async () => write.reject(new Error("Config is read-only")));
  expect(container.textContent).not.toContain("Checking servers");
  expect(playwrightRow()).toBe(row);
  expect(row.dataset.mcpEnabled).toBe("true");
  expect(row.textContent).toContain("On");
  expect(row.querySelector('[role="alert"]')?.textContent).toContain(
    "Config is read-only",
  );
  expect(playwrightSwitch().getAttribute("aria-checked")).toBe("true");
  expect(playwrightSwitch().disabled).toBe(false);
});

it("refreshes user-scope enablement when switching to another project", async () => {
  let enabled = true;
  invoke.mockImplementation(async (command: string) => {
    if (command === "mcp_discover")
      return [
        {
          provider: "codex",
          name: "docs",
          scope: "user",
          configPath: "/home/.codex/config.toml",
          transport: "stdio",
          enabled,
        },
      ];
    if (command === "mcp_set_enabled") {
      enabled = false;
      return undefined;
    }
    if (command === "claude_mcp_list") return "";
    return undefined;
  });
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "/repo",
        recents: [{ path: "/other", openedAt: 1 }],
      }),
    ),
  );
  const repoToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Codex, user, /home/.codex/config.toml)"]',
  )!;
  expect(repoToggle.getAttribute("aria-checked")).toBe("true");
  await act(async () => repoToggle.click());
  expect(
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label$="docs (Codex, user, /home/.codex/config.toml)"]',
      )
      ?.getAttribute("aria-checked"),
  ).toBe("false");
  await selectProject("/other");
  const otherToggle = container.querySelector<HTMLButtonElement>(
    '[aria-label$="docs (Codex, user, /home/.codex/config.toml)"]',
  )!;
  expect(otherToggle.getAttribute("aria-checked")).toBe("false");
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "/other" });
});

it("shows unavailable controls without implying support for Claude Desktop or Cursor", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude_desktop",
            name: "desktop-docs",
            scope: "user",
            configPath: "/home/Claude/claude_desktop_config.json",
            transport: "stdio",
            enabled: true,
          },
          {
            provider: "cursor",
            name: "cursor-docs",
            scope: "project",
            configPath: "/repo/.cursor/mcp.json",
            transport: "stdio",
            enabled: true,
          },
        ]
      : "",
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(0);
  expect(container.textContent).toContain(
    "Enable control unavailable for Claude Desktop",
  );
  expect(container.textContent).toContain(
    "Enable control unavailable for Cursor",
  );
});

it("filters connections by provider", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const codex = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Codex"),
  )!;
  await act(async () => codex.click());
  expect(container.textContent).toContain("docs");
  expect(container.textContent).not.toContain("sentry");
  const signIn = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Sign in",
  )!;
  await act(async () => signIn.click());
  expect(invoke).toHaveBeenCalledWith("mcp_provider_login", {
    cwd: "/repo",
    provider: "codex",
    name: "docs",
  });
});

it("shows configured rows while Claude health is still pending", async () => {
  let resolveHealth!: (output: string) => void;
  const discovery = invoke.getMockImplementation()!;
  invoke.mockImplementation((command: string, args: unknown) =>
    command === "claude_mcp_list"
      ? new Promise((resolve) => {
          resolveHealth = resolve;
        })
      : discovery(command, args),
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  expect(container.textContent).toContain("docs");
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Checking servers…");
  await act(async () =>
    resolveHealth("sentry: https://example.com - Needs authentication"),
  );
  expect(container.textContent).toContain("Needs authentication");
});

it("adds a standard mcpServers entry to the selected provider and project", async () => {
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "/repo",
        recents: [{ path: "/other", openedAt: 1 }],
      }),
    ),
  );
  await selectProject("/other");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Add MCP server"]')!
      .click(),
  );
  expect(document.body.textContent).toContain("Add MCP server");
  const provider = document.body.querySelector<HTMLButtonElement>(
    '[aria-label="Provider: Claude Code"]',
  )!;
  await act(async () => provider.click());
  const cursor = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent === "Cursor")!;
  await act(async () => cursor.click());
  const config = document.body.querySelector<HTMLTextAreaElement>("textarea")!;
  const json =
    '{"mcpServers":{"new-server":{"command":"npx","args":["example"]}}}';
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(config, json);
    config.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    document.body
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(invoke).toHaveBeenCalledWith("mcp_add", {
    cwd: "/other",
    provider: "cursor",
    name: "",
    config: json,
    scope: "project",
  });
  expect(invoke).toHaveBeenLastCalledWith("claude_mcp_list", { cwd: "/other" });
});

it("offers Antigravity CLI when adding a server", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo", recents: [] })),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Add MCP server"]')!
      .click(),
  );
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[aria-label="Provider: Claude Code"]')!
      .click(),
  );
  const antigravity = [
    ...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent === "Antigravity CLI");
  expect(antigravity).toBeDefined();
  await act(async () => antigravity!.click());
  expect(
    document.body.querySelector('[aria-label="Scope: Project"]'),
  ).not.toBeNull();
});

it("navigates provider choices with arrow keys", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Add MCP server"]')!
      .click(),
  );
  await act(async () =>
    document.body
      .querySelector<HTMLButtonElement>('[aria-label="Provider: Claude Code"]')!
      .click(),
  );
  const list = document.body.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Provider"]',
  )!;
  const options = list.querySelectorAll<HTMLButtonElement>('[role="option"]');
  await act(async () =>
    list.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[0]);
  await act(async () =>
    options[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(options[options.length - 1]);
});

it("hides Sign in when a server has no known transport", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "claude",
            name: "unknown",
            scope: "local",
            configPath: "",
            transport: "",
          },
        ]
      : "",
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  expect(container.textContent).toContain("unknown");
  expect(
    [...container.querySelectorAll("button")].some(
      (button) => button.textContent === "Sign in",
    ),
  ).toBe(false);
});

it("shows only configured provider chips until the filter button reveals all", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  const chips = container.querySelector(
    '[aria-label="Filter MCP servers by provider"]',
  )!;
  expect(chips.textContent).toContain("Codex");
  expect(chips.textContent).not.toContain("Cursor");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Show all providers"]')!
      .click(),
  );
  expect(chips.textContent).toContain("Cursor");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Show available providers"]',
      )!
      .click(),
  );
  expect(chips.textContent).not.toContain("Cursor");
});

it("ignores discovery from a previous project after cwd changes", async () => {
  let resolveOld!: (connections: unknown[]) => void;
  invoke.mockImplementation((command: string, args: { cwd: string }) => {
    if (command === "claude_mcp_list") return Promise.resolve("");
    if (args.cwd === "/old")
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return Promise.resolve([
      {
        provider: "cursor",
        name: "new-project",
        scope: "project",
        configPath: "/new/.cursor/mcp.json",
        transport: "stdio",
      },
    ]);
  });
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/old" })),
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/new" })),
  );
  expect(container.textContent).toContain("new-project");
  await act(async () =>
    resolveOld([
      {
        provider: "cursor",
        name: "old-project",
        scope: "project",
        configPath: "/old/.cursor/mcp.json",
        transport: "stdio",
      },
    ]),
  );
  expect(container.textContent).toContain("new-project");
  expect(container.textContent).not.toContain("old-project");
});

it("reuses the loaded list when returning to the page and reloads on Refresh", async () => {
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(2);

  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [
          {
            provider: "cursor",
            name: "updated",
            scope: "project",
            configPath: "/repo/.cursor/mcp.json",
            transport: "stdio",
          },
        ]
      : "",
  );
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(invoke).toHaveBeenCalledTimes(4);
  expect(container.textContent).toContain("updated");
  expect(container.textContent).not.toContain("sentry");

  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("updated");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(4);
});

it("shares the first request across StrictMode and navigation while loading", async () => {
  let resolveDiscovery!: (connections: unknown[]) => void;
  let resolveHealth!: (output: string) => void;
  invoke.mockImplementation((command: string) =>
    command === "mcp_discover"
      ? new Promise((resolve) => {
          resolveDiscovery = resolve;
        })
      : new Promise((resolve) => {
          resolveHealth = resolve;
        }),
  );
  const page = () =>
    createElement(
      StrictMode,
      null,
      createElement(McpSettings, { cwd: "/repo" }),
    );
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => resolveDiscovery([]));
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null));
  await act(async () => root.render(page()));
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolveHealth("remote: https://mcp.example.com - Connected"),
  );
  expect(container.textContent).toContain("remote");
  expect(container.textContent).toContain("Connected");
  expect(container.textContent).not.toContain("Checking servers…");
});

it("caches an empty list until manually refreshed", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover" ? [] : "",
  );
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("No MCP servers configured");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("caches discovery failures and lets Refresh retry", async () => {
  invoke.mockRejectedValueOnce(new Error("Discovery failed"));
  await act(async () =>
    root.render(createElement(McpSettings, { cwd: "/repo" })),
  );
  await act(async () => root.render(null));
  await act(() => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("Discovery failed");
  expect(invoke).toHaveBeenCalledTimes(1);
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(container.textContent).toContain("sentry");
  expect(container.textContent).not.toContain("Discovery failed");
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("uses the shared project picker and caches each project's list", async () => {
  invoke.mockImplementation(async (command: string, args: { cwd: string }) =>
    command === "mcp_discover"
      ? [
          {
            provider: "cursor",
            name: `${args.cwd.slice(1)}-server`,
            scope: "project",
            configPath: `${args.cwd}/.cursor/mcp.json`,
            transport: "stdio",
          },
        ]
      : "",
  );
  await act(async () =>
    root.render(
      createElement(McpSettings, {
        cwd: "/repo",
        recents: [{ path: "/other", openedAt: 1 }],
      }),
    ),
  );
  expect(container.textContent).toContain("repo-server");
  await selectProject("/other");
  expect(container.textContent).toContain("other-server");
  expect(container.textContent).not.toContain("repo-server");
  expect(invoke).toHaveBeenCalledWith("mcp_discover", { cwd: "/other" });
  expect(invoke).toHaveBeenCalledWith("claude_mcp_list", { cwd: "/other" });
  expect(invoke).toHaveBeenCalledTimes(4);
  await selectProject("/repo");
  expect(container.textContent).toContain("repo-server");
  expect(container.textContent).not.toContain("Checking servers…");
  expect(invoke).toHaveBeenCalledTimes(4);
  await selectProject("/other");
  const refresh = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Refresh",
  )!;
  await act(async () => refresh.click());
  expect(invoke).toHaveBeenCalledTimes(6);
  expect(invoke).toHaveBeenLastCalledWith("claude_mcp_list", { cwd: "/other" });
});

it("shows Antigravity CLI configured servers and uses its native switch without claiming connection", async () => {
  invoke.mockImplementation(async (command: string) =>
    command === "mcp_discover"
      ? [{ provider: "antigravity-cli", name: "agy-docs", scope: "project", configPath: "/repo/.agents/mcp_config.json", transport: "http", enabled: true }]
      : undefined,
  );
  await act(async () => root.render(createElement(McpSettings, { cwd: "/repo" })));
  expect(container.textContent).toContain("Antigravity CLI");
  expect(container.textContent).toContain("Configured");
  expect(container.textContent).not.toContain("Connected");
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Sign in")).toBe(false);
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label^="Disable agy-docs"]');
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", {
    cwd: "/repo", provider: "antigravity-cli", scope: "project", configPath: "/repo/.agents/mcp_config.json", name: "agy-docs", enabled: false,
  });
});
