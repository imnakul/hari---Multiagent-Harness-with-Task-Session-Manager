import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { improvePrompt } from "../../../integrations/harness/core/promptImproveHelper";
import { ALT, MOD } from "../../../platform/tauri/platform";
import {
  HARNESS_TITLE,
  type Block,
  type HarnessId,
} from "../../sessions/model/session";
import {
  keybindingPressed,
  keybindingShortcutLabel,
  type ShortcutEvent,
} from "../../settings/model/settings";
import { addRuleToAgentsFile } from "../model/agentsRule";
import { improveBlockReason } from "../model/promptImprove";
import {
  applyLearned,
  loadPromptImproveSettings,
  loadPromptMemory,
  memoryProjectKey,
  recordSentRewrite,
  ruleSuggestion,
  savePromptMemory,
  setRuleState,
  subscribePromptImproveSettings,
} from "../model/promptImproveStore";
import type { RewriteRevealEvent } from "./RewriteReveal";

export const IMPROVE_PROMPT_COMMAND = "Composer: Improve Prompt";

/** Mod+Alt+I, matched by physical key since Alt (Option) changes the character on macOS. */
export function isImprovePromptShortcut(event: ShortcutEvent): boolean {
  return keybindingPressed(
    IMPROVE_PROMPT_COMMAND,
    event,
    (event.metaKey || event.ctrlKey) &&
      event.altKey &&
      !event.shiftKey &&
      event.code === "KeyI",
  );
}

/** The shortcut as shown in tooltips, or null when the owner turned it off. */
export function improveShortcutLabel(): string | null {
  return keybindingShortcutLabel(IMPROVE_PROMPT_COMMAND, `${MOD}${ALT}I`);
}

/**
 * Where a rewrite stands. `applied` keeps both versions: the slot not on
 * screen is updated when the owner switches, so no edit is lost.
 */
export type ImproveView =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "applied";
      original: string;
      rewrite: string;
      /** The helper's own text, to tell an accepted rewrite from an edited one. */
      generated: string;
      showing: "rewrite" | "original";
      helper: string;
    }
  | { kind: "stale"; rewrite: string; helper: string }
  | { kind: "failed"; message: string };

export type RuleOffer =
  | { kind: "offer"; rule: string }
  | { kind: "adding"; rule: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export type PromptImprove = {
  /** ✨ shows: the composer allows it and Settings has it on. */
  visible: boolean;
  view: ImproveView;
  /** Why ✨ is disabled for the current text, or null. */
  blockReason: string | null;
  running: boolean;
  /** The version not on screen, while the Original button is held. */
  peekText: string | null;
  ruleOffer: RuleOffer | null;
  /** The last rewrite put into the composer, for its reveal animation. */
  reveal: RewriteRevealEvent | null;
  /** Starts a rewrite, or cancels the one running. */
  trigger: () => void;
  /** Esc: true when it cancelled a run. */
  cancel: () => boolean;
  toggleOriginal: () => void;
  setPeeking: (peeking: boolean) => void;
  restoreOriginal: () => void;
  acceptRewrite: () => void;
  dismiss: () => void;
  /** Call with the composer text once a send is accepted. */
  recordSend: (sent: string) => void;
  addRule: () => void;
  snoozeRule: () => void;
  neverRule: () => void;
};

/**
 * Improve prompt (fork, L-252) for one composer. The rewrite replaces the
 * text in place; the original stays one click away until the next send.
 * Learned lines go to local memory; nothing is written to the project
 * unless the owner taps "Add to AGENTS.md".
 */
export function usePromptImprove(options: {
  /** False for remote chats and composers where it can't run. */
  available: boolean;
  /** Changing this (another chat) drops any rewrite in progress. */
  scopeKey: string;
  text: string;
  cwd: string;
  harness: HarnessId;
  blocks?: readonly Block[];
  getText: () => string;
  /** Replace the whole text and keep the caret at the end. */
  setText: (text: string) => void;
}): PromptImprove {
  const settings = useSyncExternalStore(
    subscribePromptImproveSettings,
    loadPromptImproveSettings,
  );
  const [view, setView] = useState<ImproveView>({ kind: "idle" });
  const [peeking, setPeeking] = useState(false);
  const [ruleOffer, setRuleOfferState] = useState<RuleOffer | null>(null);
  const [reveal, setReveal] = useState<RewriteRevealEvent | null>(null);
  const revealIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  const viewRef = useRef(view);
  const ruleOfferRef = useRef(ruleOffer);
  const visible = options.available && settings.enabled;

  const showRewrite = useCallback((from: string, rewrite: string) => {
    latest.current.setText(rewrite);
    revealIdRef.current += 1;
    setReveal({ id: revealIdRef.current, from, at: performance.now() });
  }, []);

  const showView = useCallback((next: ImproveView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const setRuleOffer = useCallback((next: RuleOffer | null) => {
    ruleOfferRef.current = next;
    setRuleOfferState(next);
  }, []);

  const stopRun = useCallback((): boolean => {
    if (viewRef.current.kind !== "running") return false;
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    return true;
  }, []);

  const reset = useCallback(() => {
    stopRun();
    showView({ kind: "idle" });
    setPeeking(false);
  }, [showView, stopRun]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // Another chat, or ✨ turned off: nothing from the old rewrite carries over.
  useEffect(() => {
    reset();
    setRuleOffer(null);
  }, [options.scopeKey, visible, reset, setRuleOffer]);

  // A cleared composer ends the rewrite (the strip has nothing left to act on).
  useEffect(() => {
    if (options.text.trim()) return;
    if (view.kind === "applied" || view.kind === "failed") reset();
  }, [options.text, view.kind, reset]);

  const offerRule = useCallback(
    (cwd: string) => {
      if (ruleOfferRef.current || !loadPromptImproveSettings().suggestRules)
        return;
      // A chat with no project folder ("~") has no AGENTS.md to add to.
      if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(cwd)) return;
      const rule = ruleSuggestion(
        loadPromptMemory().projects[memoryProjectKey(cwd)],
      );
      if (rule) setRuleOffer({ kind: "offer", rule: rule.text });
    },
    [setRuleOffer],
  );

  const start = useCallback(
    (fromText: string, original: string) => {
      const { cwd, harness, blocks } = latest.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = ++runIdRef.current;
      showView({ kind: "running" });
      setPeeking(false);
      const finish = (next: ImproveView): void => {
        controllerRef.current = null;
        showView(next);
      };
      void improvePrompt({
        text: fromText,
        cwd,
        harness,
        blocks,
        signal: controller.signal,
      }).then(
        (outcome) => {
          if (runId !== runIdRef.current) return;
          if (!outcome.ok) {
            finish(
              outcome.cancelled
                ? { kind: "idle" }
                : { kind: "failed", message: outcome.message },
            );
            return;
          }
          savePromptMemory(
            applyLearned(loadPromptMemory(), {
              cwd,
              learned: outcome.learned,
              usedSamples: outcome.usedSamples,
            }),
          );
          const helper = HARNESS_TITLE[outcome.helper.provider];
          // The owner kept typing: their text wins; the rewrite waits in the strip.
          if (latest.current.getText() !== fromText) {
            finish({ kind: "stale", rewrite: outcome.prompt, helper });
          } else {
            showRewrite(fromText, outcome.prompt);
            finish({
              kind: "applied",
              original,
              rewrite: outcome.prompt,
              generated: outcome.prompt,
              showing: "rewrite",
              helper,
            });
          }
          offerRule(cwd);
        },
        (error: unknown) => {
          if (runId !== runIdRef.current) return;
          const reason = error instanceof Error ? error.message : String(error);
          finish({
            kind: "failed",
            message: `Couldn't improve the prompt: ${reason}. Your text is unchanged.`,
          });
        },
      );
    },
    [offerRule, showRewrite, showView],
  );

  const cancel = useCallback((): boolean => {
    if (!stopRun()) return false;
    showView({ kind: "idle" });
    return true;
  }, [showView, stopRun]);

  const blockReason = improveBlockReason(options.text);

  const trigger = useCallback(() => {
    if (cancel()) return;
    if (!latest.current.available || !loadPromptImproveSettings().enabled)
      return;
    const current = latest.current.getText();
    if (improveBlockReason(current)) return;
    const previous = viewRef.current;
    // ✨ again on an untouched rewrite tries a fresh one from the first draft.
    if (
      previous.kind === "applied" &&
      previous.showing === "rewrite" &&
      current === previous.rewrite
    ) {
      start(previous.original, previous.original);
      return;
    }
    const original = previous.kind === "applied" ? previous.original : current;
    start(current, original);
  }, [cancel, start]);

  const toggleOriginal = useCallback(() => {
    const previous = viewRef.current;
    if (previous.kind !== "applied") return;
    const current = latest.current.getText();
    // Keep edits made to the version being left.
    const next: ImproveView =
      previous.showing === "rewrite"
        ? { ...previous, rewrite: current, showing: "original" }
        : { ...previous, original: current, showing: "rewrite" };
    latest.current.setText(
      next.showing === "rewrite" ? next.rewrite : next.original,
    );
    showView(next);
    setPeeking(false);
  }, [showView]);

  const restoreOriginal = useCallback(() => {
    const previous = viewRef.current;
    if (previous.kind !== "applied") return;
    if (previous.showing === "rewrite")
      latest.current.setText(previous.original);
    reset();
  }, [reset]);

  const acceptRewrite = useCallback(() => {
    const previous = viewRef.current;
    if (previous.kind !== "stale") return;
    const original = latest.current.getText();
    showRewrite(original, previous.rewrite);
    showView({
      kind: "applied",
      original,
      rewrite: previous.rewrite,
      generated: previous.rewrite,
      showing: "rewrite",
      helper: previous.helper,
    });
  }, [showRewrite, showView]);

  const recordSend = useCallback(
    (sent: string) => {
      const previous = viewRef.current;
      reset();
      if (previous.kind !== "applied" || previous.showing !== "rewrite") return;
      if (!loadPromptImproveSettings().learn) return;
      savePromptMemory(
        recordSentRewrite(loadPromptMemory(), {
          rewrite: previous.generated,
          sent,
          now: Date.now(),
        }),
      );
    },
    [reset],
  );

  const changeRule = useCallback(
    (change: { state: "never" } | { snooze: true }) => {
      const offer = ruleOfferRef.current;
      if (offer?.kind !== "offer") return;
      savePromptMemory(
        setRuleState(
          loadPromptMemory(),
          latest.current.cwd,
          offer.rule,
          change,
        ),
      );
      setRuleOffer(null);
    },
    [setRuleOffer],
  );

  const addRule = useCallback(() => {
    const offer = ruleOfferRef.current;
    if (offer?.kind !== "offer") return;
    const { cwd } = latest.current;
    const rule = offer.rule;
    setRuleOffer({ kind: "adding", rule });
    void addRuleToAgentsFile(cwd, rule).then((result) => {
      if (ruleOfferRef.current?.kind !== "adding") return;
      if (!result.ok) {
        setRuleOffer({ kind: "error", message: result.message });
        return;
      }
      savePromptMemory(
        setRuleState(loadPromptMemory(), cwd, rule, { state: "added" }),
      );
      setRuleOffer({
        kind: "done",
        message: result.created
          ? "Created AGENTS.md with this rule."
          : "Added to AGENTS.md.",
      });
    });
  }, [setRuleOffer]);

  const snoozeRule = useCallback(
    () => changeRule({ snooze: true }),
    [changeRule],
  );
  const neverRule = useCallback(
    () => changeRule({ state: "never" }),
    [changeRule],
  );

  // A finished or failed rule offer clears itself.
  useEffect(() => {
    if (ruleOffer?.kind !== "done" && ruleOffer?.kind !== "error") return;
    const timer = window.setTimeout(() => setRuleOffer(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [ruleOffer, setRuleOffer]);

  const peekText =
    peeking && view.kind === "applied"
      ? view.showing === "rewrite"
        ? view.original
        : view.rewrite
      : null;

  return {
    visible,
    view,
    blockReason,
    running: view.kind === "running",
    peekText,
    ruleOffer,
    reveal,
    trigger,
    cancel,
    toggleOriginal,
    setPeeking,
    restoreOriginal,
    acceptRewrite,
    dismiss: reset,
    recordSend,
    addRule,
    snoozeRule,
    neverRule,
  };
}
