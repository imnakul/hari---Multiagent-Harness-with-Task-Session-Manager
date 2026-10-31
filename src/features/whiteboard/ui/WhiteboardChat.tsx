import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  askWhiteboardAgent,
  whiteboardAgentTargets,
} from "../../../integrations/harness/core/whiteboardHelper";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { modelEffortSetting, modelsFor, preferredModelId } from "../../sessions/model/models";
import { HARNESS_TITLE } from "../../sessions/model/session";
import type { AiHelperTarget } from "../../settings/model/settings";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  AiChat,
  Check,
  ChevronDown,
  Lock,
  PanelBottom,
  PanelRight,
  Paperclip,
  Send,
  Stop,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { loadSheetChat, saveSheetChat } from "../model/sheetStore";
import {
  ATTACHMENT_CHAR_LIMIT,
  buildWhiteboardPrompt,
  type SceneElementLike,
  type WhiteboardAttachment,
  type WhiteboardChatMessage,
  type WhiteboardOps,
} from "../model/whiteboardAgent";
import {
  CHAT_SIZE_LIMITS,
  loadAgentChoice,
  saveAgentChoice,
  type AgentChoice,
  type ChatDock,
} from "../model/whiteboardPrefs";

const ICON_BUTTON =
  "flex size-6 items-center justify-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40";

const SUGGESTIONS = [
  "Sketch a login flow: sign in, 2FA, home",
  "Draw a three-tier web app architecture",
  "Turn the shapes on the sheet into a tidy grid",
];

/** Text documents the agent can read; binary files (PDF, Word) are refused. */
const TEXT_FILE =
  /\.(txt|md|markdown|mdx|json|jsonc|ya?ml|toml|csv|tsv|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rs|go|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|sh|ps1|sql|graphql|mermaid|mmd|ini|env|log)$/i;
const MAX_FILE_BYTES = 2_000_000;

let rememberedTarget: AiHelperTarget | undefined;
const sameTarget = (a: AiHelperTarget, b: AiHelperTarget) =>
  a.provider === b.provider && a.accountId === b.accountId && a.model === b.model;

function useAccountsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);
  return version;
}

/**
 * Talk to an AI helper about the open sheet; its replies can draw, move or
 * remove shapes (fork, L-194). The chat is saved beside the sheet. Model,
 * effort, account, attached documents and a side or bottom dock (L-199).
 */
export function WhiteboardChat({
  sheetId,
  sheetName,
  locked,
  cwd,
  getScene,
  applyOps,
  dock,
  size,
  onDock,
  onResize,
  onClose,
}: {
  sheetId: string;
  sheetName: string;
  locked: boolean;
  cwd: string;
  getScene: () => readonly SceneElementLike[];
  /** Applies the agent's changes; returns a short summary, or null if nothing changed. */
  applyOps: (ops: WhiteboardOps) => string | null;
  dock: ChatDock;
  /** Width beside the canvas, or height below it, in pixels. */
  size: number;
  onDock: (dock: ChatDock) => void;
  /** `done` is true when a drag or key press ends, so the size is saved. */
  onResize: (size: number, done: boolean) => void;
  onClose: () => void;
}) {
  const targets = useMemo(() => whiteboardAgentTargets(), []);
  const [target, setTarget] = useState<AiHelperTarget | undefined>(() =>
    rememberedTarget && targets.some((item) => sameTarget(item, rememberedTarget!))
      ? rememberedTarget
      : targets[0],
  );
  const [choice, setChoice] = useState<AgentChoice>(() => (target ? loadAgentChoice(target.provider) : {}));
  const [attachments, setAttachments] = useState<WhiteboardAttachment[]>([]);
  const [messages, setMessages] = useState<WhiteboardChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef(sheetId);
  sheetRef.current = sheetId;
  const accountsVersion = useAccountsVersion();

  const provider = target?.provider;
  const models = useMemo(() => (provider ? modelsFor(provider) : []), [provider]);
  const modelId = choice.model ?? target?.model ?? (provider ? preferredModelId(provider) : undefined);
  const model = models.find((item) => item.id === modelId);
  const effortSetting = model ? modelEffortSetting(model) : undefined;
  const effort =
    effortSetting && effortSetting.kind === "select"
      ? effortSetting.options.some((option) => option.value === choice.effort)
        ? choice.effort!
        : effortSetting.value
      : undefined;
  const accounts = useMemo(
    () => (provider && supportsProviderAccounts(provider) ? providerAccounts(provider) : []),
    // Re-read when accounts are added or removed elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, accountsVersion],
  );
  const accountId =
    choice.accountId && accounts.some((account) => account.id === choice.accountId)
      ? choice.accountId
      : target?.accountId;
  const runTarget: AiHelperTarget | undefined = target
    ? {
        provider: target.provider,
        ...(accountId ? { accountId } : {}),
        ...(modelId ? { model: modelId } : {}),
      }
    : undefined;
  const agentLabel = target ? HARNESS_TITLE[target.provider] : "Agent";
  const interactive = provider === "claude" && choice.execution === "interactive";

  const updateChoice = (patch: AgentChoice) => {
    if (!provider) return;
    const next = { ...choice, ...patch };
    for (const key of Object.keys(next) as (keyof AgentChoice)[]) if (!next[key]) delete next[key];
    setChoice(next);
    saveAgentChoice(provider, next);
  };

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

  const addFiles = async (files: readonly File[]) => {
    setAttachError(null);
    const added: WhiteboardAttachment[] = [];
    const refused: string[] = [];
    for (const file of files) {
      if (!TEXT_FILE.test(file.name) && !file.type.startsWith("text/")) {
        refused.push(`${file.name} (not a text file)`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        refused.push(`${file.name} (over 2 MB)`);
        continue;
      }
      try {
        added.push({ name: file.name, text: await file.text() });
      } catch {
        refused.push(`${file.name} (couldn't read)`);
      }
    }
    if (added.length) {
      setAttachments((current) => [
        ...current.filter((item) => !added.some((next) => next.name === item.name)),
        ...added,
      ]);
    }
    if (refused.length) setAttachError(`Not attached: ${refused.join(", ")}. Paste its text instead.`);
    input.current?.focus();
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !loaded) return;
    if (!runTarget) return;
    const id = sheetId;
    const history = messages;
    const sent = attachments;
    const withUser: WhiteboardChatMessage[] = [
      ...history,
      {
        role: "user",
        text: message,
        at: Date.now(),
        ...(sent.length ? { attachments: sent.map((item) => item.name) } : {}),
      },
    ];
    commit(id, withUser);
    setDraft("");
    setAttachments([]);
    setAttachError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const outcome = await askWhiteboardAgent({
      target: runTarget,
      cwd,
      prompt: buildWhiteboardPrompt({ message, history, scene: getScene(), locked, attachments: sent }),
      ...(effortSetting && effort ? { modelSettings: { [effortSetting.id]: effort } } : {}),
      signal: controller.signal,
      ...(interactive ? { interactive: true } : {}),
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

  // Drag the inner edge to resize: left edge beside the canvas, top edge below it.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const start = dock === "side" ? event.clientX : event.clientY;
    const from = size;
    let last = from;
    const move = (next: PointerEvent) => {
      last = from + (start - (dock === "side" ? next.clientX : next.clientY));
      onResize(last, false);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onResize(last, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const limits = CHAT_SIZE_LIMITS[dock];
  const side = dock === "side";

  return (
    <aside
      aria-label="Whiteboard agent"
      data-whiteboard-chat
      className={`relative flex shrink-0 flex-col bg-content/[0.04] backdrop-blur-xl ${
        side ? "h-full border-l border-content/10" : "w-full border-t border-content/10"
      }`}
      style={side ? { width: size } : { height: size }}
    >
      <div
        role="separator"
        aria-orientation={side ? "vertical" : "horizontal"}
        aria-label="Resize agent panel"
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={size}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => onResize(limits.initial, true)}
        onKeyDown={(event) => {
          const grow = side ? "ArrowLeft" : "ArrowUp";
          const shrink = side ? "ArrowRight" : "ArrowDown";
          if (event.key !== grow && event.key !== shrink) return;
          event.preventDefault();
          onResize(size + (event.key === grow ? 16 : -16), true);
        }}
        title="Drag to resize; double-click to reset"
        className={`absolute z-10 outline-none transition-colors duration-100 hover:bg-accent/40 focus-visible:bg-accent/50 ${
          side ? "inset-y-0 -left-1 w-2 cursor-col-resize" : "inset-x-0 -top-1 h-2 cursor-row-resize"
        }`}
      />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-content/10 pl-3 pr-1.5">
        <AiChat aria-hidden className="size-3.5 shrink-0 text-content/45" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-content">Agent</span>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={side ? "Move agent below the sheet" : "Move agent beside the sheet"}
          title={side ? "Move below" : "Move beside"}
          onClick={() => onDock(side ? "bottom" : "side")}
        >
          {side ? <PanelBottom aria-hidden className="size-3.5" /> : <PanelRight aria-hidden className="size-3.5" />}
        </button>
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
              what's on the sheet and can add, move, restyle or remove shapes. Attach a document
              and ask for a diagram of it.
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
            <div key={index} className="flex flex-col items-end gap-1">
              {message.attachments?.length ? (
                <p className="flex max-w-[85%] items-center gap-1 truncate text-[11px] text-content/45">
                  <Paperclip aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{message.attachments.join(", ")}</span>
                </p>
              ) : null}
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
            {agentLabel} is drawing…
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
        {attachError ? (
          <p role="alert" className="px-1 pb-1.5 text-[11px] text-red-300/90">
            {attachError}
          </p>
        ) : null}
        <div className="rounded-xl border border-content/10 bg-content/5 focus-within:border-content/25">
          {attachments.length ? (
            <ul role="list" aria-label="Attached documents" className="flex flex-wrap gap-1 px-2 pt-2">
              {attachments.map((item) => (
                <li
                  key={item.name}
                  className="flex h-6 max-w-full items-center gap-1 rounded-md bg-content/10 pl-1.5 pr-0.5 text-[11px] text-content/75"
                  title={
                    item.text.length > ATTACHMENT_CHAR_LIMIT
                      ? `${item.name}: only the first ${ATTACHMENT_CHAR_LIMIT.toLocaleString()} characters are sent`
                      : item.name
                  }
                >
                  <Paperclip aria-hidden className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{item.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => setAttachments((current) => current.filter((next) => next !== item))}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-content/50 hover:bg-content/10 hover:text-content"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={input}
            rows={2}
            value={draft}
            disabled={!target}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (!files.length) return;
              event.preventDefault();
              void addFiles(files);
            }}
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
          <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1.5">
            <button
              ref={pickerButton}
              type="button"
              disabled={targets.length === 0}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              aria-label={`Agent: ${agentLabel}`}
              onClick={() => setPickerOpen((open) => !open)}
              className="flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-content/65 transition-colors duration-100 hover:bg-content/10 hover:text-content disabled:opacity-40"
            >
              {target ? <HarnessIcon harness={target.provider} className="size-3.5 shrink-0" /> : null}
              <ChevronDown aria-hidden className="size-3 shrink-0" />
            </button>
            {provider && models.length ? (
              <SearchableSelect
                label="Model"
                variant="pill"
                searchPlaceholder="Search models…"
                value={modelId ?? ""}
                options={models.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(value) => updateChoice({ model: value, effort: undefined })}
                disabled={busy}
              />
            ) : null}
            {provider === "claude" ? (
              <SearchableSelect
                label="Claude mode"
                variant="pill"
                searchable={false}
                value={interactive ? "interactive" : "structured"}
                options={[
                  { value: "structured", label: "Structured" },
                  { value: "interactive", label: "Interactive CLI" },
                ]}
                onChange={(value) =>
                  updateChoice({ execution: value === "interactive" ? "interactive" : undefined })
                }
                disabled={busy}
              />
            ) : null}
            {effortSetting && effortSetting.kind === "select" && effort ? (
              <SearchableSelect
                label="Effort"
                variant="pill"
                searchable={false}
                value={effort}
                options={effortSetting.options.map((option) => ({ value: option.value, label: option.label }))}
                onChange={(value) => updateChoice({ effort: value })}
                disabled={busy}
              />
            ) : null}
            {accounts.length >= 2 ? (
              <SearchableSelect
                label="Account"
                variant="pill"
                searchable={false}
                value={accountId ?? accounts.find((account) => account.isDefault)?.id ?? accounts[0]!.id}
                options={accounts.map((account) => ({ value: account.id, label: account.label }))}
                onChange={(value) => updateChoice({ accountId: value })}
                disabled={busy}
              />
            ) : null}
            <span className="flex-1" />
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Attach documents"
              title="Attach text documents (or paste a file)"
              disabled={!target || busy}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip aria-hidden className="size-3.5" />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length) void addFiles(files);
              }}
            />
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
                  setChoice(loadAgentChoice(item.provider));
                  setPickerOpen(false);
                  input.current?.focus();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-content/80 hover:bg-content/10 hover:text-content"
              >
                <HarnessIcon harness={item.provider} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{HARNESS_TITLE[item.provider]}</span>
                {selected ? <Check aria-hidden className="size-3.5 text-accent" /> : null}
              </button>
            );
          })}
        </Popover>
      ) : null}
    </aside>
  );
}
