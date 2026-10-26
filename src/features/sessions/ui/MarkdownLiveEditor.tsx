import { lazySurface } from "../../../shared/ui/lazySurface";

/**
 * Live Markdown editor, loaded on demand so CodeMirror stays out of the
 * startup bundle (the plan pane and Session metadata dialog load at startup).
 * Surfaces that offer Live call `preloadMarkdownLiveEditor` when they mount,
 * so the first switch to Live is instant.
 */
export const MarkdownLiveEditor = lazySurface(async () => {
  const module = await import("./MarkdownLiveEditorView");
  return { default: module.MarkdownLiveEditorView };
});

/** Starts loading the Live editor in the background; safe to call often. */
export function preloadMarkdownLiveEditor(): void {
  void MarkdownLiveEditor.preload().catch((error: unknown) => {
    console.error("[markdown-live] could not load the Live editor", error);
  });
}
