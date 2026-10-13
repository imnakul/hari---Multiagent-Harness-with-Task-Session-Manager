import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionProviderStrip } from "./SessionProviderStrip";
import type { SessionProviderStripProps } from "./SessionProviderStrip";

function render(props: SessionProviderStripProps): string {
  return renderToStaticMarkup(createElement(SessionProviderStrip, props));
}
const onChange = vi.fn();

describe("SessionProviderStrip", () => {
  it("renders nothing when there is no note and no Remote Control", () => {
    expect(render({})).toBe("");
  });

  const history = {
    status: "ready" as const,
    canShowEarlier: true,
    loadingEarlier: false,
    onShowEarlier: vi.fn(),
    onRetry: vi.fn(),
  };

  it("offers Show earlier only when more history can be revealed", () => {
    expect(render({ history })).toContain("Show earlier");
    expect(render({ history: { ...history, canShowEarlier: false } })).toBe("");
    expect(render({ history: { ...history, loadingEarlier: true } })).toContain("Loading…");
  });

  it("explains a history failure, keeps resuming possible and offers Retry", () => {
    const html = render({ history: { ...history, status: "error", canShowEarlier: false, message: "No transcript file was found" } });
    expect(html).toContain("Earlier messages could not be loaded: No transcript file was found");
    expect(html).toContain("You can still continue this conversation");
    expect(html).toContain("Retry");
    expect(html).not.toContain("not shown here yet");
  });

  it.each(["Claude Code", "Codex"] as const)("shows one %s source notice beside loading controls", (sourceLabel) => {
    const full = render({ history: { ...history, sourceLabel, canShowEarlier: false } });
    expect(full.split(`Native ${sourceLabel} history`)).toHaveLength(2);
    expect(full).not.toContain("older messages not shown yet");
    expect(full).not.toContain("Show earlier");
    const partial = render({ history: { ...history, sourceLabel } });
    expect(partial).toContain(`Native ${sourceLabel} history · older messages not shown yet`);
    expect(partial).toContain("Show earlier");
    expect(partial).toContain("data-session-provider-strip");
    const loading = render({ history: { ...history, sourceLabel, loadingEarlier: true } });
    expect(loading).toContain("Loading…");
    expect(loading).toContain('disabled=""');
  });

  it("reports a failed older chunk without hiding what loaded", () => {
    const html = render({ history: { ...history, message: "file moved" } });
    expect(html).toContain("Older messages could not be loaded: file moved");
    expect(html).toContain("Show earlier");
  });

  it.each([
    [{ desired: false }, "Off"],
    [{ desired: true }, "Paused"],
    [{ desired: true, status: "connecting" as const }, "Connecting"],
    [{ desired: true, status: "on" as const }, "On"],
    [{ desired: true, status: "needs-consent" as const }, "Needs setup"],
    [{ desired: false, status: "failed" as const, message: "no auth" }, "Failed"],
  ])("renders the %j state as %s", (state, label) => {
    const html = render({ remoteControl: { ...state, onChange } });
    expect(html).toContain(label);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain(`Remote Control: ${label}.`);
  });

  it("describes setup with the exact steps and the real failure reason", () => {
    const setup = render({ remoteControl: { desired: true, status: "needs-consent", onChange } });
    expect(setup).toContain("Run `claude`, enter `/remote-control`, accept the prompt, then select Retry.");
    const failed = render({ remoteControl: { desired: false, status: "failed", message: "not signed in", onChange } });
    expect(failed).toContain("not signed in");
  });

  it("does not reflect a desired switch as connected", () => {
    const html = render({ remoteControl: { desired: true, onChange } });
    expect(html).toContain("Paused");
    expect(html).not.toContain(">On<");
  });
});
