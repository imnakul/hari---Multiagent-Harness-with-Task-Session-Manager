import { invoke } from "@tauri-apps/api/core";
import type { Block, HarnessId, Session } from "../../sessions/model/session";
import {
  mergeModelSettings,
  resolveModel,
} from "../../sessions/model/models";
import type { NativeProvider } from "./providerSessions";

/** One display-only item from a provider's own transcript. */
export type HistoryItem = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  /** Epoch ms when the provider recorded it, when present. */
  at?: number;
  /** Stable provider record identity, when the transcript supplies one. */
  nativeId?: string;
  /** Provider-reported turn model, kept separate from MonoCode's composer choice. */
  turnModel?: NonNullable<Block["turnModel"]>;
};

/** Seed a new blank Claude chat from the latest provider-reported assistant model.
 * This changes only the next-message composer choice; history remains read-only. */
export function seedClaudeComposerFromHistory(
  session: Session,
  items: readonly HistoryItem[],
): Session {
  if (
    session.harness !== "claude" ||
    session.busy ||
    session.externalTurnId ||
    session.blocks.some((block) => block.role === "user")
  )
    return session;
  const latest = [...items]
    .reverse()
    .find(
      (item) =>
        (item.role === "assistant" || item.role === "tool") &&
        item.turnModel?.harness === "claude" &&
        !!item.turnModel.id,
    )?.turnModel;
  if (!latest) return session;
  const model = resolveModel("claude", latest.id);
  return {
    ...session,
    model: model.id,
    // The recovered values seed the next composer selection. Keep compatible
    // local defaults when history did not record a setting, and let explicit
    // provider metadata take precedence when it did.
    modelSettings: mergeModelSettings(model, {
      ...session.modelSettings,
      ...latest.settings,
    }),
  };
}

export type ClaudeComposerSeedSaveResult =
  | { kind: "saved"; session: Session }
  | { kind: "skipped" }
  | { kind: "error"; error: unknown };

export type ClaudeComposerSeedSaveDependencies = {
  getLatest: () => Session | undefined;
  isAvailable: () => boolean;
  isSameNativeSession: (session: Session) => boolean;
  canSeed: (session: Session) => boolean;
  save: (session: Session) => Promise<boolean>;
  apply: (session: Session) => void;
  maxAttempts?: number;
};

/**
 * Persist Claude's imported composer choice without losing session controls
 * changed during an asynchronous native-session write. It retries from the
 * latest captured state a bounded number of times, restores a newer composer
 * choice if one won the race, and reports an unconfirmed save to its caller.
 */
export async function saveClaudeComposerSeed(
  seeded: Session,
  dependencies: ClaudeComposerSeedSaveDependencies,
): Promise<ClaudeComposerSeedSaveResult> {
  const maxAttempts = Math.max(1, dependencies.maxAttempts ?? 3);
  const latestNativeSession = (): Session | undefined => {
    if (!dependencies.isAvailable()) return undefined;
    const latest = dependencies.getLatest();
    return latest && dependencies.isSameNativeSession(latest)
      ? latest
      : undefined;
  };

  const persistLatestUntilStable = async (): Promise<
    | { kind: "restored" }
    | { kind: "skipped" }
    | { kind: "error"; error: unknown }
  > => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const latest = latestNativeSession();
      if (!latest) return { kind: "skipped" };
      let saved: boolean;
      try {
        saved = await dependencies.save(latest);
      } catch (error) {
        if (!latestNativeSession()) return { kind: "skipped" };
        return { kind: "error", error };
      }
      if (!saved) {
        if (!latestNativeSession()) return { kind: "skipped" };
        return {
          kind: "error",
          error: new Error("The current native chat could not be restored."),
        };
      }
      const afterSave = latestNativeSession();
      if (!afterSave) return { kind: "skipped" };
      if (afterSave === latest) return { kind: "restored" };
    }
    return {
      kind: "error",
      error: new Error(
        "The current native chat kept changing while its latest state was being saved.",
      ),
    };
  };

  let seedWasWritten = false;
  const failedSeedSave = async (
    error: unknown,
  ): Promise<ClaudeComposerSeedSaveResult> => {
    if (!latestNativeSession()) return { kind: "skipped" };
    if (seedWasWritten) {
      const restored = await persistLatestUntilStable();
      if (restored.kind === "error") return restored;
      if (restored.kind === "skipped") return restored;
    }
    return { kind: "error", error };
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const latest = latestNativeSession();
    if (!latest) return { kind: "skipped" };
    if (!dependencies.canSeed(latest)) {
      if (!seedWasWritten) return { kind: "skipped" };
      const restored = await persistLatestUntilStable();
      return restored.kind === "error"
        ? restored
        : { kind: "skipped" };
    }
    const candidate: Session = {
      ...latest,
      model: seeded.model,
      modelSettings: seeded.modelSettings,
    };
    let saved: boolean;
    try {
      saved = await dependencies.save(candidate);
    } catch (error) {
      return failedSeedSave(error);
    }
    if (!saved) {
      return failedSeedSave(
        new Error("The imported Claude model choice was not saved."),
      );
    }
    seedWasWritten = true;

    const afterSave = latestNativeSession();
    if (!afterSave) return { kind: "skipped" };
    if (!dependencies.canSeed(afterSave)) {
      const restored = await persistLatestUntilStable();
      return restored.kind === "error"
        ? restored
        : { kind: "skipped" };
    }
    if (afterSave === latest) {
      dependencies.apply(candidate);
      return { kind: "saved", session: candidate };
    }
  }

  const restored = await persistLatestUntilStable();
  if (restored.kind === "error") return restored;
  if (restored.kind === "skipped") return restored;
  return {
    kind: "error",
    error: new Error(
      "The imported Claude model choice could not be confirmed because the native chat kept changing.",
    ),
  };
}

export const HISTORY_BLOCK_PREFIX = "history:";
/** Per-message cap; provider transcripts embed very large pastes. */
const MAX_ITEM_CHARS = 20_000;
/** Messages shown per step; "Show earlier" reveals more. */
export const HISTORY_PAGE_ITEMS = 200;
const CLAUDE_TURN_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultracode",
  "ultrathink",
]);

export function isHistoryBlock(block: Pick<Block, "id">): boolean {
  return block.id.startsWith(HISTORY_BLOCK_PREFIX);
}

function cap(text: string): string {
  const trimmed = text.trim();
  const chars = [...trimmed];
  return chars.length <= MAX_ITEM_CHARS
    ? trimmed
    : `${chars.slice(0, MAX_ITEM_CHARS).join("")}… [truncated]`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function at(raw: Record<string, unknown>): { at?: number } {
  if (typeof raw.timestamp !== "string") return {};
  const parsed = Date.parse(raw.timestamp);
  return Number.isFinite(parsed) ? { at: parsed } : {};
}

/** Text the provider injects on the user's behalf; not something the user typed. */
function injectedUserText(text: string): boolean {
  return /^\s*<(environment_context|user_instructions|command-name|command-message|command-args|local-command|system-reminder|turn_aborted)/.test(
    text,
  ) ||
    text.startsWith("Caveat: The messages below were generated by the user") ||
    // Claude Code's auto-compaction summary; also flagged `isCompactSummary`.
    text.trimStart().startsWith("This session is being continued from a previous conversation");
}

function parseLines(jsonl: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const rec = record(JSON.parse(line));
      if (rec) out.push(rec);
    } catch {
      // A torn or foreign line is skipped; the rest still renders.
    }
  }
  return out;
}

function claudeItems(
  lines: Record<string, unknown>[],
  expectedNativeId?: string,
): Omit<HistoryItem, "id">[] {
  const items: Omit<HistoryItem, "id">[] = [];
  for (const rec of lines) {
    if (
      expectedNativeId &&
      typeof rec.sessionId === "string" &&
      rec.sessionId !== expectedNativeId
    )
      continue;
    if (rec.isSidechain === true || rec.isMeta === true) continue;
    if (rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) continue;
    if (rec.type !== "user" && rec.type !== "assistant") continue;
    const message = record(rec.message);
    if (!message) continue;
    const role = rec.type;
    const content = message.content;
    const texts: string[] = [];
    const tools: string[] = [];
    if (typeof content === "string") texts.push(content);
    else if (Array.isArray(content))
      for (const part of content) {
        const block = record(part);
        if (!block) continue;
        if (block.type === "text" && typeof block.text === "string")
          texts.push(block.text);
        else if (
          role === "assistant" &&
          block.type === "tool_use" &&
          typeof block.name === "string"
        )
          tools.push(block.name);
        // tool_result, thinking and images are not conversation text.
      }
    const text = texts.join("\n\n").trim();
    const identity = typeof rec.uuid === "string" ? { nativeId: rec.uuid } : {};
    const modelId =
      role === "assistant" && typeof message.model === "string"
        ? message.model.trim()
        : "";
    const modelSettings = record(message.modelSettings);
    const rawEffort =
      typeof message.effort === "string"
        ? message.effort.trim()
        : typeof modelSettings?.effort === "string"
          ? modelSettings.effort.trim()
          : "";
    const effort = CLAUDE_TURN_EFFORTS.has(rawEffort) ? rawEffort : "";
    const turnModel = modelId
      ? {
          harness: "claude" as const,
          id: modelId,
          name: resolveModel("claude", modelId).name,
          ...(effort ? { settings: { effort } } : {}),
        }
      : undefined;
    if (text && !(role === "user" && injectedUserText(text)))
      items.push({
        role,
        text: cap(text),
        ...at(rec),
        ...identity,
        ...(turnModel ? { turnModel } : {}),
      });
    for (const name of tools)
      items.push({
        role: "tool",
        text: name,
        ...at(rec),
        ...identity,
        ...(turnModel ? { turnModel } : {}),
      });
  }
  return items;
}

function codexItems(lines: Record<string, unknown>[]): Omit<HistoryItem, "id">[] {
  const items: Omit<HistoryItem, "id">[] = [];
  for (const rec of lines) {
    if (rec.type !== "response_item") continue;
    const payload = record(rec.payload);
    if (!payload) continue;
    if (payload.type === "message") {
      const role =
        payload.role === "assistant"
          ? "assistant"
          : payload.role === "user"
            ? "user"
            : null;
      if (!role || !Array.isArray(payload.content)) continue;
      const wanted = role === "user" ? "input_text" : "output_text";
      const text = payload.content
        .map((part) => record(part))
        .filter((part) => part?.type === wanted && typeof part.text === "string")
        .map((part) => String(part?.text))
        .join("\n\n")
        .trim();
      if (text && !(role === "user" && injectedUserText(text)))
        items.push({ role, text: cap(text), ...at(rec) });
    } else if (
      (payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "local_shell_call") &&
      (typeof payload.name === "string" || payload.type === "local_shell_call")
    ) {
      items.push({
        role: "tool",
        text: typeof payload.name === "string" ? payload.name : "shell",
        ...at(rec),
      });
    }
  }
  return items;
}

/**
 * Ordered, display-only items from one chunk of a Claude JSONL or Codex
 * rollout. Unknown envelopes are skipped, never thrown: schemas drift.
 */
export function parseProviderHistory(
  provider: NativeProvider,
  jsonl: string,
  idPrefix: string,
  expectedNativeId?: string,
): HistoryItem[] {
  const lines = parseLines(jsonl);
  const items =
    provider === "claude"
      ? claudeItems(lines, expectedNativeId)
      : codexItems(lines);
  return items.map((item, index) => ({
    ...item,
    id: `${HISTORY_BLOCK_PREFIX}${idPrefix}:${index}`,
  }));
}

/** Transcript blocks for display only; never stored, sent or counted as turns. */
export function historyBlocks(items: readonly HistoryItem[]): Block[] {
  return items.map((item) =>
    item.role === "tool"
      ? {
          id: item.id,
          role: "tool",
          text: item.text,
          tool: { title: item.text, kind: "other", status: "completed" },
          ...(item.turnModel ? { turnModel: item.turnModel } : {}),
        }
      : {
          id: item.id,
          role: item.role,
          text: item.text,
          ...(item.turnModel ? { turnModel: item.turnModel } : {}),
          ...(item.at && item.role === "user" ? { startedAt: item.at } : {}),
        },
  );
}

/**
 * Drop provider items recorded at or after MonoCode's own first turn. Those
 * turns are already in the session's blocks (the provider file also holds
 * them once the chat has been continued here), so showing both would repeat them.
 */
export function trimHistoryBefore(
  items: readonly HistoryItem[],
  cutoffMs: number | undefined,
  representedNativeIds?: ReadonlySet<string>,
): HistoryItem[] {
  // Provider timestamps can precede the moment MonoCode receives the phone turn.
  // Trim the entire replayed suffix, including undated responses and tools.
  const boundary = items.findIndex((item) => item.nativeId !== undefined && representedNativeIds?.has(item.nativeId));
  const earlier = boundary < 0 ? items : items.slice(0, boundary);
  if (cutoffMs === undefined) return [...earlier];
  return earlier.filter((item) => item.at === undefined || item.at < cutoffMs);
}

/** What the transcript renders: history above the session's own blocks. */
export function withHistory(history: Block[], blocks: Block[]): Block[] {
  return history.length === 0 ? blocks : [...history, ...blocks];
}

/**
 * Merge read-only native turns around saved MonoCode turns. Keep the richer
 * local blocks for turns we already own, but retain later external turns.
 * Native data is never assigned to session.blocks or used as a send payload.
 */
export function reconcileNativeHistory(
  items: readonly HistoryItem[],
  local: Block[],
): Block[] {
  if (items.length === 0) return local;
  if (local.length === 0) return historyBlocks(items);
  const turns: Block[][] = [];
  const leading: Block[] = [];
  for (const block of local) {
    if (block.role === "user") turns.push([block]);
    else if (turns.length) turns[turns.length - 1].push(block);
    else leading.push(block);
  }
  const groups: HistoryItem[][] = [];
  for (const item of items) {
    if (item.role === "user" || groups.length === 0) groups.push([item]);
    else groups[groups.length - 1].push(item);
  }
  const buckets: HistoryItem[][] = Array.from(
    { length: turns.length + 1 },
    () => [],
  );
  const matchedLocal = new Set<number>();
  const prompts = turns.map(([user]) =>
    cap(user.text.replace(/^\s*\/operator\s+/, "")),
  );
  let afterMatched = 0;
  for (const group of groups) {
    const first = group[0];
    const matched =
      first.role === "user"
        ? turns.findIndex(([user], index) => {
            if (
              first.nativeId &&
              (first.nativeId === user.providerMessageId ||
                first.nativeId === user.externalTurnId)
            )
              return true;
            if (matchedLocal.has(index)) return false;
            if (
              first.at === undefined ||
              user.startedAt === undefined ||
              user.draft
            )
              return false;
            const end = user.startedAt + (user.durationMs ?? 60_000);
            if (first.at < user.startedAt - 2_000 || first.at > end)
              return false;
            const localText = prompts[index];
            if (
              first.text !== localText &&
              !first.text.endsWith(`\n${localText}`) &&
              !first.text.startsWith(`${localText}\n\n<monocode_app>`)
            )
              return false;
            // Require matching prompt text as well as time: two different prompts
            // sent in quick succession must never suppress an external turn.
            return true;
          })
        : -1;
    if (matched >= 0) {
      matchedLocal.add(matched);
      afterMatched = matched + 1;
      continue;
    }
    // A chunk can start inside our own reply. It has no user boundary to
    // match, so omit that fragment; the saved local reply is authoritative.
    const recordedAt = first.at;
    if (
      first.role !== "user" &&
      recordedAt !== undefined &&
      turns.some(
        ([user]) =>
          user.startedAt !== undefined &&
          recordedAt >= user.startedAt - 2_000 &&
          recordedAt <= user.startedAt + (user.durationMs ?? 60_000) + 2_000,
      )
    )
      continue;
    let bucket = afterMatched;
    if (recordedAt !== undefined) {
      const next = turns.findIndex(
        ([user]) => user.startedAt !== undefined && user.startedAt > recordedAt,
      );
      bucket = next < 0 ? turns.length : next;
    }
    buckets[bucket].push(...group);
  }
  const shown: Block[] = [...leading];
  for (let index = 0; index < buckets.length; index++) {
    if (buckets[index].length) {
      shown.push(...historyBlocks(buckets[index]));
    }
    if (index < turns.length) shown.push(...turns[index]);
  }
  if (!shown.some(isHistoryBlock)) return local;
  return shown;
}

export type HistoryChunk = { text: string; start: number; hasEarlier: boolean };

export type HistoryLoader = {
  source: (sessionId: string) => Promise<{ key: string } | null>;
  read: (input: {
    key: string;
    provider: NativeProvider;
    accountId: string;
    end?: number;
  }) => Promise<HistoryChunk>;
};

export const tauriHistoryLoader: HistoryLoader = {
  source: (sessionId) =>
    invoke<{ key: string; cwd: string } | null>(
      "provider_sessions_for_session",
      { sessionId },
    ),
  read: ({ key, provider, accountId, end }) =>
    invoke<HistoryChunk>("provider_sessions_history", {
      key,
      provider,
      accountId,
      end: end ?? null,
    }),
};

function nativeIdFromKey(key: string, provider: NativeProvider): string | undefined {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) &&
      parts.length === 3 &&
      parts[0] === provider &&
      typeof parts[2] === "string" &&
      parts[2].trim()
      ? parts[2]
      : undefined;
  } catch {
    return undefined;
  }
}

export type NativeHistoryState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      provider: NativeProvider;
      /** Oldest first, everything parsed so far. */
      items: HistoryItem[];
      visible: number;
      hasEarlier: boolean;
      loadingEarlier: boolean;
      /** Set when an earlier chunk failed to load; the loaded part stays. */
      earlierError?: string;
    };

const NONE: NativeHistoryState = { status: "none" };

/**
 * Per-session read-only history cache. Loaded when a Claude/Codex chat with a
 * native binding is shown; read through the provider's own store, never
 * written, never persisted as MonoCode turns, never sent to the provider.
 */
export class NativeHistoryStore {
  private states = new Map<string, NativeHistoryState>();
  private started = new Set<string>();
  private requests = new Map<string, object>();
  private cursors = new Map<
    string,
    { key: string; accountId: string; end: number; nativeId?: string }
  >();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly loader: HistoryLoader = tauriHistoryLoader) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;
  get(sessionId: string): NativeHistoryState {
    return this.states.get(sessionId) ?? NONE;
  }

  private set(sessionId: string, state: NativeHistoryState): void {
    this.states.set(sessionId, state);
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  /** Once per session id per app run; `reload` retries a failure. */
  async ensureLoaded(
    sessionId: string,
    harness: HarnessId,
    accountId: string,
    reload = false,
  ): Promise<void> {
    if (harness !== "claude" && harness !== "codex") return;
    if (this.started.has(sessionId) && !reload) return;
    this.started.add(sessionId);
    const request = {};
    this.requests.set(sessionId, request);
    this.cursors.delete(sessionId);
    this.set(sessionId, { status: "loading" });
    try {
      const source = await this.loader.source(sessionId);
      if (this.requests.get(sessionId) !== request) return;
      if (!source) {
        this.set(sessionId, NONE);
        return;
      }
      const chunk = await this.loader.read({ key: source.key, provider: harness, accountId });
      if (this.requests.get(sessionId) !== request) return;
      const nativeId = nativeIdFromKey(source.key, harness);
      this.cursors.set(sessionId, {
        key: source.key,
        accountId,
        end: chunk.start,
        nativeId,
      });
      const items = parseProviderHistory(
        harness,
        chunk.text,
        String(chunk.start),
        nativeId,
      );
      this.set(sessionId, {
        status: "ready",
        provider: harness,
        items,
        visible: Math.min(items.length, HISTORY_PAGE_ITEMS),
        hasEarlier: chunk.hasEarlier,
        loadingEarlier: false,
      });
    } catch (error) {
      if (this.requests.get(sessionId) !== request) return;
      this.set(sessionId, {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Reveal more parsed messages, loading an earlier file chunk when they run out. */
  async showEarlier(sessionId: string): Promise<void> {
    const state = this.get(sessionId);
    if (state.status !== "ready" || state.loadingEarlier) return;
    if (state.visible < state.items.length) {
      this.set(sessionId, {
        ...state,
        visible: Math.min(state.items.length, state.visible + HISTORY_PAGE_ITEMS),
      });
      return;
    }
    const cursor = this.cursors.get(sessionId);
    const request = this.requests.get(sessionId);
    if (!state.hasEarlier || !cursor) return;
    this.set(sessionId, { ...state, loadingEarlier: true, earlierError: undefined });
    try {
      const chunk = await this.loader.read({
        key: cursor.key,
        provider: state.provider,
        accountId: cursor.accountId,
        end: cursor.end,
      });
      const latest = this.get(sessionId);
      if (latest.status !== "ready" || this.requests.get(sessionId) !== request) return;
      this.cursors.set(sessionId, { ...cursor, end: chunk.start });
      const earlier = parseProviderHistory(
        state.provider,
        chunk.text,
        String(chunk.start),
        cursor.nativeId,
      );
      const items = [...earlier, ...latest.items];
      this.set(sessionId, {
        ...latest,
        items,
        visible: Math.min(items.length, latest.visible + HISTORY_PAGE_ITEMS),
        hasEarlier: chunk.hasEarlier,
        loadingEarlier: false,
      });
    } catch (error) {
      const latest = this.get(sessionId);
      if (latest.status !== "ready" || this.requests.get(sessionId) !== request) return;
      this.set(sessionId, {
        ...latest,
        loadingEarlier: false,
        earlierError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Drop a deleted chat's cache and invalidate any read still in flight. */
  forget(sessionId: string): void {
    this.started.delete(sessionId);
    this.requests.delete(sessionId);
    this.cursors.delete(sessionId);
    if (this.states.delete(sessionId)) {
      this.version += 1;
      for (const listener of [...this.listeners]) listener();
    }
  }
}

export const nativeHistoryStore = new NativeHistoryStore();

/** Messages currently shown, newest `visible` of what has been parsed. */
export function visibleHistoryItems(state: NativeHistoryState): HistoryItem[] {
  if (state.status !== "ready") return [];
  return state.items.slice(state.items.length - state.visible);
}
