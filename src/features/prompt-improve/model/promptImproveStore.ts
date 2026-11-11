import {
  parseAiHelperTarget,
  type AiHelperTarget,
} from "../../settings/model/settings";
import {
  SESSION_AI_EFFORTS,
  type SessionAiEffort,
} from "../../sessions/model/sessionMetadataAi";
import { projectKey } from "../../../shared/lib/paths";
import type { EditSample, LearnedLines } from "./promptImprove";

/**
 * Improve prompt settings and memory (fork, L-252). Both are per device
 * (localStorage) and never leave this computer except inside a helper prompt.
 */
export type PromptImproveSettings = {
  /** Show ✨ in the composers. */
  enabled: boolean;
  /** A chosen helper model; null uses the AI helper settings. */
  helper: AiHelperTarget | null;
  /** Missing lets the provider pick. */
  effort?: SessionAiEffort;
  /** Empty uses `DEFAULT_IMPROVE_INSTRUCTIONS`. */
  instructions: string;
  /** Learn the profile, glossary and rules from runs and edits. */
  learn: boolean;
  /** Offer "Add to AGENTS.md" for a rule said in `RULE_SUGGEST_AT` prompts. */
  suggestRules: boolean;
};

export type RuleState = "added" | "never";

export type ProjectRule = {
  text: string;
  /** Prompts that stated this rule. */
  count: number;
  state?: RuleState;
  /** "Not now" hides the offer until the count reaches this again. */
  snoozedUntil?: number;
};

export type ProjectMemory = {
  /** Folder name, for Settings. */
  name: string;
  /** One `term = meaning` per line; editable in Settings. */
  glossary: string;
  rules: ProjectRule[];
};

export type StoredEditSample = EditSample & { at: number };

export type PromptMemory = {
  /** "How I write": learned lines plus the owner's own edits. */
  profile: string;
  projects: Record<string, ProjectMemory>;
  /** Edited rewrites waiting to be learned, oldest first. */
  samples: StoredEditSample[];
  accepted: number;
  edited: number;
};

export const RULE_SUGGEST_AT = 3;
const PROFILE_MAX = 2_000;
const GLOSSARY_MAX_LINES = 40;
const RULES_MAX = 30;
const SAMPLES_MAX = 8;
const SAMPLE_CHARS = 1_500;

const SETTINGS_KEY = "monocode.promptImprove";
const SETTINGS_EVENT = "monocode:prompt-improve-change";
const MEMORY_KEY = "monocode.promptMemory";
const MEMORY_EVENT = "monocode:prompt-memory-change";

export const DEFAULT_PROMPT_IMPROVE: PromptImproveSettings = {
  enabled: true,
  helper: null,
  instructions: "",
  learn: true,
  suggestRules: true,
};

export const EMPTY_PROMPT_MEMORY: PromptMemory = {
  profile: "",
  projects: {},
  samples: [],
  accepted: 0,
  edited: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, event: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or quota: the change lives until reload
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}

function subscribeKey(
  key: string,
  event: string,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (storage: StorageEvent): void => {
    if (storage.key === key) listener();
  };
  window.addEventListener(event, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Parse once per stored string, so the value is stable for `useSyncExternalStore`. */
function cachedLoader<T>(
  key: string,
  parse: (raw: unknown) => T,
  fallback: T,
): () => T {
  let cache: { raw: string | null; value: T } | null = null;
  return () => {
    const raw = readRaw(key);
    if (cache && cache.raw === raw) return cache.value;
    let value = fallback;
    try {
      value = raw == null ? fallback : parse(JSON.parse(raw));
    } catch {
      value = fallback;
    }
    cache = { raw, value };
    return value;
  };
}

function isEffort(value: unknown): value is SessionAiEffort {
  return SESSION_AI_EFFORTS.some((effort) => effort === value);
}

export function parsePromptImproveSettings(
  raw: unknown,
): PromptImproveSettings {
  if (!isRecord(raw)) return DEFAULT_PROMPT_IMPROVE;
  return {
    enabled: raw.enabled !== false,
    helper: parseAiHelperTarget(raw.helper),
    instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    learn: raw.learn !== false,
    suggestRules: raw.suggestRules !== false,
    ...(isEffort(raw.effort) ? { effort: raw.effort } : {}),
  };
}

function parseRule(raw: unknown): ProjectRule | null {
  if (!isRecord(raw) || typeof raw.text !== "string" || !raw.text.trim())
    return null;
  const count =
    typeof raw.count === "number" && raw.count > 0 ? Math.floor(raw.count) : 1;
  return {
    text: raw.text,
    count,
    ...(raw.state === "added" || raw.state === "never"
      ? { state: raw.state }
      : {}),
    ...(typeof raw.snoozedUntil === "number"
      ? { snoozedUntil: raw.snoozedUntil }
      : {}),
  };
}

function parseProject(raw: unknown): ProjectMemory | null {
  if (!isRecord(raw)) return null;
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    glossary: typeof raw.glossary === "string" ? raw.glossary : "",
    rules: Array.isArray(raw.rules)
      ? raw.rules
          .map(parseRule)
          .filter((rule): rule is ProjectRule => rule !== null)
      : [],
  };
}

function parseSample(raw: unknown): StoredEditSample | null {
  if (
    !isRecord(raw) ||
    typeof raw.rewrite !== "string" ||
    typeof raw.sent !== "string"
  )
    return null;
  return {
    rewrite: raw.rewrite,
    sent: raw.sent,
    at: typeof raw.at === "number" ? raw.at : 0,
  };
}

const count = (value: unknown) =>
  typeof value === "number" && value > 0 ? Math.floor(value) : 0;

export function parsePromptMemory(raw: unknown): PromptMemory {
  if (!isRecord(raw)) return EMPTY_PROMPT_MEMORY;
  const projects: Record<string, ProjectMemory> = {};
  if (isRecord(raw.projects)) {
    for (const [key, value] of Object.entries(raw.projects)) {
      const project = parseProject(value);
      if (project) projects[key] = project;
    }
  }
  return {
    profile: typeof raw.profile === "string" ? raw.profile : "",
    projects,
    samples: Array.isArray(raw.samples)
      ? raw.samples
          .map(parseSample)
          .filter((sample): sample is StoredEditSample => sample !== null)
          .slice(-SAMPLES_MAX)
      : [],
    accepted: count(raw.accepted),
    edited: count(raw.edited),
  };
}

export const loadPromptImproveSettings = cachedLoader(
  SETTINGS_KEY,
  parsePromptImproveSettings,
  DEFAULT_PROMPT_IMPROVE,
);

export function savePromptImproveSettings(next: PromptImproveSettings): void {
  writeJson(SETTINGS_KEY, next, SETTINGS_EVENT);
}

export function subscribePromptImproveSettings(
  listener: () => void,
): () => void {
  return subscribeKey(SETTINGS_KEY, SETTINGS_EVENT, listener);
}

export const loadPromptMemory = cachedLoader(
  MEMORY_KEY,
  parsePromptMemory,
  EMPTY_PROMPT_MEMORY,
);

export function savePromptMemory(next: PromptMemory): void {
  writeJson(MEMORY_KEY, next, MEMORY_EVENT);
}

export function subscribePromptMemory(listener: () => void): () => void {
  return subscribeKey(MEMORY_KEY, MEMORY_EVENT, listener);
}

export function clearPromptMemory(): void {
  savePromptMemory(EMPTY_PROMPT_MEMORY);
}

/** Memory is keyed by project folder, the same key the sidebar uses. */
export function memoryProjectKey(cwd: string): string {
  return projectKey(cwd);
}

export function memoryProjectName(cwd: string): string {
  return (
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || cwd
  );
}

function emptyProject(cwd: string): ProjectMemory {
  return { name: memoryProjectName(cwd), glossary: "", rules: [] };
}

/** Lowercase, single spaces, no closing period or quotes: how rules match. */
export function normalizeRule(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!;\s]+$/, "")
    .trim();
}

function glossaryKey(line: string): string {
  return normalizeRule(line.split(/\s*[=:—–]\s*/)[0] ?? line);
}

function addProfileLines(profile: string, styles: readonly string[]): string {
  let next = profile;
  const known = new Set(
    profile
      .split("\n")
      .map((line) => normalizeRule(line.replace(/^\s*[-*]\s*/, ""))),
  );
  for (const style of styles) {
    const key = normalizeRule(style);
    if (!key || known.has(key)) continue;
    const line = `- ${style.trim()}`;
    const joined = next.trim() ? `${next.replace(/\s+$/, "")}\n${line}` : line;
    if (joined.length > PROFILE_MAX) break;
    next = joined;
    known.add(key);
  }
  return next;
}

function addGlossaryLines(glossary: string, terms: readonly string[]): string {
  const lines = glossary.split("\n").filter((line) => line.trim());
  const known = new Set(lines.map(glossaryKey));
  for (const term of terms) {
    const key = glossaryKey(term);
    if (!key || known.has(key) || lines.length >= GLOSSARY_MAX_LINES) continue;
    lines.push(term.trim());
    known.add(key);
  }
  return lines.join("\n");
}

function countRules(
  rules: readonly ProjectRule[],
  stated: readonly string[],
): ProjectRule[] {
  const next = rules.map((rule) => ({ ...rule }));
  const seen = new Set<string>();
  for (const text of stated) {
    const key = normalizeRule(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const existing = next.find((rule) => normalizeRule(rule.text) === key);
    if (existing) existing.count += 1;
    else next.push({ text: text.trim(), count: 1 });
  }
  if (next.length <= RULES_MAX) return next;
  // Keep rules the owner acted on, then the most repeated, newest first on ties.
  const ranked = next
    .map((rule, index) => ({ rule, index }))
    .sort(
      (a, b) =>
        Number(b.rule.state !== undefined) -
          Number(a.rule.state !== undefined) ||
        b.rule.count - a.rule.count ||
        b.index - a.index,
    )
    .slice(0, RULES_MAX)
    .sort((a, b) => a.index - b.index);
  return ranked.map(({ rule }) => rule);
}

/** The rule to offer for AGENTS.md, if one has reached the threshold. */
export function ruleSuggestion(
  project: ProjectMemory | undefined,
): ProjectRule | null {
  if (!project) return null;
  return (
    project.rules.find(
      (rule) =>
        rule.state === undefined &&
        rule.count >= Math.max(RULE_SUGGEST_AT, rule.snoozedUntil ?? 0),
    ) ?? null
  );
}

/**
 * Fold one run's learned lines into memory. `usedSamples` were in the
 * prompt and are dropped, learned or not, so they are never sent twice.
 */
export function applyLearned(
  memory: PromptMemory,
  input: { cwd: string; learned: LearnedLines; usedSamples: number },
): PromptMemory {
  const key = memoryProjectKey(input.cwd);
  const project = memory.projects[key] ?? emptyProject(input.cwd);
  const nextProject: ProjectMemory = {
    ...project,
    glossary: addGlossaryLines(project.glossary, input.learned.terms),
    rules: countRules(project.rules, input.learned.rules),
  };
  const touched =
    input.learned.terms.length > 0 || input.learned.rules.length > 0;
  return {
    ...memory,
    profile: addProfileLines(memory.profile, input.learned.styles),
    projects:
      touched || memory.projects[key]
        ? { ...memory.projects, [key]: nextProject }
        : memory.projects,
    samples: memory.samples.slice(
      Math.min(input.usedSamples, memory.samples.length),
    ),
  };
}

function clip(text: string): string {
  return text.length > SAMPLE_CHARS ? `${text.slice(0, SAMPLE_CHARS)}…` : text;
}

/**
 * What was sent after a rewrite: unchanged counts as accepted; changed is
 * kept as a sample so the next run learns from the edit.
 */
export function recordSentRewrite(
  memory: PromptMemory,
  input: { rewrite: string; sent: string; now: number },
): PromptMemory {
  const rewrite = input.rewrite.trim();
  const sent = input.sent.trim();
  if (!sent) return memory;
  if (sent === rewrite) return { ...memory, accepted: memory.accepted + 1 };
  return {
    ...memory,
    edited: memory.edited + 1,
    samples: [
      ...memory.samples,
      { rewrite: clip(rewrite), sent: clip(sent), at: input.now },
    ].slice(-SAMPLES_MAX),
  };
}

export function setRuleState(
  memory: PromptMemory,
  cwd: string,
  text: string,
  change: { state: RuleState } | { snooze: true },
): PromptMemory {
  const key = memoryProjectKey(cwd);
  const project = memory.projects[key];
  if (!project) return memory;
  const target = normalizeRule(text);
  const rules = project.rules.map((rule) => {
    if (normalizeRule(rule.text) !== target) return rule;
    return "state" in change
      ? { ...rule, state: change.state }
      : { ...rule, snoozedUntil: rule.count + RULE_SUGGEST_AT };
  });
  return {
    ...memory,
    projects: { ...memory.projects, [key]: { ...project, rules } },
  };
}

export function setProjectGlossary(
  memory: PromptMemory,
  key: string,
  glossary: string,
): PromptMemory {
  const project = memory.projects[key];
  if (!project) return memory;
  return {
    ...memory,
    projects: { ...memory.projects, [key]: { ...project, glossary } },
  };
}

export function removeProjectMemory(
  memory: PromptMemory,
  key: string,
): PromptMemory {
  if (!memory.projects[key]) return memory;
  const { [key]: _removed, ...projects } = memory.projects;
  return { ...memory, projects };
}
