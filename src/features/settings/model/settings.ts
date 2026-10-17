import {
  ALT,
  IS_MAC,
  IS_WIN,
  MOD,
  SHIFT,
} from "../../../platform/tauri/platform";
import {
  canonicalShortcut,
  isGlobalShortcut,
  QUICK_COMPOSER_DEFAULT_SHORTCUT,
  quickComposerShortcutLabel,
  shortcutFromKeyEvent,
  shortcutTokens,
} from "../../quick-composer/model/quickComposerShortcut";
import { readFlag, writeFlag } from "./storageFlags";
import type { HarnessId } from "../../sessions/model/session";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "../../providers/model/providerAccounts";

const SECTION_KEY = "monocode.settingsSection";

export type SettingsSectionId =
  | "general"
  | "connections"
  | "appearance"
  | "keybindings"
  | "chat"
  | "providers"
  | "debug-inspector"
  | "mcp"
  | "skills"
  | "prompts"
  | "monos"
  | "inbox"
  | "worktrees"
  | "archive"
  | "migration"
  | "experimentation";

/** Rail buckets. Sections list in order under their group label. */
export type SettingsGroupId = "app" | "agents" | "workspace";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
  { id: "app", label: "App" },
  { id: "agents", label: "Agents" },
  { id: "workspace", label: "Workspace" },
];

export type SettingsSection = {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  /** Extra words search matches the section on, beyond its label. */
  keywords?: string;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    group: "app",
    label: "General",
    description:
      "The build you are running, how MonoCode reaches you, and the panels it shows.",
    keywords: "version update sounds notifications notes rail",
  },
  {
    id: "connections",
    group: "app",
    label: "Connections",
    description: "Connect your machines and run agents remotely through SSH.",
    keywords: "ssh remote host machine server environment always on",
  },
  {
    id: "appearance",
    group: "app",
    label: "Appearance",
    description:
      "Theme, tint, translucency, workspace layout, and conversation backgrounds.",
    keywords:
      "theme dark light color accent glass blur zoom scale wallpaper rail sidebar",
  },
  {
    id: "keybindings",
    group: "app",
    label: "Keybindings",
    description:
      "Every shortcut the workspace handles, from the app menu and the key handler.",
    keywords: "shortcut hotkey keyboard binding",
  },
  {
    id: "chat",
    group: "agents",
    label: "Chat",
    description:
      "How transcripts read, what the composer does with a follow-up, how files save, and how diffs open.",
    keywords:
      "transcript composer prompt message diff review layout format save editor",
  },
  {
    id: "providers",
    group: "agents",
    label: "Providers",
    description:
      "Provider accounts, agent CLIs MonoCode can drive, and the model new sessions start with.",
    keywords:
      "account sign in login model harness claude codex gemini cli default hooks",
  },
  {
    id: "debug-inspector",
    group: "agents",
    label: "Debug Inspector",
    description: "Read-only execution metadata, local usage evidence and observed account quota.",
    keywords: "debug trace tokens cache usage quota inspector diagnostics",
  },
  {
    id: "mcp",
    group: "agents",
    label: "MCP",
    description:
      "Find MCP servers across providers and manage their connections.",
    keywords:
      "tools servers connections oauth authenticate login claude codex cursor opencode",
  },
  {
    id: "skills",
    group: "agents",
    label: "Skills",
    description:
      "Discover and manage file skills from project, personal, and harness folders.",
    keywords: "skill instructions prompt",
  },
  {
    id: "prompts",
    group: "agents",
    label: "Prompts",
    description:
      "Save keywords, phrases and prompts you reuse. Type ! in any composer to insert one.",
    keywords: "saved prompt snippet template phrase keyword reuse insert",
  },
  {
    id: "monos",
    group: "agents",
    label: "Monos",
    description:
      "The resident agent beside your tabs, and which projects have one.",
    keywords: "mono resident agent mascot claim project title bar",
  },
  {
    id: "inbox",
    group: "workspace",
    label: "Inbox",
    description:
      "Manage Inbox services and notification preferences for each project.",
    keywords:
      "github gitlab linear jira atlassian azure devops connect token integration",
  },
  {
    id: "archive",
    group: "workspace",
    label: "Archive",
    description: "Projects and conversations you have archived.",
    keywords: "archived restore delete hidden",
  },
  {
    id: "worktrees",
    group: "workspace",
    label: "Worktrees",
    description: "Manage additional worktrees for each project.",
    keywords: "git branch worktree working copy project create delete",
  },
  {
    id: "migration",
    group: "workspace",
    label: "Migration",
    description:
      "Import past Claude and Codex sessions — resume natively or replay as history.",
  },
  {
    id: "experimentation",
    group: "app",
    label: "Experimentation",
    description: "Preview features that may change or use estimated data.",
  },
];

export function settingsSectionsByGroup(): {
  id: SettingsGroupId;
  label: string;
  sections: SettingsSection[];
}[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: SETTINGS_SECTIONS.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}

/**
 * One searchable control. `id` is the row's `data-setting-id` in SettingsView,
 * which is also what Settings scrolls to when it opens on an anchor.
 */
export type SettingsEntry = {
  id: string;
  section: SettingsSectionId;
  label: string;
  keywords?: string;
};

export const SETTINGS_INDEX: SettingsEntry[] = [
  {
    id: "remote-machines",
    section: "connections",
    label: "Your machines",
    keywords: "ssh remote connect host server environment",
  },
  {
    id: "mcp-servers",
    section: "mcp",
    label: "MCP servers",
    keywords: "claude tools connections oauth authenticate login add remove",
  },
  {
    id: "monos-enabled",
    section: "monos",
    label: "Show monos",
    keywords: "mono agent rail hide",
  },
  {
    id: "rail-monos-pinned",
    section: "monos",
    label: "Pin monos to the icon rail",
    keywords: "mono rail compact collapsed icons top divider project picker",
  },
  {
    id: "mono-list",
    section: "monos",
    label: "Your monos",
    keywords:
      "mono reset soul name projects sessions sidebar visibility hidden show",
  },
  {
    id: "project-worktrees",
    section: "worktrees",
    label: "Project worktrees",
    keywords: "git branch working copy create delete manage",
  },
  {
    id: "update",
    section: "general",
    label: "Version",
    keywords: "update upgrade release what's new build changelog",
  },
  {
    id: "sounds",
    section: "general",
    label: "Sounds",
    keywords: "audio cue chime mute volume",
  },
  {
    id: "notifications",
    section: "general",
    label: "Notifications",
    keywords: "notify alert toast permission reminder background",
  },
  {
    id: "notes",
    section: "general",
    label: "Notes",
    keywords: "notebook markdown rail scratchpad",
  },
  ...(IS_MAC || IS_WIN
    ? [
        {
          id: "quick-composer",
          section: "general" as const,
          label: "Quick composer",
          keywords: "spotlight global shortcut hotkey floating prompt anywhere",
        },
      ]
    : []),
  {
    id: "working-agents",
    section: "general",
    label: "Working agents",
    keywords: "live running sessions rail card",
  },
  {
    id: "file-tabs",
    section: "general",
    label: "File tabs",
    keywords: "editor open top workspace normal session pane beside chat",
  },
  {
    id: "file-opening-behavior",
    section: "general",
    label: "File behaviour",
    keywords: "open new current both tab reuse current alt click unsaved file",
  },
  {
    id: "session-opening-behavior",
    section: "general",
    label: "Session behaviour",
    keywords: "open new current both tab reuse current alt click session chat",
  },
  {
    id: "tab-animations",
    section: "general",
    label: "Tab animations",
    keywords: "motion open close resize transition",
  },
  {
    id: "check-providers-on-startup",
    section: "general",
    label: "Check providers when MonoCode opens",
    keywords: "startup launch background provider models ready check refresh",
  },
  ...(IS_WIN
    ? [
        {
          id: "close-to-tray",
          section: "general" as const,
          label: "Close to tray",
          keywords: "minimize background quit exit window taskbar windows",
        },
      ]
    : []),
  {
    id: "theme",
    section: "appearance",
    label: "Theme",
    keywords: "dark light system appearance mode",
  },
  {
    id: "accent-color",
    section: "appearance",
    label: "Accent color",
    keywords: "highlight bubble send button tint",
  },
  {
    id: "diff-colors",
    section: "appearance",
    label: "Diff colors",
    keywords:
      "colorblind color blind accessibility added removed red green blue orange high contrast changes",
  },
  {
    id: "hue",
    section: "appearance",
    label: "Hue",
    keywords: "tint color chrome",
  },
  {
    id: "saturation",
    section: "appearance",
    label: "Saturation",
    keywords: "tint color neutral grey gray",
  },
  {
    id: "dark-lightness",
    section: "appearance",
    label: "Dark-mode lightness",
    keywords: "black brightness contrast background",
  },
  {
    id: "sidebar-opacity",
    section: "appearance",
    label: "Sidebar opacity",
    keywords: "glass translucent transparency vibrancy",
  },
  {
    id: "blur",
    section: "appearance",
    label: "Blur radius",
    keywords: "glass translucent vibrancy backdrop",
  },
  {
    id: "main-pane-glass",
    section: "appearance",
    label: "Main pane glass",
    keywords: "translucent transparency body window",
  },
  {
    id: "interface-scale",
    section: "appearance",
    label: "Interface scale",
    keywords: "zoom font size bigger smaller ui",
  },
  {
    id: "collapsed-project-rail",
    section: "appearance",
    label: "Collapsed project rail",
    keywords: "sidebar compact icons hidden navigation layout",
  },
  {
    id: "show-excluded-files",
    section: "appearance",
    label: "Show excluded files",
    keywords: "explorer gitignore ignored hidden files tree",
  },
  {
    id: "chat-background",
    section: "appearance",
    label: "Chat background",
    keywords: "wallpaper image picture opacity backdrop",
  },
  {
    id: "glass-strength",
    section: "appearance",
    label: "Glass strength",
    keywords: "glass tint blur wallpaper acrylic strength",
  },
  {
    id: "windows-wallpaper",
    section: "appearance",
    label: "Windows wallpaper",
    keywords: "wallpaper image background picture desktop",
  },
  {
    id: "wallpaper-opacity",
    section: "appearance",
    label: "Wallpaper opacity",
    keywords: "wallpaper opacity strength image",
  },
  {
    id: "wallpaper-effect",
    section: "appearance",
    label: "Wallpaper effect",
    keywords: "wallpaper effect dither ascii halftone scanlines print dots",
  },
  {
    id: "menu-surface-tint",
    section: "appearance",
    label: "Menu surface tint",
    keywords: "menu popover dropdown tint translucent",
  },
    {
    id: "menu-item-highlight",
    section: "appearance",
    label: "Menu item highlight",
    keywords: "menu hover highlight marker",
  },
  {
    id: "menu-backdrop-blur",
    section: "appearance",
    label: "Menu backdrop blur",
    keywords: "menu popover blur backdrop",
  },
  {
    id: "transcript-layout",
    section: "chat",
    label: "Transcript layout",
    keywords: "full width chat bubble message",
  },
  {
    id: "anchor-prompts",
    section: "chat",
    label: "Anchor prompts to top",
    keywords: "scroll position sticky message",
  },
  {
    id: "follow-up",
    section: "chat",
    label: "Follow-up behavior",
    keywords: "queue steer interrupt send while running",
  },
  {
    id: "model-controls",
    section: "chat",
    label: "Model controls",
    keywords:
      "effort thinking reasoning fast service tier model picker composer",
  },
  {
    id: "ai-helper",
    section: "chat",
    label: "AI helper",
    keywords: "title commit pull request pr description helper model fallback",
  },
  {
    id: "composer-autocorrect",
    section: "chat",
    label: "Autocorrect",
    keywords: "spelling spell check autocorrect typo macos composer",
  },
  {
    id: "composer-mascot",
    section: "chat",
    label: "Composer mascot",
    keywords: "runner animation coin fun",
  },
  {
    id: "format-on-save",
    section: "chat",
    label: "Format on save",
    keywords: "prettier quotes editor save format",
  },
  {
    id: "diff-view",
    section: "chat",
    label: "Diff view",
    keywords: "unified editor review changes working tree",
  },
  {
    id: "empty-session-games",
    section: "chat",
    label: "Empty session games",
    keywords: "pacman snake arcade grid fun",
  },
  {
    id: "agent-clis",
    section: "providers",
    label: "Agent CLIs",
    keywords:
      "codex opencode cursor grok pi omp fx hermes antigravity devin binary path",
  },
  {
    id: "provider-accounts",
    section: "providers",
    label: "Provider accounts",
    keywords:
      "account sign in login rename remove delete credentials profile usage limit quota exhausted",
  },
  {
    id: "show-remaining-usage",
    section: "providers",
    label: "Show remaining usage",
    keywords: "usage limit meter bar left used quota percent",
  },
  {
    id: "mask-emails",
    section: "providers",
    label: "Mask account emails",
    keywords: "email privacy blur hide screenshot account",
  },
  {
    id: "claude-hooks",
    section: "providers",
    label: "Claude Code hooks",
    keywords: "pretooluse settings.json block command notification",
  },
  {
    id: "claude-remote-control",
    section: "providers",
    label: "Default location for new chats",
    keywords: "local remote cloud control phone mobile claude codex new chats default",
  },
  {
    id: "project-notifications",
    section: "inbox",
    label: "Project notifications",
    keywords: "mute resume sounds banners reminders categories",
  },
  {
    id: "github",
    section: "inbox",
    label: "GitHub",
    keywords: "gh cli connect pull request sign in",
  },
  {
    id: "gitlab",
    section: "inbox",
    label: "GitLab",
    keywords: "token self-managed merge request connect",
  },
  {
    id: "azuredevops",
    section: "inbox",
    label: "ADO",
    keywords: "azure devops boards repos pull request pat organization connect",
  },
  {
    id: "jira",
    section: "inbox",
    label: "Jira",
    keywords: "atlassian cloud site email api token issues projects connect",
  },
  {
    id: "linear",
    section: "inbox",
    label: "Linear",
    keywords: "api key issues teams connect",
  },
  {
    id: "show-archived",
    section: "archive",
    label: "Show archived in the sidebar",
    keywords: "hidden conversations list",
  },
  {
    id: "process-monitor",
    section: "experimentation",
    label: "Process monitor",
    keywords: "CPU memory resource manager processes stop idle",
  },
  {
    id: "interactive-idle",
    section: "experimentation",
    label: "Interactive idle shutdown",
    keywords: "Claude terminal parking resume minutes",
  },
  {
    id: "all-accounts-usage",
    section: "experimentation",
    label: "All accounts usage",
    keywords: "bottom bar footer usage limits every provider account claude codex quota",
  },
  {
    id: "compact-model-labels",
    section: "experimentation",
    label: "Compact model labels",
    keywords: "sidebar thread cards current running provider model",
  },
];

export type SettingsSearchResult = {
  section: SettingsSectionId;
  sectionLabel: string;
  /** Row to scroll to, or `null` when the whole section matched. */
  settingId: string | null;
  label: string;
};

/** Ranks a label/keyword pair against a lowercased needle; `null` means no match. */
function matchScore(
  needle: string,
  label: string,
  keywords?: string,
): number | null {
  const lower = label.toLowerCase();
  if (lower.startsWith(needle)) return 0;
  if (lower.includes(needle)) return 1;
  if (keywords?.toLowerCase().includes(needle)) return 2;
  return null;
}

/** Individual settings first, then whole sections, so a row wins its own name. */
export function searchSettings(
  query: string,
  limit = 8,
): SettingsSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: { score: number; result: SettingsSearchResult }[] = [];

  for (const entry of SETTINGS_INDEX) {
    const score = matchScore(needle, entry.label, entry.keywords);
    if (score == null) continue;
    scored.push({
      score,
      result: {
        section: entry.section,
        sectionLabel: settingsSectionLabel(entry.section),
        settingId: entry.id,
        label: entry.label,
      },
    });
  }

  for (const section of SETTINGS_SECTIONS) {
    const score = matchScore(
      needle,
      section.label,
      `${section.description} ${section.keywords ?? ""}`,
    );
    if (score == null) continue;
    scored.push({
      score: score + 0.5,
      result: {
        section: section.id,
        sectionLabel: section.label,
        settingId: null,
        label: section.label,
      },
    });
  }

  return scored
    .sort(
      (a, b) =>
        a.score - b.score || a.result.label.localeCompare(b.result.label),
    )
    .slice(0, limit)
    .map((item) => item.result);
}

export const SETTINGS_SECTION_DEFAULT: SettingsSectionId = "general";

export function isSettingsSectionId(
  value: unknown,
): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id)?.label ?? "General"
  );
}

export function settingsSectionDescription(id: SettingsSectionId): string {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id)?.description ?? ""
  );
}

export function loadSettingsSection(): SettingsSectionId {
  try {
    const raw = localStorage.getItem(SECTION_KEY);
    return isSettingsSectionId(raw) ? raw : SETTINGS_SECTION_DEFAULT;
  } catch {
    return SETTINGS_SECTION_DEFAULT;
  }
}

export function saveSettingsSection(id: SettingsSectionId) {
  try {
    localStorage.setItem(SECTION_KEY, id);
  } catch {
    // private mode / quota
  }
}

const COMPOSER_RUNNER_KEY = "monocode.composerRunner";

const FOLLOW_UP_BEHAVIOR_KEY = "monocode.followUpBehavior";

const COMPOSER_EFFORT_VISIBLE_KEY = "monocode.composerEffortVisible";

const MODEL_CONTROLS_KEY = "monocode.modelControls";

const FILE_TAB_MODE_KEY = "monocode.fileTabMode";

const TAB_ANIMATIONS_ENABLED_KEY = "monocode.tabAnimationsEnabled";

const COLLAPSED_PROJECT_RAIL_MODE_KEY = "monocode.collapsedProjectRailMode";

export type FollowUpBehavior = "steer" | "queue";

export const FOLLOW_UP_BEHAVIOR_DEFAULT: FollowUpBehavior = "steer";

/** Fired on `window` when the follow-up behavior setting flips. */
export const FOLLOW_UP_BEHAVIOR_CHANGE_EVENT =
  "monocode:follow-up-behavior-change";

export function loadFollowUpBehavior(): FollowUpBehavior {
  try {
    const raw = localStorage.getItem(FOLLOW_UP_BEHAVIOR_KEY);
    return raw === "queue" || raw === "steer"
      ? raw
      : FOLLOW_UP_BEHAVIOR_DEFAULT;
  } catch {
    return FOLLOW_UP_BEHAVIOR_DEFAULT;
  }
}

export function saveFollowUpBehavior(value: FollowUpBehavior) {
  try {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FollowUpBehavior>(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeFollowUpBehavior(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(FOLLOW_UP_BEHAVIOR_CHANGE_EVENT, onStoreChange);
}

export type FileTabMode = "pane" | "workspace";

export const FILE_TAB_MODE_DEFAULT: FileTabMode = "pane";

/** Choose whether an ordinary file joins the active pane or gets a top tab. */
export function loadFileTabMode(): FileTabMode {
  try {
    const raw = localStorage.getItem(FILE_TAB_MODE_KEY);
    return raw === "pane" || raw === "workspace" ? raw : FILE_TAB_MODE_DEFAULT;
  } catch {
    return FILE_TAB_MODE_DEFAULT;
  }
}

export function saveFileTabMode(value: FileTabMode) {
  try {
    localStorage.setItem(FILE_TAB_MODE_KEY, value);
  } catch {
    // private mode / quota
  }
}

export const TAB_ANIMATIONS_ENABLED_DEFAULT = false;

export function loadTabAnimationsEnabled(): boolean {
  return readFlag(TAB_ANIMATIONS_ENABLED_KEY) ?? TAB_ANIMATIONS_ENABLED_DEFAULT;
}

export function saveTabAnimationsEnabled(value: boolean) {
  writeFlag(TAB_ANIMATIONS_ENABLED_KEY, value);
}

export type CollapsedProjectRailMode = "compact" | "hidden";

export const COLLAPSED_PROJECT_RAIL_MODE_DEFAULT: CollapsedProjectRailMode =
  "compact";

export const COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT =
  "monocode:collapsed-project-rail-mode-change";

export function loadCollapsedProjectRailMode(): CollapsedProjectRailMode {
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECT_RAIL_MODE_KEY);
    return raw === "compact" || raw === "hidden"
      ? raw
      : COLLAPSED_PROJECT_RAIL_MODE_DEFAULT;
  } catch {
    return COLLAPSED_PROJECT_RAIL_MODE_DEFAULT;
  }
}

export function saveCollapsedProjectRailMode(value: CollapsedProjectRailMode) {
  try {
    localStorage.setItem(COLLAPSED_PROJECT_RAIL_MODE_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CollapsedProjectRailMode>(
      COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT,
      { detail: value },
    ),
  );
}

export function subscribeCollapsedProjectRailMode(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(
    COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT,
    onStoreChange,
  );
  return () =>
    window.removeEventListener(
      COLLAPSED_PROJECT_RAIL_MODE_CHANGE_EVENT,
      onStoreChange,
    );
}

export type ModelControls = "menu" | "beside";

export const MODEL_CONTROLS_DEFAULT: ModelControls = "menu";

/** Fired on `window` when the composer model controls setting flips. */
export const MODEL_CONTROLS_CHANGE_EVENT = "monocode:model-controls-change";

export function loadModelControls(): ModelControls {
  try {
    const raw = localStorage.getItem(MODEL_CONTROLS_KEY);
    if (raw === "menu" || raw === "beside") return raw;
    if (raw == null) {
      // Migrate the previous effort-control toggle: on means beside the picker.
      const legacy = localStorage.getItem(COMPOSER_EFFORT_VISIBLE_KEY);
      if (legacy === "1" || legacy === "true") return "beside";
    }
  } catch {
    // private mode / quota
  }
  return MODEL_CONTROLS_DEFAULT;
}

export function saveModelControls(value: ModelControls) {
  try {
    localStorage.setItem(MODEL_CONTROLS_KEY, value);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ModelControls>(MODEL_CONTROLS_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeModelControls(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(MODEL_CONTROLS_CHANGE_EVENT, onStoreChange);
}

export const AI_HELPER_PROVIDERS = [
  "claude",
  "codex",
  "opencode",
  "antigravity",
] as const satisfies readonly HarnessId[];

export type AiHelperProvider = (typeof AI_HELPER_PROVIDERS)[number];

export type AiHelperTarget = {
  provider: AiHelperProvider;
  accountId?: string;
  model?: string;
};

export type AiHelperSettings =
  | { mode: "automatic" }
  | {
      mode: "custom";
      primary: AiHelperTarget;
      fallback: AiHelperTarget | null;
    };

const AI_HELPER_KEY = "monocode.aiHelper";

export const AI_HELPER_CHANGE_EVENT = "monocode:ai-helper-change";

const AUTOMATIC_AI_HELPER: AiHelperSettings = { mode: "automatic" };

function isAiHelperRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAiHelperProvider(value: unknown): value is AiHelperProvider {
  return (
    typeof value === "string" &&
    AI_HELPER_PROVIDERS.some((candidate) => candidate === value)
  );
}

function parseAiHelperTarget(value: unknown): AiHelperTarget | null {
  if (!isAiHelperRecord(value)) return null;
  const provider = value.provider;
  if (!isAiHelperProvider(provider)) return null;

  let accountId: string | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "accountId")) {
    if (
      typeof value.accountId !== "string" ||
      value.accountId.trim().length === 0 ||
      value.accountId.length > 200 ||
      (provider !== "claude" && provider !== "codex")
    ) {
      return null;
    }
    accountId = value.accountId;
  }

  let model: string | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "model")) {
    if (typeof value.model !== "string") return null;
    model = value.model.trim();
    if (!model || model.length > 200) return null;
  }

  return {
    provider,
    ...(accountId === undefined ? {} : { accountId }),
    ...(model === undefined ? {} : { model }),
  };
}

function sameAiHelperTarget(
  left: AiHelperTarget,
  right: AiHelperTarget,
): boolean {
  return (
    left.provider === right.provider &&
    (left.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) ===
      (right.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) &&
    left.model === right.model
  );
}

/** Validate the persisted helper preference before any provider is invoked. */
export function parseAiHelperSettings(raw: unknown): AiHelperSettings {
  if (!isAiHelperRecord(raw)) return AUTOMATIC_AI_HELPER;
  if (raw.mode === "automatic") return AUTOMATIC_AI_HELPER;
  if (raw.mode !== "custom") return AUTOMATIC_AI_HELPER;

  const primary = parseAiHelperTarget(raw.primary);
  if (!primary) return AUTOMATIC_AI_HELPER;

  const fallback = parseAiHelperTarget(raw.fallback);
  return {
    mode: "custom",
    primary,
    fallback:
      fallback && !sameAiHelperTarget(primary, fallback) ? fallback : null,
  };
}

export function loadAiHelperSettings(): AiHelperSettings {
  try {
    const raw = localStorage.getItem(AI_HELPER_KEY);
    if (raw == null) return AUTOMATIC_AI_HELPER;
    return parseAiHelperSettings(JSON.parse(raw));
  } catch {
    return AUTOMATIC_AI_HELPER;
  }
}

export function saveAiHelperSettings(next: AiHelperSettings): void {
  try {
    localStorage.setItem(AI_HELPER_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AiHelperSettings>(AI_HELPER_CHANGE_EVENT, { detail: next }),
  );
}

export function subscribeAiHelperSettings(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AI_HELPER_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(AI_HELPER_CHANGE_EVENT, onStoreChange);
}

export const COMPOSER_RUNNER_DEFAULT = true;

/** Fired on `window` when the composer mascot setting flips. */
export const COMPOSER_RUNNER_CHANGE_EVENT = "monocode:composer-runner-change";

export function loadComposerRunner(): boolean {
  return readFlag(COMPOSER_RUNNER_KEY) ?? COMPOSER_RUNNER_DEFAULT;
}

export function saveComposerRunner(value: boolean) {
  writeFlag(COMPOSER_RUNNER_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(COMPOSER_RUNNER_CHANGE_EVENT, { detail: value }),
  );
}

const NOTES_ENABLED_KEY = "monocode.notesEnabled";

export const NOTES_ENABLED_DEFAULT = true;

/** Fired on `window` when the Notes UI setting flips. */
export const NOTES_ENABLED_CHANGE_EVENT = "monocode:notes-enabled-change";

export function loadNotesEnabled(): boolean {
  return readFlag(NOTES_ENABLED_KEY) ?? NOTES_ENABLED_DEFAULT;
}

export function saveNotesEnabled(value: boolean) {
  writeFlag(NOTES_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(NOTES_ENABLED_CHANGE_EVENT, { detail: value }),
  );
}

export function subscribeNotesEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(NOTES_ENABLED_CHANGE_EVENT, onStoreChange);
}

const MONOS_ENABLED_KEY = "monocode.monosEnabled";

export const MONOS_ENABLED_DEFAULT = true;

/** Fired on `window` when monos are shown or hidden. */
export const MONOS_ENABLED_CHANGE_EVENT = "monocode:monos-enabled-change";

/** Whether monos show in the title bar at all, across every project. */
export function loadMonosEnabled(): boolean {
  return readFlag(MONOS_ENABLED_KEY) ?? MONOS_ENABLED_DEFAULT;
}

export function saveMonosEnabled(value: boolean) {
  writeFlag(MONOS_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(MONOS_ENABLED_CHANGE_EVENT, { detail: value }),
  );
}

export function subscribeMonosEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MONOS_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(MONOS_ENABLED_CHANGE_EVENT, onStoreChange);
}

const MONO_MENU_BAR_KEY = "monocode.monoMenuBarIcon";

/** Fired on `window` when the menu bar icon is shown or hidden. */
export const MONO_MENU_BAR_CHANGE_EVENT = "monocode:mono-menu-bar-change";

export function loadMonoMenuBarIcon(): boolean {
  return readFlag(MONO_MENU_BAR_KEY) ?? true;
}

export function saveMonoMenuBarIcon(value: boolean) {
  writeFlag(MONO_MENU_BAR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MONO_MENU_BAR_CHANGE_EVENT));
}

export function subscribeMonoMenuBarIcon(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MONO_MENU_BAR_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(MONO_MENU_BAR_CHANGE_EVENT, onStoreChange);
}

const QUICK_COMPOSER_ENABLED_KEY = "monocode.quickComposerEnabled";
const QUICK_COMPOSER_SHORTCUT_KEY = "monocode.quickComposerShortcut";

export const QUICK_COMPOSER_ENABLED_DEFAULT = true;

export function loadQuickComposerEnabled(): boolean {
  return readFlag(QUICK_COMPOSER_ENABLED_KEY) ?? QUICK_COMPOSER_ENABLED_DEFAULT;
}

export function saveQuickComposerEnabled(value: boolean) {
  writeFlag(QUICK_COMPOSER_ENABLED_KEY, value);
}

export function loadQuickComposerShortcut(): string {
  try {
    const value = localStorage.getItem(QUICK_COMPOSER_SHORTCUT_KEY);
    return value && isGlobalShortcut(value)
      ? value
      : QUICK_COMPOSER_DEFAULT_SHORTCUT;
  } catch {
    return QUICK_COMPOSER_DEFAULT_SHORTCUT;
  }
}

export function saveQuickComposerShortcut(value: string) {
  if (!isGlobalShortcut(value)) return;
  // Same conflict rules as every other row, so the separately stored Quick
  // Composer chord cannot claim a combination another command already owns.
  const shortcut = validateKeybindingShortcut(QUICK_COMPOSER_COMMAND, value);
  try {
    localStorage.setItem(QUICK_COMPOSER_SHORTCUT_KEY, shortcut);
  } catch {
    // private mode / quota
  }
}

const LIVE_AGENTS_ENABLED_KEY = "monocode.liveAgentsEnabled";

export const LIVE_AGENTS_ENABLED_DEFAULT = true;

/** Fired on `window` when the working-agents rail card setting flips. */
export const LIVE_AGENTS_ENABLED_CHANGE_EVENT =
  "monocode:live-agents-enabled-change";

export function loadLiveAgentsEnabled(): boolean {
  return readFlag(LIVE_AGENTS_ENABLED_KEY) ?? LIVE_AGENTS_ENABLED_DEFAULT;
}

export function saveLiveAgentsEnabled(value: boolean) {
  writeFlag(LIVE_AGENTS_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(LIVE_AGENTS_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeLiveAgentsEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(LIVE_AGENTS_ENABLED_CHANGE_EVENT, onStoreChange);
}

const CLOSE_TO_TRAY_KEY = "monocode.closeToTray";

export const CLOSE_TO_TRAY_DEFAULT = true;

export function loadCloseToTray(): boolean {
  // Close to tray is Windows-only: nowhere else installs a tray icon.
  if (!IS_WIN) return false;
  return readFlag(CLOSE_TO_TRAY_KEY) ?? CLOSE_TO_TRAY_DEFAULT;
}

export function saveCloseToTray(value: boolean) {
  writeFlag(CLOSE_TO_TRAY_KEY, value);
}

const CHECK_PROVIDERS_ON_STARTUP_KEY = "monocode.checkProvidersOnStartup";

export const CHECK_PROVIDERS_ON_STARTUP_DEFAULT = true;

export function loadCheckProvidersOnStartup(): boolean {
  return readFlag(CHECK_PROVIDERS_ON_STARTUP_KEY) ?? CHECK_PROVIDERS_ON_STARTUP_DEFAULT;
}

export function saveCheckProvidersOnStartup(value: boolean) {
  writeFlag(CHECK_PROVIDERS_ON_STARTUP_KEY, value);
}

const GRID_ARCADE_ENABLED_KEY = "monocode.gridArcadeEnabled";

export const GRID_ARCADE_ENABLED_DEFAULT = true;

/** Fired on `window` when the empty-session games setting flips. */
export const GRID_ARCADE_ENABLED_CHANGE_EVENT =
  "monocode:grid-arcade-enabled-change";

export function loadGridArcadeEnabled(): boolean {
  return readFlag(GRID_ARCADE_ENABLED_KEY) ?? GRID_ARCADE_ENABLED_DEFAULT;
}

export function saveGridArcadeEnabled(value: boolean) {
  writeFlag(GRID_ARCADE_ENABLED_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(GRID_ARCADE_ENABLED_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeGridArcadeEnabled(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GRID_ARCADE_ENABLED_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(GRID_ARCADE_ENABLED_CHANGE_EVENT, onStoreChange);
}

const DIFF_VIEWER_KEY = "monocode.diffViewer";

export type DiffViewer = "editor" | "unified";

export const DIFF_VIEWER_DEFAULT: DiffViewer = "editor";

/** Fired on `window` when the working-tree diff layout flips. */
export const DIFF_VIEWER_CHANGE_EVENT = "monocode:diff-viewer-change";

function isDiffViewer(value: unknown): value is DiffViewer {
  return value === "editor" || value === "unified";
}

export function loadDiffViewer(): DiffViewer {
  try {
    const raw = localStorage.getItem(DIFF_VIEWER_KEY);
    return isDiffViewer(raw) ? raw : DIFF_VIEWER_DEFAULT;
  } catch {
    return DIFF_VIEWER_DEFAULT;
  }
}

export function saveDiffViewer(value: DiffViewer) {
  const next = isDiffViewer(value) ? value : DIFF_VIEWER_DEFAULT;
  try {
    localStorage.setItem(DIFF_VIEWER_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DiffViewer>(DIFF_VIEWER_CHANGE_EVENT, { detail: next }),
  );
}

export function subscribeDiffViewer(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(DIFF_VIEWER_CHANGE_EVENT, onStoreChange);
}

const FORMAT_ON_SAVE_KEY = "monocode.formatOnSave";

export const FORMAT_ON_SAVE_DEFAULT = true;

export function loadFormatOnSave(): boolean {
  return readFlag(FORMAT_ON_SAVE_KEY) ?? FORMAT_ON_SAVE_DEFAULT;
}

export function saveFormatOnSave(value: boolean) {
  writeFlag(FORMAT_ON_SAVE_KEY, value);
}

const AUTOSAVE_KEY = "monocode.autosave";
const AUTOSAVE_CHANGE_EVENT = "monocode:autosave-change";

export const AUTOSAVE_DEFAULT = false;

export function loadAutosave(): boolean {
  return readFlag(AUTOSAVE_KEY) ?? AUTOSAVE_DEFAULT;
}

export function saveAutosave(value: boolean): boolean {
  writeFlag(AUTOSAVE_KEY, value);
  const saved = loadAutosave();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTOSAVE_CHANGE_EVENT));
  }
  return saved;
}

export function subscribeAutosave(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTOSAVE_KEY) onStoreChange();
  };
  window.addEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(AUTOSAVE_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

const CLAUDE_HOOKS_KEY = "monocode.claudeHooks";

export const CLAUDE_HOOKS_DEFAULT = true;

export function loadClaudeHooks(): boolean {
  return readFlag(CLAUDE_HOOKS_KEY) ?? CLAUDE_HOOKS_DEFAULT;
}

export function saveClaudeHooks(value: boolean) {
  writeFlag(CLAUDE_HOOKS_KEY, value);
}

const CLAUDE_REMOTE_CONTROL_DEFAULT_KEY =
  "monocode.claudeRemoteControlDefault";
const CLAUDE_REMOTE_CONTROL_SESSIONS_KEY =
  "monocode.claudeRemoteControlSessions";

export type NewChatExecution = "local" | "remote" | "cloud";
const NEW_CHAT_EXECUTION_KEY = "monocode.newChatExecution";

export function loadNewChatExecution(): NewChatExecution {
  try {
    const value = localStorage.getItem(NEW_CHAT_EXECUTION_KEY);
    if (value === "local" || value === "remote" || value === "cloud") return value;
  } catch {
    // Fall back to the previous preference when storage is unavailable.
  }
  return readFlag(CLAUDE_REMOTE_CONTROL_DEFAULT_KEY) ? "remote" : "local";
}

export function saveNewChatExecution(value: NewChatExecution): void {
  try {
    localStorage.setItem(NEW_CHAT_EXECUTION_KEY, value);
  } catch {
    // Private mode / quota.
  }
}

/** Remote is available only for Claude; Cloud only for eligible provider chats. */
export function newChatExecutionFor(harness: HarnessId): NewChatExecution {
  const value = loadNewChatExecution();
  if (value === "remote" && harness !== "claude") return "local";
  if (value === "cloud" && harness !== "claude" && harness !== "codex") return "local";
  return value;
}

export function loadClaudeRemoteControlDefault(): boolean {
  return loadNewChatExecution() === "remote";
}

export function saveClaudeRemoteControlDefault(value: boolean): void {
  writeFlag(CLAUDE_REMOTE_CONTROL_DEFAULT_KEY, value);
  saveNewChatExecution(value ? "remote" : "local");
}

const REMOTE_CONTROL_CHOICES_KEY = "monocode.claudeRemoteControlChoices";

export function loadRemoteControlChoices(): Set<string> {
  return new Set([...loadRemoteControlIds(REMOTE_CONTROL_CHOICES_KEY), ...loadRemoteControlSessions()]);
}

export function saveRemoteControlChoices(ids: Iterable<string>): void {
  saveRemoteControlIds(ids, REMOTE_CONTROL_CHOICES_KEY);
}

export function loadRemoteControlSessions(): Set<string> {
  return loadRemoteControlIds(CLAUDE_REMOTE_CONTROL_SESSIONS_KEY);
}

function loadRemoteControlIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ).map((value) => value.trim()),
    );
  } catch {
    return new Set();
  }
}

export function saveRemoteControlSessions(ids: Iterable<string>): void {
  saveRemoteControlIds(ids, CLAUDE_REMOTE_CONTROL_SESSIONS_KEY);
}

function saveRemoteControlIds(ids: Iterable<string>, key: string): void {
  try {
    const normalized = [...new Set(
      [...ids].map((id) => id.trim()).filter(Boolean),
    )].sort();
    localStorage.setItem(
      key,
      JSON.stringify(normalized),
    );
  } catch {
    // Keep the live setting usable if local storage is unavailable.
  }
}

const DETAILED_CONTEXT_KEY = "monocode.detailedContext";

export const DETAILED_CONTEXT_DEFAULT = false;

/** Fired on `window` when the detailed-context setting flips. */
export const DETAILED_CONTEXT_CHANGE_EVENT =
  "monocode:detailed-context-change";

export function loadDetailedContext(): boolean {
  try {
    const raw = localStorage.getItem(DETAILED_CONTEXT_KEY);
    if (raw == null) return DETAILED_CONTEXT_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return DETAILED_CONTEXT_DEFAULT;
  }
}

export function saveDetailedContext(value: boolean): void {
  try {
    localStorage.setItem(DETAILED_CONTEXT_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(DETAILED_CONTEXT_CHANGE_EVENT, { detail: value }),
  );
}

export function subscribeDetailedContext(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DETAILED_CONTEXT_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(DETAILED_CONTEXT_CHANGE_EVENT, onStoreChange);
}

const REMAINING_QUOTA_KEY = "monocode.remainingQuota";

export const REMAINING_QUOTA_DEFAULT = false;

/** Fired on `window` when the remaining-quota presentation setting flips. */
export const REMAINING_QUOTA_CHANGE_EVENT =
  "monocode:remaining-quota-change";

export function loadRemainingQuota(): boolean {
  try {
    const raw = localStorage.getItem(REMAINING_QUOTA_KEY);
    if (raw == null) return REMAINING_QUOTA_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return REMAINING_QUOTA_DEFAULT;
  }
}

export function saveRemainingQuota(value: boolean): void {
  try {
    localStorage.setItem(REMAINING_QUOTA_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(REMAINING_QUOTA_CHANGE_EVENT, { detail: value }),
  );
}

export function subscribeRemainingQuota(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REMAINING_QUOTA_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(REMAINING_QUOTA_CHANGE_EVENT, onStoreChange);
}

const ALL_ACCOUNTS_USAGE_KEY = "monocode.allAccountsUsage";

export const ALL_ACCOUNTS_USAGE_DEFAULT = false;

/** Fired on `window` when the all-accounts usage footer setting flips. */
export const ALL_ACCOUNTS_USAGE_CHANGE_EVENT =
  "monocode:all-accounts-usage-change";

export function loadAllAccountsUsage(): boolean {
  try {
    const raw = localStorage.getItem(ALL_ACCOUNTS_USAGE_KEY);
    if (raw == null) return ALL_ACCOUNTS_USAGE_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return ALL_ACCOUNTS_USAGE_DEFAULT;
  }
}

export function saveAllAccountsUsage(value: boolean): void {
  try {
    localStorage.setItem(ALL_ACCOUNTS_USAGE_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(ALL_ACCOUNTS_USAGE_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeAllAccountsUsage(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ALL_ACCOUNTS_USAGE_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(ALL_ACCOUNTS_USAGE_CHANGE_EVENT, onStoreChange);
}

const COMPACT_MODEL_LABELS_KEY = "monocode.compactModelLabels";

export const COMPACT_MODEL_LABELS_DEFAULT = false;

export const COMPACT_MODEL_LABELS_CHANGE_EVENT =
  "monocode:compact-model-labels-change";

export function loadCompactModelLabels(): boolean {
  try {
    const raw = localStorage.getItem(COMPACT_MODEL_LABELS_KEY);
    if (raw == null) return COMPACT_MODEL_LABELS_DEFAULT;
    return raw === "1" || raw === "true";
  } catch {
    return COMPACT_MODEL_LABELS_DEFAULT;
  }
}

export function saveCompactModelLabels(value: boolean): void {
  try {
    localStorage.setItem(COMPACT_MODEL_LABELS_KEY, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(COMPACT_MODEL_LABELS_CHANGE_EVENT, {
      detail: value,
    }),
  );
}

export function subscribeCompactModelLabels(
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === COMPACT_MODEL_LABELS_KEY) onStoreChange();
  };
  window.addEventListener(COMPACT_MODEL_LABELS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(
      COMPACT_MODEL_LABELS_CHANGE_EVENT,
      onStoreChange,
    );
    window.removeEventListener("storage", onStorage);
  };
}

const CTRL = IS_MAC ? "⌃" : "Ctrl+";

const PROCESS_MONITOR_KEY = "monocode.processMonitor";
const PROCESS_MONITOR_EVENT = "monocode:process-monitor-change";
export function loadProcessMonitor(): boolean {
  try {
    return localStorage.getItem(PROCESS_MONITOR_KEY) === "1";
  } catch {
    return false;
  }
}
export function saveProcessMonitor(value: boolean): void {
  try {
    localStorage.setItem(PROCESS_MONITOR_KEY, value ? "1" : "0");
  } catch {
    /* unavailable storage */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PROCESS_MONITOR_EVENT));
}
export function subscribeProcessMonitor(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const storage = (event: StorageEvent): void => {
    if (event.key === PROCESS_MONITOR_KEY) onChange();
  };
  window.addEventListener(PROCESS_MONITOR_EVENT, onChange);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(PROCESS_MONITOR_EVENT, onChange);
    window.removeEventListener("storage", storage);
  };
}
export {
  loadInteractiveIdleMinutes,
  saveInteractiveIdleMinutes,
} from "./interactiveIdleSettings";

/** Shows or hides the in-window menu bar (Windows and Linux only). */
export const MENU_BAR_TOGGLE_COMMAND = "View: Toggle Menu Bar";

/** Shows the FPS and hover-glide diagnostics overlay. */
export const PERF_OVERLAY_COMMAND = "View: Toggle Performance Overlay";

export type KeybindingRow = {
  command: string;
  keys: string;
  when: string;
};

/**
 * Mirrors the bindings we actually handle: the native menu accelerators in
 * `src-tauri/src/menu.rs`, `tabCommand`, the window key handler in App, and
 * focused surface handlers such as the draft composer workspace toggle.
 */
export const KEYBINDINGS: KeybindingRow[] = [
  { command: "App: Settings", keys: `${MOD},`, when: "Always" },
  { command: "App: Search", keys: `${MOD}K`, when: "Always" },
  { command: "App: Go to File", keys: `${MOD}P`, when: "Always" },
  { command: "App: Command Palette", keys: `${MOD}${SHIFT}P`, when: "Always" },
  { command: "App: Find in Files", keys: `${MOD}${SHIFT}F`, when: "Always" },
  { command: "App: Open Project", keys: `${MOD}O`, when: "Always" },
  { command: "App: New Window", keys: `${MOD}${SHIFT}N`, when: "Always" },
  ...(IS_MAC || IS_WIN
    ? [
        {
          command: "App: Quick Composer",
          keys: `${MOD}${SHIFT}Space`,
          when: "Anywhere",
        },
      ]
    : []),
  { command: "App: Toggle Sidebar", keys: `${MOD}B`, when: "Always" },
  {
    command: "App: Toggle Session Sidebar",
    keys: `${MOD}${SHIFT}B`,
    when: "Always",
  },
  { command: "App: Switch Model", keys: `${MOD}.`, when: "Always" },
  { command: "App: Toggle Mono", keys: `${MOD}I`, when: "Project with a mono" },
  {
    command: "Composer: Toggle Workspace",
    keys: `${MOD}${SHIFT}G`,
    when: "Draft session composer",
  },
  { command: "View: Reload", keys: `${MOD}${SHIFT}R`, when: "Always" },
  {
    command: PERF_OVERLAY_COMMAND,
    keys: `${MOD}${ALT}${SHIFT}P`,
    when: "Always",
  },
  ...(IS_MAC
    ? []
    : [{ command: MENU_BAR_TOGGLE_COMMAND, keys: `${ALT}O`, when: "Always" }]),
  { command: "View: Zoom In", keys: `${MOD}+`, when: "Always" },
  { command: "View: Zoom Out", keys: `${MOD}-`, when: "Always" },
  { command: "View: Reset Zoom", keys: `${MOD}0`, when: "Always" },
  { command: "Tab: New", keys: `${MOD}T`, when: "Always" },
  { command: "Tab: Close Others", keys: `${MOD}${ALT}T`, when: "Always" },
  { command: "Tab: Close All", keys: `${MOD}${SHIFT}W`, when: "Always" },
  { command: "Tab: Next", keys: `${MOD}${SHIFT}]`, when: "Always" },
  { command: "Tab: Previous", keys: `${MOD}${SHIFT}[`, when: "Always" },
  { command: "Tab: Cycle Next", keys: `${CTRL}Tab`, when: "Always" },
  {
    command: "Tab: Cycle Previous",
    keys: `${CTRL}${SHIFT}Tab`,
    when: "Always",
  },
  { command: "Tab: Back", keys: `${MOD}[`, when: "Always" },
  { command: "Tab: Forward", keys: `${MOD}]`, when: "Always" },
  { command: "Tab: Activate 1–8", keys: `${MOD}1 … ${MOD}8`, when: "Always" },
  { command: "Tab: Activate Last", keys: `${MOD}9`, when: "Always" },
  {
    command: "Session: Archive",
    keys: `${MOD}${SHIFT}A`,
    when: "sessionFocus && !overlay",
  },
  {
    command: "Session: Previous",
    keys: `${MOD}${SHIFT}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next",
    keys: `${MOD}${SHIFT}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Previous in Current Tab",
    keys: `${MOD}↑`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Session: Next in Current Tab",
    keys: `${MOD}↓`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Previous",
    keys: `${MOD}${SHIFT}←`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  {
    command: "Project: Next",
    keys: `${MOD}${SHIFT}→`,
    when: "!overlay && (!textFocus || emptyComposer)",
  },
  { command: "Pane: Close", keys: `${MOD}W`, when: "Always" },
  { command: "Pane: Split Right", keys: `${MOD}D`, when: "!editorFocus" },
  {
    command: "Pane: Split Down",
    keys: `${MOD}${SHIFT}D`,
    when: "!editorFocus",
  },
  { command: "Pane: Focus Left", keys: `${MOD}${ALT}←`, when: "Always" },
  { command: "Pane: Focus Right", keys: `${MOD}${ALT}→`, when: "Always" },
  { command: "Pane: Focus Up", keys: `${MOD}${ALT}↑`, when: "Always" },
  { command: "Pane: Focus Down", keys: `${MOD}${ALT}↓`, when: "Always" },
  { command: "Terminal: New", keys: `${MOD}\``, when: "Always" },
  { command: "Terminal: New Tab", keys: `${MOD}${SHIFT}\``, when: "Always" },
  { command: "Terminal: Toggle Dock", keys: `${MOD}J`, when: "Always" },
  { command: "Editor: Find", keys: `${MOD}F`, when: "editorFocus" },
  { command: "Editor: Replace", keys: `${MOD}${ALT}F`, when: "editorFocus" },
];

const KEYBINDING_OVERRIDES_KEY = "monocode.keybindingOverrides";
const KEYBINDINGS_CHANGE_EVENT = "monocode:keybindings-change";

export type KeybindingOverride = {
  disabled?: boolean;
  shortcut?: string;
};

export type KeybindingOverrides = Record<string, KeybindingOverride>;

const VALID_COMMANDS = new Set(KEYBINDINGS.map((row) => row.command));

const KEY_CODES: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Space: "Space",
  Tab: "Tab",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  ",": "Comma",
  ".": "Period",
  "+": "Equal",
  "-": "Minus",
  "\\": "Backslash",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
};

const DISPLAY_MODIFIERS: [string, string][] = IS_MAC
  ? [
      ["⌘", "Command"],
      ["⌃", "Control"],
      ["⌥", "Option"],
      ["⇧", "Shift"],
    ]
  : [
      ["Ctrl+", "Control"],
      ["Alt+", "Option"],
      ["Shift+", "Shift"],
    ];

const QUICK_COMPOSER_COMMAND = "App: Quick Composer";
const ACTIVATE_RANGE_COMMAND = "Tab: Activate 1–8";

/**
 * Every chord a command owns by default, in stored form. Grouped rows expand
 * to one chord per key so a rebind can never shadow a working shortcut.
 */
function defaultShortcutsFor(command: string): string[] {
  const row = KEYBINDINGS.find((entry) => entry.command === command);
  if (!row) return [];
  let rest = row.keys;
  const modifiers: string[] = [];
  for (const [display, modifier] of DISPLAY_MODIFIERS) {
    if (rest.startsWith(display)) {
      modifiers.push(modifier);
      rest = rest.slice(display.length);
    }
  }
  const chords = (code: string) => {
    const value = canonicalShortcut(
      modifiers.length ? [...modifiers, code].join("+") : code,
    );
    return value ? [value] : [];
  };
  if (row.keys.includes("…")) {
    return [1, 2, 3, 4, 5, 6, 7, 8].flatMap((digit) => chords(`Digit${digit}`));
  }
  if (/^[A-Za-z]$/.test(rest)) return chords(`Key${rest.toUpperCase()}`);
  if (/^[0-9]$/.test(rest)) return chords(`Digit${rest}`);
  if (KEY_CODES[rest]) return chords(KEY_CODES[rest]);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(rest)) return chords(rest);
  return [];
}

/** Chord to owning command, covering defaults, live overrides and Quick Composer. */
function shortcutOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const row of KEYBINDINGS) {
    // The Quick Composer chord is stored separately from the table.
    const chords =
      row.command === QUICK_COMPOSER_COMMAND
        ? [loadQuickComposerShortcut()]
        : defaultShortcutsFor(row.command);
    for (const chord of chords) owners.set(chord, row.command);
  }
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut) owners.set(override.shortcut, command);
  }
  return owners;
}

function validateShortcut(command: string, shortcut: string): string {
  const canonical = canonicalShortcut(shortcut);
  if (!canonical) throw new Error("That combination is not a valid shortcut");
  if (command === ACTIVATE_RANGE_COMMAND && !/Digit[1-8]$/.test(canonical)) {
    throw new Error("Tab: Activate 1–8 needs a number key from 1 to 8");
  }
  return canonical;
}

/** Shared by both save paths so no chord can be claimed twice. */
export function validateKeybindingShortcut(
  command: string,
  shortcut: string,
): string {
  const canonical = validateShortcut(command, shortcut);
  const owner = shortcutOwners().get(canonical);
  if (owner && owner !== command) {
    throw new Error(`Already used by ${owner}`);
  }
  return canonical;
}

let cacheStorage: Storage | null = null;
let cacheRaw: string | null = null;
let cacheValue: KeybindingOverrides = {};

function parseKeybindingOverrides(raw: string | null): KeybindingOverrides {
  const value = JSON.parse(raw ?? "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: KeybindingOverrides = {};
  for (const [command, entry] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!VALID_COMMANDS.has(command) || !entry || typeof entry !== "object")
      continue;
    const override = entry as { disabled?: unknown; shortcut?: unknown };
    const disabled = override.disabled === true;
    const shortcut =
      typeof override.shortcut === "string"
        ? (canonicalShortcut(override.shortcut) ?? undefined)
        : undefined;
    if (shortcut) next[command] = { shortcut };
    else if (disabled) next[command] = { disabled: true };
  }
  return next;
}

/** Cached per raw value: this runs several times on every keydown. Returns a fresh object. */
export function loadKeybindingOverrides(): KeybindingOverrides {
  try {
    const storage = localStorage;
    const raw = storage.getItem(KEYBINDING_OVERRIDES_KEY);
    if (cacheStorage === storage && cacheRaw === raw) return { ...cacheValue };
    const next = parseKeybindingOverrides(raw);
    cacheStorage = storage;
    cacheRaw = raw;
    cacheValue = next;
    return { ...next };
  } catch {
    return {};
  }
}

export function saveKeybindingOverride(
  command: string,
  override: KeybindingOverride,
): KeybindingOverrides {
  const next = loadKeybindingOverrides();
  if (override.disabled) next[command] = { disabled: true };
  else if (override.shortcut) {
    const shortcut = validateKeybindingShortcut(command, override.shortcut);
    next[command] = { shortcut };
  } else delete next[command];
  try {
    if (Object.keys(next).length) {
      localStorage.setItem(KEYBINDING_OVERRIDES_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(KEYBINDING_OVERRIDES_KEY);
    }
  } catch {
    throw new Error("Could not save shortcuts");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(KEYBINDINGS_CHANGE_EVENT));
  }
  return next;
}

export type ShortcutEvent = Pick<KeyboardEvent, "code"> &
  Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function shortcutMatches(
  shortcut: string,
  event: ShortcutEvent,
): boolean {
  // Copy the fields: real keyboard events expose modifiers as prototype
  // accessors, so spreading the event would silently drop all of them.
  return (
    shortcutFromKeyEvent({
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    }) === shortcut
  );
}

export function matchCustomKeybinding(event: ShortcutEvent): string | null {
  for (const [command, override] of Object.entries(loadKeybindingOverrides())) {
    if (override.shortcut && shortcutMatches(override.shortcut, event)) {
      return command;
    }
  }
  return null;
}

export function keybindingPressed(
  command: string,
  event: ShortcutEvent,
  defaultMatch: boolean,
): boolean {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return false;
  if (override?.shortcut) return shortcutMatches(override.shortcut, event);
  return defaultMatch;
}

export function keybindingShortcutLabel(
  command: string,
  fallback: string,
): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut
    ? quickComposerShortcutLabel(override.shortcut)
    : fallback;
}

export function keybindingShortcutTokens(
  command: string,
  fallback: string,
): string | null {
  const override = loadKeybindingOverrides()[command];
  if (override?.disabled) return null;
  return override?.shortcut ? shortcutTokens(override.shortcut) : fallback;
}

export function subscribeKeybindings(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEYBINDING_OVERRIDES_KEY) onStoreChange();
  };
  window.addEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(KEYBINDINGS_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function currentKeybindings(): KeybindingRow[] {
  const overrides = loadKeybindingOverrides();
  return KEYBINDINGS.map((row) => {
    if (row.command === "App: Quick Composer") {
      return {
        ...row,
        keys: loadQuickComposerEnabled()
          ? quickComposerShortcutLabel(loadQuickComposerShortcut())
          : "Disabled",
      };
    }
    const override = overrides[row.command];
    return {
      ...row,
      keys: override?.disabled
        ? "Disabled"
        : override?.shortcut
          ? quickComposerShortcutLabel(override.shortcut)
          : row.keys,
    };
  });
}

export function filterKeybindings(
  rows: KeybindingRow[],
  query: string,
): KeybindingRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (row) =>
      row.command.toLowerCase().includes(needle) ||
      row.keys.toLowerCase().includes(needle) ||
      row.when.toLowerCase().includes(needle),
  );
}
