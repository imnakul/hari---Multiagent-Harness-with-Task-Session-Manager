import { IS_MAC } from "../../../platform/tauri/platform";
import type { FollowUpBehavior } from "../../settings/model/settings";

export type ComposerActionType = "send" | "queue" | "steer" | "newline";

export type KeyboardModifierState = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
};

export type ActionResolutionContext = {
  busy: boolean;
  followUpBehavior: FollowUpBehavior;
  canSteer: boolean;
  planMode?: boolean;
  isMac?: boolean;
  /**
   * Interactive Claude (fork, L-193): it can't take a steer, so the alternate
   * key stops its turn and then sends ("Send now"); Enter and click queue.
   */
  sendNow?: boolean;
};

/**
 * Resolves the action to take for a keyboard event in the composer textarea.
 *
 * Rules:
 * - IME composition is ignored.
 * - Shift+Enter (including Ctrl+Shift+Enter / Cmd+Shift+Enter) always returns "newline".
 * - When idle, Enter and Ctrl/Cmd+Enter submit a standard turn ("send").
 * - When busy:
 *   - If steering is unsupported (or plan mode is active), effective action is always "queue".
 *   - If steering is supported:
 *     - Selected "queue": Enter -> "queue", Ctrl/Cmd+Enter -> "steer"
 *     - Selected "steer": Enter -> "steer", Ctrl/Cmd+Enter -> "queue"
 */
export function resolveComposerKeyAction(
  key: string,
  modifiers: KeyboardModifierState,
  context: ActionResolutionContext,
): ComposerActionType | "ignore" {
  if (modifiers.isComposing) {
    return "ignore";
  }

  if (key !== "Enter") {
    return "ignore";
  }

  // Shift takes strict precedence over all other modifiers: always a newline
  if (modifiers.shiftKey) {
    return "newline";
  }

  // Idle session: standard send
  if (!context.busy) {
    return "send";
  }

  const isMac = context.isMac ?? IS_MAC;
  const isAlternate = modifiers.ctrlKey || (isMac ? modifiers.metaKey : false);
  const steeringSupported = context.canSteer && !context.planMode;

  if (!steeringSupported) {
    return context.sendNow && !context.planMode && isAlternate ? "steer" : "queue";
  }

  if (context.followUpBehavior === "queue") {
    return isAlternate ? "steer" : "queue";
  }

  return isAlternate ? "queue" : "steer";
}

/**
 * Resolves the action for activating the composer send button.
 */
export function resolveComposerButtonAction(
  context: ActionResolutionContext,
): "send" | "queue" | "steer" {
  if (!context.busy) {
    return "send";
  }

  const steeringSupported = context.canSteer && !context.planMode;
  if (!steeringSupported) {
    return "queue";
  }

  return context.followUpBehavior === "queue" ? "queue" : "steer";
}

/**
 * Derives the button tooltip for the current composer state.
 */
export function resolveComposerActionTooltip(
  context: ActionResolutionContext,
): string {
  if (!context.busy) {
    return "Send";
  }

  const steeringSupported = context.canSteer && !context.planMode;
  const isMac = context.isMac ?? IS_MAC;
  const modEnter = isMac ? "Cmd+Enter" : "Ctrl+Enter";
  if (!steeringSupported) {
    return context.sendNow && !context.planMode
      ? `Click / Enter → Queue\n${modEnter} → Send now (stops Claude's turn first)`
      : "Click / Enter → Queue";
  }

  if (context.followUpBehavior === "queue") {
    return `Click / Enter → Queue\n${modEnter} → Steer`;
  }

  return `Click / Enter → Steer\n${modEnter} → Queue`;
}

/**
 * Derives the button accessible label (aria-label) for assistive technology.
 */
export function resolveComposerActionAriaLabel(
  context: ActionResolutionContext,
): string {
  if (!context.busy) {
    return "Send";
  }

  const steeringSupported = context.canSteer && !context.planMode;
  if (!steeringSupported || context.followUpBehavior === "queue") {
    return "Queue follow-up";
  }

  return "Steer active turn";
}

export type SuggestionKeyAction =
  | "newline"
  | "pick"
  | "action"
  | "keep_open";

export interface SuggestionKeyOptions {
  /**
   * If true (e.g. for a bare '/' trigger without query), plain Enter when unmatched
   * keeps the suggestion picker open instead of falling through to submission.
   */
  keepOpenOnUnmatched?: boolean;
}

/**
 * Resolves keyboard Enter interaction while mention or slash suggestion picker is open.
 *
 * Rules:
 * - IME composition is ignored.
 * - Non-Enter keys are ignored.
 * - Shift+Enter (including Ctrl/Cmd+Shift+Enter) returns "newline" to insert a newline and preserve draft.
 * - Ctrl/Cmd+Enter returns "action" to trigger the alternate Queue/Steer action (never silently ignored).
 * - Plain Enter returns "pick" if a suggestion item is available.
 * - Plain Enter with no matching suggestion returns "action" to fall through to normal Send/Queue/Steer,
 *   unless keepOpenOnUnmatched is set (e.g. bare '/' trigger), which returns "keep_open".
 */
export function resolveSuggestionKeyAction(
  key: string,
  modifiers: KeyboardModifierState,
  hasItem: boolean,
  options?: SuggestionKeyOptions,
): SuggestionKeyAction | "ignore" {
  if (modifiers.isComposing) {
    return "ignore";
  }

  if (key !== "Enter") {
    return "ignore";
  }

  if (modifiers.shiftKey) {
    return "newline";
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    return "action";
  }

  if (hasItem) {
    return "pick";
  }

  if (options?.keepOpenOnUnmatched) {
    return "keep_open";
  }

  return "action";
}

export type EffectiveSuggestionResult =
  | { type: "newline" }
  | { type: "pick" }
  | { type: "keep_open" }
  | { type: "action"; action: "send" | "queue" | "steer" }
  | { type: "ignore" };

/**
 * Resolves the full effective action for a keyboard event while a suggestion picker is open,
 * chaining suggestion resolution and centralized composer key action resolution.
 */
export function resolveEffectiveSuggestionAction(
  key: string,
  modifiers: KeyboardModifierState,
  hasItem: boolean,
  actionContext: ActionResolutionContext,
  options?: SuggestionKeyOptions,
): EffectiveSuggestionResult {
  const suggestionAction = resolveSuggestionKeyAction(
    key,
    modifiers,
    hasItem,
    options,
  );

  if (suggestionAction === "ignore") {
    return { type: "ignore" };
  }
  if (suggestionAction === "newline") {
    return { type: "newline" };
  }
  if (suggestionAction === "pick") {
    return { type: "pick" };
  }
  if (suggestionAction === "keep_open") {
    return { type: "keep_open" };
  }

  const action = resolveComposerKeyAction(key, modifiers, actionContext);
  if (action === "ignore") {
    return { type: "ignore" };
  }
  if (action === "newline") {
    return { type: "newline" };
  }
  return { type: "action", action };
}
