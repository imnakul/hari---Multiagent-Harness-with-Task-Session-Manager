import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  askWhiteboardAgent,
  whiteboardAgentTargets,
  whiteboardTargetLabel,
} from "../../../integrations/harness/core/whiteboardHelper";
import type { AiHelperTarget } from "../../settings/model/settings";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { Popover } from "../../../shared/ui/Popover";
import { AiChat, Check, ChevronDown, Lock, Send, Stop, Trash2, X } from "../../../shared/ui/icons";
import { loadSheetChat, saveSheetChat } from "../model/sheetStore";
import {
  buildWhiteboardPrompt,
  type SceneElementLike,
  type WhiteboardChatMessage,
  type WhiteboardOps,
} from "../model/whiteboardAgent";

const ICON_BUTTON =
  "flex size-6 items-center justify-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40";

const SUGGESTIONS = [
  "Sketch a login flow: sign in, 2FA, home",
  "Draw a three-tier web app architecture",
  "Turn the shapes on the sheet into a tidy grid",
];

let rememberedTarget: AiHelperTarget | undefined;
const sameTarget = (a: AiHelperTarget, b: AiHelperTarget) =>
  a.provider === b.provider && a.accountId === b.accountId && a.model === b.model;

/**
 * Talk to an AI helper about the open sheet; its replies can draw, move or
 * remove shapes (fork, L-194). The chat is saved beside the sheet.
 */
export function WhiteboardChat({
  sheetId,
  sheetName,
  locked,
  cwd,
  getScene,
  applyOps,
  onClose,
}: {
  sheetId: string;
  sheetName: string;
  locked: boolean;
  cwd: string;
  getScene: () => readonly SceneElementLike[];
  /** Applies the agent's changes; returns a short summary, or null if nothing changed. */
  applyOps: (ops: WhiteboardOps) => string | null;
  onClose: () => void;
}) {
  const targets = useMemo(() => whiteboardAgentTargets(), []);
  const [target, setTarget] = useState<AiHelperTarget | undefined>(() =>
    rememberedTarget && targets.some((item) => sameTarget(item, rememberedTarget!))
      ? rememberedTarget
      : targets[0],
  );
  const [messages, setMessages] = useState<WhiteboardChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef(sheetId);
  sheetRef.current = sheetId;

  useEffect(() => {
    let live = true;
    setLoaded(false);
    setMessages([]);
    loadSheetChat(sheetId).then((history) => {
      if (!live) return;
      setMessages(history);
      setLoaded(true);
    });
    return () => {
      live = false;
      abort.current?.abort();
      abort.current = null;
      setBusy(false);
    };
  }, [sheetId]);

  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  const commit = useCallback((id: string, next: WhiteboardChatMessage[]) => {
    if (sheetRef.current === id) setMessages(next);
    void saveSheetChat(id, next).catch(() => undefined);
  }, []);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !loaded) return;
    if (!target) return;
    const id = sheetId;
    const history = messages;
    const withUser: WhiteboardChatMessage[] = [
      ...history,
      { role: "user", text: message, at: Date.now() },
    ];
    commit(id, withUser);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const outcome = await askWhiteboardAgent({
      target,
      cwd,
      prompt: buildWhiteboardPrompt({ message, history, scene: getScene(), locked }),
      signal: controller.signal,
    });
    if (abort.current === controller) abort.current = null;
    if (sheetRef.current !== id) return;
    setBusy(false);
    if (!outcome.ok) {
      if (outcome.cancelled) return;
      commit(id, [...withUser, { role: "assistant", text: outcome.message, at: Date.now(), error: true }]);
      return;
    }
    let note: string | undefined;
    if (outcome.reply.ops) {
      note = locked
        ? "Not drawn: the sheet is locked"
        : (applyOps(outcome.reply.ops) ?? "Nothing to change");
    }
    commit(id, [
      ...withUser,
      {
        role: "assistant",
        text: outcome.reply.text || (note ? "" : "Done."),
        at: Date.now(),
        ...(note ? { note } : {}),
      },
    ]);
  };

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
  };

  return (
    <aside
      aria-label="Whiteboard agent"
      data-whiteboard-chat
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-content/10 bg-content/[0.04] backdrop-blur-xl"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-content/10 pl-3 pr-1.5">
        <AiChat aria-hidden className="size-3.5 shrink-0 text-content/45" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-content">Agent</span>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Clear chat"
          title="Clear chat"
          disabled={busy || messages.length === 0}
          onClick={() => commit(sheetId, [])}
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
        <button type="button" className={ICON_BUTTON} aria-label="Hide agent" title="Hide agent" onClick={onClose}>
          <X aria-hidden className="size-3.5" />
        </button>
      </div>

      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {loaded && messages.length === 0 ? (
          <div className="space-y-3 pt-2">
            <p className="text-[13px] text-content/60">
              Ask an agent to draw on <span className="text-content">{sheetName}</span>. It sees
              what's on the sheet and can add, move, restyle or remove shapes.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!target}
                  onClick={() => void send(suggestion)}
                  className="rounded-lg border border-content/10 px-2.5 py-1.5 text-left text-[12px] text-content/70 transition-colors duration-100 hover:border-content/20 hover:bg-content/5 hover:text-content disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-content/10 px-2.5 py-1.5 text-[13px] text-content">
                {message.text}
              </p>
            </div>
          ) : (
            <div key={index} className="space-y-1">
              {message.text ? (
                <p
                  className={`whitespace-pre-wrap text-[13px] ${
                    message.error ? "text-red-300/90" : "text-content/85"
                  }`}
                  role={message.error ? "alert" : undefined}
                >
                  {message.text}
                </p>
              ) : null}
              {message.note ? (
                <p className="inline-flex items-center gap-1 rounded-md bg-content/5 px-1.5 py-0.5 text-[11px] text-content/55">
                  <Check aria-hidden className="size-3" />
                  {message.note}
                </p>
              ) : null}
            </div>
          ),
        )}
        {busy ? (
          <p role="status" className="whiteboard-thinking text-[12px] text-content/45">
            {target ? whiteboardTargetLabel(target) : "Agent"} is drawing…
          </p>
        ) : null}
      </div>

      <div className="shrink-0 p-2">
        {locked ? (
          <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-content/50">
            <Lock aria-hidden className="size-3" />
            Sheet is locked: the agent can answer but not draw.
          </p>
        ) : null}
        {targets.length === 0 ? (
          <p role="alert" className="px-1 pb-2 text-[12px] text-content/60">
            No AI helper is available. Sign in to Claude, Codex, OpenCode or another helper in
            Settings → AI helper.
          </p>
        ) : null}
        <div className="rounded-xl border border-content/10 bg-content/5 focus-within:border-content/25">
          <textarea
            ref={input}
            rows={2}
            value={draft}
            disabled={!target}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Describe what to draw…"
            aria-label="Message the whiteboard agent"
            className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent px-2.5 pt-2 text-[13px] text-content outline-none placeholder:text-content/35"
          />
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <button
              ref={pickerButton}
              type="button"
              disabled={targets.length === 0}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
              className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-content/65 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40"
            >
              {target ? <HarnessIcon harness={target.provider} className="size-3.5 shrink-0" /> : null}
              <span className="min-w-0 truncate">{target ? whiteboardTargetLabel(target) : "No helper"}</span>
              <ChevronDown aria-hidden className="size-3 shrink-0" />
            </button>
            <span className="flex-1" />
            {busy ? (
              <button type="button" className={ICON_BUTTON} aria-label="Stop" title="Stop" onClick={stop}>
                <Stop aria-hidden className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label="Send"
                title="Send (Enter)"
                disabled={!draft.trim() || !target || !loaded}
                onClick={() => void send(draft)}
              >
                <Send aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {pickerOpen ? (
        <Popover
          anchor={pickerButton}
          side="top"
          align="start"
          gap={6}
          width={240}
          role="menu"
          aria-label="Agent"
          onDismiss={() => setPickerOpen(false)}
          className="p-1"
        >
          {targets.map((item) => {
            const selected = !!target && sameTarget(item, target);
            return (
              <button
                key={`${item.provider}:${item.accountId ?? ""}:${item.model ?? ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  rememberedTarget = item;
                  setTarget(item);
                  setPickerOpen(false);
                  input.current?.focus();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-content/80 hover:bg-content/10 hover:text-content"
              >
                <HarnessIcon harness={item.provider} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{whiteboardTargetLabel(item)}</span>
                {selected ? <Check aria-hidden className="size-3.5 text-accent" /> : null}
              </button>
            );
          })}
        </Popover>
      ) : null}
    </aside>
  );
}
