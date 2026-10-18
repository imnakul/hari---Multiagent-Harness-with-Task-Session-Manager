import { useAntigravityCliAgents } from "../../providers/model/antigravityCliAgents";
import { ModelSettings } from "../../sessions/ui/ModelSettings";
import { WorkInPicker } from "../../provider-sessions/ui/WorkInPicker";
import { newChatExecutionFor } from "../../settings/model/settings";
import { BranchPicker } from "../../source-control/ui/BranchPicker";
import { IS_MAC, MOD } from "../../../platform/tauri/platform";
import { WorkspacePicker } from "../../workspace/ui/WorkspacePicker";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { QuickWorkspaceControls } from "./QuickWorkspaceControls";
import {
  workspaceForProject,
  quickWorkspaceLaunch,
  type QuickWorkspace,
} from "../model/quickWorkspace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { prettyParent, projectName } from "../../../shared/lib/paths";
import {
  CheckCircle,
  ChevronDown,
  Search,
  Plus,
  X,
  ImagePlus,
  Cloud,
  Check,
  Maximize2,
  MessageMultiple,
} from "../../../shared/ui/icons";
import {
  SegmentedSwitch,
  type SegmentedOption,
} from "../../../shared/ui/SegmentedSwitch";
import { createTask } from "../../tasks/tasks";
import {
  EMPTY_QUICK_TASK,
  loadQuickComposerKind,
  quickTaskInput,
  saveQuickComposerKind,
  type QuickComposerKind,
  type QuickTaskFields as TaskFields,
} from "../model/quickTask";
import { QuickTaskFields } from "./QuickTaskFields";
import {
  QuickProjectIcon,
  loadQuickProjectAppearance,
} from "./QuickProjectIcon";
import {
  getModelSnapshot,
  subscribeModels,
  mergeModelSettings,
  loadLastModelSettings,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../../sessions/model/models";
import {
  DEFAULT_RUNTIME_MODE,
  HARNESS_TITLE,
  HARNESSES,
  runtimeModeLabel,
  type HarnessId,
  type RuntimeMode,
  harnessSupportsAttachments,
} from "../../sessions/model/session";
import { Popover } from "../../../shared/ui/Popover";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import { quickLaunchAttachments } from "../model/quickAttachments";
import { useQuickAttachments } from "./useQuickAttachments";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { composerPillClass } from "../../sessions/ui/composerControls";
import { QuickModelSelector } from "./QuickModelSelector";
import { QuickPermissionIcon, QuickPermissions } from "./QuickPermissions";
import { SavedPromptMenu } from "../../prompts/ui/SavedPromptMenu";
import { useSavedPromptMenu } from "../../prompts/ui/useSavedPromptMenu";
import { useQuickPickerMotion } from "./useQuickPickerMotion";
import {
  CLOUD_LAUNCH_OUTCOME_EVENT,
  useCloudLaunch,
  type CloudLaunchOutcome,
} from "../../provider-sessions/ui/useCloudLaunch";
import { CloudSessionDialog } from "../../provider-sessions/ui/CloudSessionDialog";
import { OPERATOR_COMMAND } from "../../sessions/model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../../sessions/model/orchestratorCommand";
import { PLAN_COMMAND } from "../../sessions/model/plan";
import { DRAFT_COMMAND } from "../../sessions/model/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  MODE_COMMAND_STYLES,
  ModeCommandText,
} from "../../sessions/ui/modeCommands";
import {
  rankSkills,
  replaceSlashToken,
  slashTokenAt,
  type SlashToken,
} from "../../skills/model/slashCommands";
import {
  applyQuickCatalog,
  filterQuickProjects,
  initialQuickChoice,
  initialQuickProject,
  loadQuickProjects,
  QUICK_COMPOSER_CATALOG_EVENT,
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT,
  QUICK_COMPOSER_SHOWN_EVENT,
  rememberQuickProject,
  resolveQuickModel,
  type QuickLaunch,
} from "../model/quickComposer";

/** Tallest the prompt grows before it scrolls, in px. */
const PROMPT_MAX_HEIGHT = 220;

/** Commands the floating composer offers after a leading `/`. */
const MODE_COMMANDS = [
  PLAN_COMMAND,
  OPERATOR_COMMAND,
  ORCHESTRATOR_COMMAND,
  DRAFT_COMMAND,
];
const MODE_NAMES: ReadonlySet<string> = new Set(
  MODE_COMMANDS.map((command) => command.name),
);

const KIND_OPTIONS: readonly SegmentedOption<QuickComposerKind>[] = [
  { id: "task", label: "Task", icon: CheckCircle },
  { id: "session", label: "Session", icon: MessageMultiple },
];

/** Toolbar pickers (project, model, permissions) use the chat composer's pill. */
const controlClass = (open: boolean): string =>
  composerPillClass(open, "max-w-52 shrink-0 disabled:opacity-50");
const CHEVRON_CLASS = "size-3 shrink-0 text-content/50";
const PRIMARY_BUTTON_CLASS =
  "h-7 rounded-md bg-accent px-3 text-[12px] font-medium text-white transition-opacity disabled:opacity-40";
const SECONDARY_BUTTON_CLASS =
  "h-7 rounded-md border border-content/12 px-3 text-[12px] font-medium text-content/80 hover:bg-selection-hover hover:text-content disabled:opacity-40";

/** How a session prompt is submitted: kept as a draft, started, or started and opened. */
type SessionAction = "draft" | "start" | "open";

/** The mode a prompt starts with, and the prompt the session should get. */
export function quickPromptMode(text: string): {
  prompt: string;
  mode: string | null;
} {
  const match = text.match(/^\/([a-z]+)(?=\s|$)\s*/);
  const mode = match?.[1] && MODE_NAMES.has(match[1]) ? match[1] : null;
  // The workspace reads Operator from the prompt itself.
  if (!mode || mode === OPERATOR_COMMAND.name) return { prompt: text, mode };
  return { prompt: text.slice(match![0].length), mode };
}

/**
 * One composer for three places:
 * - the floating window (global shortcut): a Task | Session switch; sessions
 *   are started, or saved as Session Manager drafts;
 * - Session Manager "Add Draft" (embedded, `onSubmitLaunch` saves the draft);
 * - Task Manager "Work on…" (embedded and prefilled from the task).
 * Embedded hosts that pass `onStartLaunch` also get Start / Start and open.
 */
export function QuickComposer({
  onShown,
  initialLaunch,
  onSubmitLaunch,
  onStartLaunch,
  onDismiss,
  submitLabel = "Save to Draft",
}: {
  onShown: () => void;
  initialLaunch?: QuickLaunch;
  /** Embedded: save the prompt as a Session Manager draft. */
  onSubmitLaunch?: (launch: QuickLaunch) => Promise<void>;
  /** Embedded: start the session now; `reveal` also opens it. */
  onStartLaunch?: (launch: QuickLaunch, reveal: boolean) => Promise<void>;
  onDismiss?: () => void;
  /** Label of the save-as-draft button. */
  submitLabel?: string;
}) {
  const embedded = !!onSubmitLaunch;
  const canStart = !embedded || !!onStartLaunch;
  // Only the floating composer makes Tasks; embedded hosts make sessions.
  const [kindChoice, setKindChoice] = useState<QuickComposerKind>(() =>
    embedded ? "session" : loadQuickComposerKind(),
  );
  const kind: QuickComposerKind = embedded ? "session" : kindChoice;
  const taskMode = kind === "task";
  const [taskFields, setTaskFields] = useState<TaskFields>(EMPTY_QUICK_TASK);
  const [projects, setProjects] = useState(() => [
    ...new Set([
      ...(initialLaunch?.cwd ? [initialLaunch.cwd] : []),
      ...loadQuickProjects(),
    ]),
  ]);
  const [projectAppearance, setProjectAppearance] = useState(
    loadQuickProjectAppearance,
  );
  const [availableHarnesses, setAvailableHarnesses] = useState<
    HarnessId[] | null
  >(embedded ? HARNESSES.filter(isHarnessAvailable) : null);
  const [cwd, setCwd] = useState(
    () => initialLaunch?.cwd ?? initialQuickProject(projects),
  );
  const [choice, setChoice] = useState(() =>
    initialLaunch
      ? {
          harness: initialLaunch.harness,
          model: initialLaunch.model ?? initialQuickChoice().model,
        }
      : initialQuickChoice(),
  );
  const [workspaceChoice, setWorkspaceChoice] = useState<QuickWorkspace>({
    cwd,
    mode: initialLaunch?.workspaceMode ?? "current",
    base: initialLaunch?.worktreeBase,
    ...(initialLaunch?.worktreeCwd
      ? {
          tree: {
            path: initialLaunch.worktreeCwd,
          } as import("../../source-control/model/worktrees").Worktree,
        }
      : {}),
  });
  const workspace = workspaceForProject(workspaceChoice, cwd);
  const [gitOpen, setGitOpen] = useState(false);
  // Re-render when a workspace window's live catalog lands.
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
  );
  const [modelSettings, setModelSettings] = useState(
    () => initialLaunch?.modelSettings ?? loadLastModelSettings(),
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    initialLaunch?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
  );
  const [prompt, setPrompt] = useState(() =>
    initialLaunch?.intent
      ? `/${initialLaunch.intent} ${initialLaunch.prompt}`
      : (initialLaunch?.prompt ?? ""),
  );
  const leadingMode = leadingModeCommand(prompt, MODE_NAMES);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [picker, setPicker] = useState<
    "project" | "model" | "permissions" | "attachments" | "commands" | null
  >(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloudOutcome, setCloudOutcome] = useState<CloudLaunchOutcome | null>(
    null,
  );
  const cloudOutcomeRef = useRef<CloudLaunchOutcome | null>(null);
  const [cloudOutcomeDialogOpen, setCloudOutcomeDialogOpen] = useState(false);
  const reportCloudLaunchOutcome = useCallback(
    async (outcome: CloudLaunchOutcome): Promise<void> => {
      cloudOutcomeRef.current = outcome;
      setCloudOutcome(outcome);
      if (outcome.kind === "unsaved") setCloudOutcomeDialogOpen(true);
      try {
        await emit(CLOUD_LAUNCH_OUTCOME_EVENT, outcome);
      } catch (reason) {
        setCloudOutcomeDialogOpen(true);
        throw new Error(
          `Cloud task ${outcome.record.id} started, but its details could not reach MonoCode. Keep this ID and retry saving the record if needed. ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
    },
    [],
  );
  const cloudDisabledReason =
    workspace.mode === "current" && (!workspace.tree || workspace.tree.isMain)
      ? undefined
      : "Cloud tasks cannot use the selected local worktree. Switch to the project checkout to start Cloud.";
  const cloudLaunch = useCloudLaunch({
    harness: choice.harness,
    cwd: cwd ?? "",
    blocksCount: 0,
    remote: false,
    nativeResume: false,
    initialExecution: typeof initialLaunch?.remoteControl === "boolean" ? "local" : undefined,
    disabledReason: cloudDisabledReason,
    onOutcome: reportCloudLaunchOutcome,
  });
  const remoteDraftKey = `${choice.harness}:${cwd ?? ""}`;
  const [remoteChoice, setRemoteChoice] = useState<{
    key: string;
    enabled: boolean;
  } | null>(() => typeof initialLaunch?.remoteControl === "boolean"
    ? { key: remoteDraftKey, enabled: initialLaunch.remoteControl }
    : null);
  const remoteDesired =
    choice.harness === "claude" &&
    !cloudLaunch?.active &&
    (remoteChoice?.key === remoteDraftKey
      ? remoteChoice.enabled
      : newChatExecutionFor(choice.harness) === "remote");
  const attachmentsSupported = harnessSupportsAttachments(choice.harness);
  const attachments = useQuickAttachments(
    attachmentsSupported && !busy && !taskMode,
    setError,
    initialLaunch?.attachments,
    !embedded,
  );
  const frameRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const focusPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      const field = promptRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }, []);

  // Projects and defaults can change in the workspace between shows, so each
  // show re-reads them. The draft survives a dismiss, like Spotlight's query.
  useEffect(() => {
    if (embedded) {
      focusPrompt();
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(QUICK_COMPOSER_SHOWN_EVENT, () => {
      onShown();
      const nextProjects = loadQuickProjects();
      const nextChoice = initialQuickChoice();
      setProjects(nextProjects);
      setProjectAppearance(loadQuickProjectAppearance());

      setCwd((current) =>
        current && nextProjects.includes(current)
          ? current
          : initialQuickProject(nextProjects),
      );
      setChoice(nextChoice);
      setModelSettings(loadLastModelSettings());
      setPicker(null);
      setSlash(null);
      setError(null);
      void emit(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, nextChoice.harness);
      focusPrompt();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    focusPrompt();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [focusPrompt, onShown, embedded]);

  // Model lists come from the CLIs, which only workspace windows talk to.
  useEffect(() => {
    if (embedded) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(QUICK_COMPOSER_CATALOG_EVENT, (event) => {
      const available = applyQuickCatalog(event.payload);
      if (available) setAvailableHarnesses(available);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      void emit(
        QUICK_COMPOSER_CATALOG_REQUEST_EVENT,
        initialQuickChoice().harness,
      );
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [embedded]);

  // Scroll only the list. scrollIntoView also scrolls the clipped card/root
  // while the native window is still catching up with the expanded content.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      list.scrollTop += rowRect.top - listRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      list.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }, [highlight, picker, query, catalogVersion]);

  useLayoutEffect(() => {
    const field = promptRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }, [prompt, leadingMode?.name]);

  const onGitOpenChange = useCallback((open: boolean) => {
    setGitOpen(open);
    if (open) {
      setPicker(null);
      setSlash(null);
    }
  }, []);
  useQuickPickerMotion(frameRef, pickerRef, picker, !embedded);

  // Task mode adds Personal ("") ahead of the projects.
  const projectOptions = useMemo(() => {
    const search = picker === "project" ? query : "";
    const found = filterQuickProjects(projects, search);
    return taskMode && "personal".includes(search.trim().toLowerCase())
      ? ["", ...found]
      : found;
  }, [picker, projects, query, taskMode]);
  const commandOptions = useMemo(
    () => rankSkills(MODE_COMMANDS, slash?.query ?? ""),
    [slash?.query],
  );
  const resolvedModel = resolveQuickModel(choice);
  const model = resolvedModel ?? {
    ...choice,
    id: choice.model,
    name: "Loading model…",
  };
  const settings = mergeModelSettings(model, modelSettings);
  const cliAgents = useAntigravityCliAgents(choice.harness, cwd ?? "~", settings.antigravityAgent);
  const optionCount =
    picker === "commands" ? commandOptions.length : projectOptions.length;
  const openPicker = (
    kind: "project" | "model" | "permissions" | "attachments",
  ) => {
    if (picker === kind) {
      closePicker();
      return;
    }
    setSlash(null);
    setPicker(kind);
    setQuery("");
    setHighlight(
      taskMode
        ? Math.max(0, projects.indexOf(taskFields.projectCwd ?? "") + 1)
        : Math.max(0, projects.indexOf(cwd ?? "")),
    );
    if (kind === "project")
      requestAnimationFrame(() =>
        queryRef.current?.focus({ preventScroll: true }),
      );
  };

  const closePicker = () => {
    setPicker(null);
    setSlash(null);
    setQuery("");
    if (picker === "commands")
      promptRef.current?.focus({ preventScroll: true });
    else focusPrompt();
  };

  const chooseAt = (index: number) => {
    if (picker === "commands") {
      const command = commandOptions[index];
      const field = promptRef.current;
      if (!command || !slash || !field) return;
      // The command stays in the prompt, where it renders with its icon.
      const next = replaceSlashToken(field.value, slash, command.invocation);
      let cursor = slash.start + command.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      field.value = next;
      setPrompt(next);
      setPicker(null);
      setSlash(null);
      requestAnimationFrame(() => {
        field.focus({ preventScroll: true });
        field.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (picker === "project") {
      const path = projectOptions[index];
      if (path === undefined) return;
      if (taskMode) {
        setTaskFields((fields) => ({ ...fields, projectCwd: path || null }));
      } else {
        if (!path) return;
        setCwd(path);
        setWorkspaceChoice({ cwd: path, mode: "current" });
      }
    }
    closePicker();
  };

  // `!` inserts a saved prompt (Settings → Prompts) at the caret.
  const promptMenu = useSavedPromptMenu({
    apply: (next, cursor) => {
      setPrompt(next);
      requestAnimationFrame(() => {
        const field = promptRef.current;
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(cursor, cursor);
      });
    },
  });

  const syncPromptCommand = (field: HTMLTextAreaElement) => {
    if (!taskMode) promptMenu.sync(field);
    const token =
      field.selectionStart === field.selectionEnd
        ? slashTokenAt(field.value, field.selectionStart)
        : null;
    // Operator activates only at the start of a prompt.
    const leading =
      token && !field.value.slice(0, token.start).trim() ? token : null;
    setSlash(taskMode ? null : leading);
    if (leading && !taskMode && !busy && !gitOpen) {
      setPicker("commands");
      setHighlight(0);
    } else {
      setPicker((current) => (current === "commands" ? null : current));
    }
  };

  const dismiss = () => {
    if (!busy) {
      if (onDismiss) onDismiss();
      else void invoke("quick_composer_dismiss");
    }
  };

  const switchKind = (next: QuickComposerKind) => {
    if (busy) return;
    setKindChoice(next);
    saveQuickComposerKind(next);
    promptMenu.close();
    setPicker(null);
    setSlash(null);
    setError(null);
    focusPrompt();
  };

  const taskInput = taskMode ? quickTaskInput(prompt, taskFields) : null;
  const saveTask = async () => {
    if (!taskInput || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createTask(taskInput);
      setPrompt("");
      // Status and project stay for the next task; focus and tags are per task.
      setTaskFields((fields) => ({ ...fields, focusDate: null, tags: "" }));
      setPicker(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (requested: SessionAction) => {
    if (taskMode) {
      await saveTask();
      return;
    }
    const launchMode = quickPromptMode(prompt.trim());
    // `/draft` keeps working as a shortcut for Save to Draft.
    const action: SessionAction =
      launchMode.mode === DRAFT_COMMAND.name || !canStart ? "draft" : requested;
    const reveal = action === "open";
    const text = launchMode.prompt.trim();
    const cloudSubmit = cloudLaunch?.active === true && action !== "draft";
    if (
      (!text && !attachments.files.length) ||
      !cwd ||
      busy ||
      attachments.loading ||
      gitOpen ||
      !resolvedModel ||
      (attachments.files.length > 0 && !attachmentsSupported)
    )
      return;
    if (cloudOutcome && action !== "draft") return;
    if (cloudSubmit && cloudLaunch && !cloudLaunch.canLaunch) {
      setError(
        cloudLaunch.disabledReason ?? "This cloud task cannot start yet.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    const picked = { harness: model.harness, model: model.id };
    try {
      if (cloudSubmit && cloudLaunch) {
        const launched = await cloudLaunch.launch(
          text,
          attachments.files,
          launchMode.mode !== null,
        );
        if (!launched) return;
        if (cloudOutcomeRef.current?.kind === "unsaved") {
          setCloudOutcomeDialogOpen(true);
          return;
        }
        cloudOutcomeRef.current = null;
        setCloudOutcome(null);
        setCloudOutcomeDialogOpen(false);
        if (onDismiss) onDismiss();
        else void invoke("quick_composer_dismiss").catch(() => undefined);
      } else {
        const request: QuickLaunch = {
          prompt: text,
          ...(action === "draft" ? { draft: true } : {}),
          ...(launchMode.mode === PLAN_COMMAND.name
            ? { intent: "plan" as const }
            : launchMode.mode === ORCHESTRATOR_COMMAND.name
              ? { intent: "orchestrate" as const }
              : {}),
          cwd,
          ...picked,
          modelSettings: settings,
          runtimeMode,
          ...(picked.harness === "claude" ? { remoteControl: remoteDesired } : {}),
          attachments: quickLaunchAttachments(attachments.files),
          ...(await quickWorkspaceLaunch(workspace)),
          reveal,
        };
        if (onSubmitLaunch && action === "draft")
          await onSubmitLaunch({ ...request, draft: true, reveal: false });
        else if (onStartLaunch)
          await onStartLaunch({ ...request, reveal }, reveal);
        else
          await invoke("quick_composer_submit", {
            request: action === "draft" ? { ...request, reveal: false } : request,
          });
        if (action === "draft") cloudLaunch?.resetToLocal();
      }
      rememberQuickProject(cwd);
      saveLastModelSettings(settings);
      saveRecentModelChoice(picked.harness, picked.model);
      setPrompt("");
      setRemoteChoice(null);
      setPicker(null);
      setSlash(null);
      attachments.clear();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const onPromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (!taskMode && promptMenu.onKeyDown(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (picker) closePicker();
      else dismiss();
      return;
    }
    if (picker === "commands") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (optionCount === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((index) => (index + step + optionCount) % optionCount);
        return;
      }
      if (
        optionCount > 0 &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "Enter" || event.key === "Tab")
      ) {
        event.preventDefault();
        chooseAt(Math.min(highlight, optionCount - 1));
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void submit((IS_MAC ? event.metaKey : event.ctrlKey) ? "open" : "start");
      return;
    }
    if (
      (IS_MAC ? event.metaKey : event.ctrlKey) &&
      event.key.toLowerCase() === "p"
    ) {
      event.preventDefault();
      openPicker("project");
      return;
    }
    if (
      !taskMode &&
      (IS_MAC ? event.metaKey : event.ctrlKey) &&
      event.key === "."
    ) {
      event.preventDefault();
      openPicker("model");
    }
  };

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (optionCount === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => (index + step + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      chooseAt(Math.min(highlight, optionCount - 1));
    }
  };

  const canSubmitSession = Boolean(
    (quickPromptMode(prompt.trim()).prompt.trim() ||
      attachments.files.length) &&
    cwd &&
    !busy &&
    !attachments.loading &&
    !gitOpen &&
    resolvedModel &&
    (attachmentsSupported || !attachments.files.length),
  );
  const canSubmit = taskMode ? Boolean(taskInput) && !busy : canSubmitSession;

  // Slash commands (/plan, /draft…) only exist for sessions.
  const showMode = !taskMode && !!leadingMode;
  const indent = showMode ? MODE_COMMAND_INDENT : undefined;
  const draftCommand = showMode && leadingMode?.name === DRAFT_COMMAND.name;
  const projectPath = taskMode ? taskFields.projectCwd : cwd;
  const projectLabel = projectPath
    ? projectName(projectPath)
    : taskMode
      ? "Personal"
      : "No project";

  const optionClass = (index: number, stacked = false) =>
    `flex w-full ${stacked ? "flex-col items-start gap-0.5" : "items-center gap-2.5"} rounded-lg px-2 py-1.5 text-left text-[13px] ${
      index === highlight
        ? "bg-selection-emphasis text-content"
        : "text-content/75"
    }`;

  return (
    // Selectors expand below the toolbar without moving the prompt.
    <div
      ref={frameRef}
      onPaste={attachments.onPaste}
      onDragOver={attachments.onDragOver}
      onDragLeave={attachments.onDragLeave}
      onDrop={attachments.onDrop}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        if (picker) closePicker();
        else dismiss();
      }}
      className={`@container relative flex max-h-[520px] flex-col overflow-clip rounded-[16px] border text-content ${
        embedded
          ? // Inside a modal: the modal already draws the glass.
            "border-content/8 bg-content/3"
          : "quick-composer-surface border-content/10"
      }`}
    >
      <div
        hidden={embedded}
        title="Drag to move"
        className="group absolute inset-x-0 top-0 z-10 flex h-3 cursor-grab items-start justify-center pt-1 active:cursor-grabbing"
        onMouseDown={(event) => {
          if (embedded || event.button !== 0) return;
          event.preventDefault();
          void getCurrentWindow()
            .startDragging()
            .catch(() => undefined);
        }}
      >
        <span className="pointer-events-none h-0.5 w-6 rounded-full bg-content/15 transition-colors group-hover:bg-content/35" />
      </div>
      {attachments.dragging && !taskMode ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[16px] border border-dashed border-accent/60 bg-background-base/90 text-sm text-accent">
          Drop to attach
        </div>
      ) : null}
      <div className="flex min-h-10 shrink-0 items-center gap-2 pt-2.5 pr-2.5 pl-4">
        <div className="flex min-w-0 flex-1 items-center">
          {taskMode ? (
            <span className="text-[12px] font-medium text-content/60">
              New task
            </span>
          ) : embedded ? (
            <>
              <WorkspacePicker
                cwd={workspace.tree?.path ?? cwd ?? ""}
                mode={workspace.mode}
                base={workspace.base}
                enabled={!!cwd && !busy}
                onModeChange={(mode, base) =>
                  setWorkspaceChoice({ cwd, mode, base })
                }
                onBaseChange={(base) =>
                  setWorkspaceChoice({ ...workspace, base })
                }
                onSelectWorktree={async (tree) =>
                  setWorkspaceChoice({ cwd, mode: "current", tree })
                }
                onOpenChange={onGitOpenChange}
                onClose={focusPrompt}
              />
              {workspace.mode === "current" ? (
                <BranchPicker
                  cwd={workspace.tree?.path ?? cwd ?? ""}
                  enabled={!!cwd && !busy}
                  worktree={!!workspace.tree && !workspace.tree.isMain}
                  onOpenChange={onGitOpenChange}
                  onClose={focusPrompt}
                />
              ) : null}
            </>
          ) : (
            <QuickWorkspaceControls
              key={cwd}
              value={workspace}
              enabled={!busy && !picker}
              onChange={setWorkspaceChoice}
              onError={setError}
              onOpenChange={onGitOpenChange}
              onClose={focusPrompt}
            />
          )}
        </div>
        {!embedded ? (
          <SegmentedSwitch
            options={KIND_OPTIONS}
            value={kind}
            onChange={switchKind}
            ariaLabel="Create"
          />
        ) : null}
        <button
          type="button"
          hidden={embedded}
          aria-label="Close composer"
          title="Close (Esc)"
          onClick={dismiss}
          className="grid size-7 shrink-0 place-items-center rounded-md text-content/40 hover:bg-selection-hover hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {attachments.files.length && !taskMode ? (
        <div
          aria-label="Attachments"
          className="flex max-h-28 shrink-0 flex-wrap gap-1.5 overflow-y-auto px-4 pt-2 pb-1"
        >
          {attachments.files.map((file) => (
            <AttachmentChip
              key={file.id}
              attachment={file}
              onRemove={busy ? undefined : () => attachments.remove(file.id)}
            />
          ))}
        </div>
      ) : null}
      <div className="relative shrink-0">
        <div
          ref={highlightRef}
          aria-hidden
          style={{ textIndent: indent }}
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap wrap-break-word px-4 pt-2 pb-2.5 font-sans text-sm leading-5.5 text-content"
        >
          {showMode && leadingMode ? (
            <>
              <ModeCommandText
                text={prompt}
                mode={leadingMode}
                indent={MODE_COMMAND_INDENT}
                iconClassName="size-3.5"
              />
              {prompt.slice(leadingMode.end)}
            </>
          ) : (
            prompt
          )}
          {prompt.endsWith("\n") ? "\n" : null}
        </div>
        <textarea
          ref={promptRef}
          value={prompt}
          rows={2}
          style={{ textIndent: indent }}
          onScroll={(event) => {
            if (highlightRef.current)
              highlightRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => {
            setPrompt(event.target.value);
            syncPromptCommand(event.currentTarget);
          }}
          onClick={(event) => syncPromptCommand(event.currentTarget)}
          onKeyDown={onPromptKeyDown}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              syncPromptCommand(event.currentTarget);
          }}
          placeholder={
            taskMode
              ? "Task title (Shift+Enter for a description)…"
              : cwd
                ? `Start a ${HARNESS_TITLE[model.harness]} session in ${projectName(cwd)}…`
                : "Open a project in MonoCode first"
          }
          disabled={!taskMode && !cwd}
          aria-label={taskMode ? "Task" : "Prompt"}
          aria-autocomplete={taskMode ? undefined : "list"}
          aria-controls={
            picker === "commands" ? "quick-composer-commands" : undefined
          }
          aria-expanded={taskMode ? undefined : picker === "commands"}
          aria-activedescendant={
            picker === "commands" && commandOptions[highlight]
              ? `quick-command-${commandOptions[highlight].invocation}`
              : undefined
          }
          spellCheck
          className="composer-field scrollbar-none relative block w-full resize-none bg-transparent px-4 pt-2 pb-2.5 font-sans text-sm leading-5.5 outline-none select-text"
        />
      </div>
      {taskMode ? (
        <QuickTaskFields
          value={taskFields}
          disabled={busy}
          onChange={setTaskFields}
        />
      ) : null}

      {!taskMode && cloudLaunch?.active ? cloudLaunch.panel : null}
      {!taskMode && cloudLaunch?.active ? (
        <p className="px-3 pb-1 text-[11px] text-content/50">
          Save to Draft keeps a local Session Manager draft. Only Start launches
          a Cloud task.
        </p>
      ) : null}
      {!taskMode && cloudLaunch?.disabledReason && !cloudLaunch.active ? (
        <p role="status" className="px-3 pb-1 text-[11px] text-amber-400/90">
          {cloudLaunch.disabledReason}
        </p>
      ) : null}
      {cloudOutcome ? (
        <div
          role="alert"
          className="flex items-center gap-2 border-t border-amber-400/20 bg-amber-400/5 px-3 py-1.5 text-[11px] text-content/80"
        >
          <span className="min-w-0 flex-1 truncate">
            Cloud task already started. Keep ID {cloudOutcome.record.id}.
          </span>
          <button
            type="button"
            onClick={() => setCloudOutcomeDialogOpen(true)}
            className="shrink-0 rounded px-1 text-content/70 underline-offset-2 hover:text-content hover:underline"
          >
            Task details
          </button>
        </div>
      ) : null}
      {cloudOutcome && cloudOutcomeDialogOpen ? (
        <CloudSessionDialog
          record={cloudOutcome.record}
          unsavedMessage={
            cloudOutcome.kind === "unsaved" ? cloudOutcome.message : undefined
          }
          onClose={() => setCloudOutcomeDialogOpen(false)}
          onSaved={(record) => {
            const outcome: CloudLaunchOutcome = { kind: "launched", record };
            setCloudOutcome(outcome);
            void emit(CLOUD_LAUNCH_OUTCOME_EVENT, outcome)
              .then(() => {
                setCloudOutcomeDialogOpen(false);
                if (onDismiss) onDismiss();
                else
                  void invoke("quick_composer_dismiss").catch(
                    () => undefined,
                  );
              })
              .catch((reason: unknown) => {
                setError(
                  `Task ${record.id} was saved, but its details could not reach MonoCode. Refresh the provider list to reload it. ${reason instanceof Error ? reason.message : String(reason)}`,
                );
              });
          }}
        />
      ) : null}

      {attachments.files.length && !attachmentsSupported && !taskMode ? (
        <p role="alert" className="px-4 pb-2 text-xs text-amber-400">
          Choose a provider that supports attachments, or remove the attached
          files.
        </p>
      ) : null}
      <div className="flex shrink-0 items-center gap-1 border-t border-stroke px-2.5 py-2">
        <div className="composer-toolbar flex min-w-0 flex-1 items-center">
        <div className="flex shrink-0 items-center gap-1">
        {!taskMode ? (
          <WorkInPicker
            started={false}
            enabled={!busy}
            cloud={cloudLaunch}
            remote={choice.harness === "claude" ? {
              desired: remoteDesired,
              onChange: (enabled) => setRemoteChoice({ key: remoteDraftKey, enabled }),
            } : undefined}
          />
        ) : null}
        {!taskMode ? (
          <button
            type="button"
            ref={plusRef}
            aria-label="Add files or choose a mode"
            aria-expanded={picker === "attachments"}
            title={
              attachmentsSupported
                ? "Attach files, take a screenshot or start a cloud session"
                : cloudLaunch
                  ? "Start a cloud session"
                  : "This provider does not support attachments"
            }
            disabled={
              (!attachmentsSupported && !cloudLaunch) ||
              attachments.loading ||
              busy
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPicker("attachments")}
            className={`grid size-7 shrink-0 place-items-center rounded-md disabled:opacity-40 ${picker === "attachments" ? "bg-selection-emphasis text-content" : "text-content/70 hover:bg-selection-hover hover:text-content"}`}
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
          </button>
        ) : null}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openPicker("project")}
          disabled={!taskMode && projects.length === 0}
          title={`Project (${MOD}P)`}
          aria-expanded={picker === "project"}
          className={controlClass(picker === "project")}
        >
          {projectPath ? (
            <QuickProjectIcon
              projectPath={projectPath}
              appearance={projectAppearance}
              className="size-3.5 shrink-0"
            />
          ) : null}
          <span className="min-w-0 truncate text-[11px]">{projectLabel}</span>
          <ChevronDown className={`${CHEVRON_CLASS} ${picker === "project" ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </button>
        {!taskMode ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPicker("model")}
            title={`Model (${MOD}.)`}
            aria-expanded={picker === "model"}
            className={controlClass(picker === "model")}
          >
            <HarnessIcon
              harness={model.harness}
              className="size-4 shrink-0"
            />
            <span className="min-w-0 truncate text-[11px]">{model.name}</span>
            <ChevronDown className={`${CHEVRON_CLASS} ${picker === "model" ? "rotate-180" : ""}`} strokeWidth={1.75} />
          </button>
        ) : null}
        {!taskMode && choice.harness === "antigravity-cli" ? (
          <ModelSettings
            harness={choice.harness}
            model={model.id}
            values={settings}
            settingsOverride={cliAgents.settings}
            disabled={cliAgents.loading}
            onChange={setModelSettings}
          />
        ) : null}
        {!taskMode && cliAgents.error ? (
          <span role="status" className="text-[11px] text-amber-400" title={cliAgents.error}>
            Agents unavailable
          </span>
        ) : null}
        {!taskMode && model.harness !== "fx" ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPicker("permissions")}
            title="Permissions"
            aria-expanded={picker === "permissions"}
            className={controlClass(picker === "permissions")}
          >
            <QuickPermissionIcon
              mode={runtimeMode}
              className="size-3.5 shrink-0"
            />
            <span className="min-w-0 truncate text-[11px]">{runtimeModeLabel(runtimeMode, choice.harness)}</span>
            <ChevronDown className={`${CHEVRON_CLASS} ${picker === "permissions" ? "rotate-180" : ""}`} strokeWidth={1.75} />
          </button>
        ) : null}
        </div>
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[11px] text-content/45">
          {attachments.loading && !taskMode ? (
            <span role="status">Adding attachment…</span>
          ) : error ? (
            <span
              role="alert"
              className="max-w-60 truncate text-red-400"
              title={error}
            >
              {error}
            </span>
          ) : (
            <span className="mr-1 hidden items-center gap-1 @min-[600px]:flex">
              <Kbd>↵</Kbd>
              {taskMode ? "save" : canStart ? "start" : "save"}
              {!taskMode && canStart ? (
                <>
                  <Kbd>{`${MOD}↵`}</Kbd>
                  {cloudOutcome
                    ? "task already started"
                    : cloudLaunch?.active
                      ? "start cloud task"
                      : "start and open"}
                </>
              ) : null}
            </span>
          )}
          {taskMode ? (
            <button
              type="button"
              onClick={() => void saveTask()}
              disabled={!canSubmit}
              className={PRIMARY_BUTTON_CLASS}
            >
              Save task
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void submit("draft")}
                disabled={!canSubmit}
                title={
                  cloudLaunch?.active
                    ? "Save this as a local Session Manager draft; it will not start a cloud task"
                    : "Keep it in Session Manager as a draft to start later"
                }
                className={
                  canStart && !draftCommand
                    ? SECONDARY_BUTTON_CLASS
                    : PRIMARY_BUTTON_CLASS
                }
              >
                {submitLabel}
              </button>
              {canStart && !draftCommand ? (
                <button
                  type="button"
                  onClick={() => void submit("start")}
                  disabled={
                    !canSubmit ||
                    !!cloudOutcome ||
                    (cloudLaunch?.active && !cloudLaunch.canLaunch)
                  }
                  title={
                    cloudOutcome
                      ? "This cloud task has already started; open its details above"
                      : cloudLaunch?.active && cloudLaunch.disabledReason
                        ? cloudLaunch.disabledReason
                        : cloudLaunch?.active
                          ? "Start this cloud task"
                          : `Start (${MOD}↵ starts and opens it)`
                  }
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {cloudOutcome
                    ? "Task started"
                    : cloudLaunch?.active
                      ? "Start cloud task"
                      : "Start"}
                </button>
              ) : null}
            </>
          )}
        </span>
      </div>

      {picker === "attachments" ? (
        <Popover
          anchor={plusRef}
          side="top"
          align="start"
          width={220}
          gap={4}
          autoFocus
          tabIndex={-1}
          onDismiss={closePicker}
          className="p-1"
        >
          <button
            type="button"
            disabled={attachments.loading || !attachmentsSupported}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPicker(null);
              void attachments.chooseFiles().then(focusPrompt);
            }}
            data-shared-hover-item
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-selection-hover disabled:opacity-40"
          >
            <ImagePlus className="size-3.5" />
            Choose files…
          </button>
          <button
            type="button"
            hidden={embedded}
            disabled={attachments.loading || !attachmentsSupported}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPicker(null);
              void attachments.takeScreenshot().then(focusPrompt);
            }}
            data-shared-hover-item
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-selection-hover disabled:opacity-40"
          >
            <Maximize2 className="size-3.5" />
            Take screenshot…
          </button>
          {cloudLaunch ? (
            <button
              type="button"
              aria-pressed={cloudLaunch.active}
              data-shared-hover-item
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                cloudLaunch.setActive(!cloudLaunch.active);
                closePicker();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-selection-hover disabled:opacity-40"
            >
              <Cloud className="size-3.5" />
              <span className="flex-1">Cloud session</span>
              {cloudLaunch.active ? (
                <Check className="size-3.5 text-accent" />
              ) : null}
            </button>
          ) : null}
        </Popover>
      ) : null}
      {promptMenu.open && !picker && !taskMode ? (
        <div className="p-1.5 pt-0">
          <SavedPromptMenu state={promptMenu} floating={false} />
        </div>
      ) : null}
      {picker && picker !== "attachments" ? (
        <div ref={pickerRef} key={picker} className="flex min-h-0 flex-col">
          {picker === "commands" ? (
            <div
              ref={listRef}
              id="quick-composer-commands"
              role="listbox"
              aria-label="Commands"
              className="shrink-0 border-t border-stroke p-2"
            >
              {commandOptions.length === 0 ? (
                <p className="px-2 py-2 text-[12px] text-content/45">
                  No matching commands
                </p>
              ) : (
                commandOptions.map((command, index) => (
                  <button
                    key={command.invocation}
                    id={`quick-command-${command.invocation}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    tabIndex={-1}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseAt(index)}
                    className={optionClass(index, true)}
                  >
                    <CommandLabel name={command.name} />
                    <span className="text-[11px] leading-4 text-content/50">
                      {command.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          {picker === "model" ? (
            <QuickModelSelector
              model={model}
              values={settings}
              availableHarnesses={availableHarnesses}
              onChange={(selected) => {
                setChoice({ harness: selected.harness, model: selected.id });
                setModelSettings((current) =>
                  mergeModelSettings(selected, current),
                );
              }}
              onSettingsChange={setModelSettings}
              onClose={closePicker}
            />
          ) : null}

          {picker === "permissions" ? (
            <QuickPermissions
              harness={choice.harness}
              value={runtimeMode}
              onChange={setRuntimeMode}
              onClose={closePicker}
            />
          ) : null}

          {picker === "project" ? (
            <div className="flex min-h-0 flex-col border-t border-stroke">
              <label className="flex shrink-0 items-center gap-2 px-4 py-2 text-content/45">
                <Search className="size-3.5 shrink-0" />
                <input
                  ref={queryRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={onQueryKeyDown}
                  onBlur={(event) => {
                    if (
                      !frameRef.current?.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      closePicker();
                    }
                  }}
                  placeholder="Find a project"
                  aria-label="Find a project"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/35"
                />
              </label>
              <div
                ref={listRef}
                role="listbox"
                aria-label="Projects"
                className="min-h-0 max-h-64 overflow-y-auto overscroll-none px-2 pb-2"
              >
                {optionCount === 0 ? (
                  <p className="px-2 py-2 text-[12px] text-content/45">
                    No matches
                  </p>
                ) : (
                  projectOptions.map((path, index) => (
                    <button
                      key={path || "personal"}
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      tabIndex={-1}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseAt(index)}
                      className={optionClass(index)}
                    >
                      {path ? (
                        <>
                          <QuickProjectIcon
                            projectPath={path}
                            appearance={projectAppearance}
                            className="size-3.5 shrink-0"
                          />
                          <span className="truncate">{projectName(path)}</span>
                          <span className="ml-auto truncate pl-3 text-[11px] text-content/40">
                            {prettyParent(path)}
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="size-3.5 shrink-0 opacity-70" />
                          <span className="truncate">Personal</span>
                          <span className="ml-auto truncate pl-3 text-[11px] text-content/40">
                            Not tied to a project
                          </span>
                        </>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CommandLabel({ name }: { name: string }) {
  const style = MODE_COMMAND_STYLES[name];
  return (
    <span className="flex items-center gap-1.5">
      {style ? (
        <style.Icon
          className={`size-3.5 shrink-0 ${style.menu?.iconClassName ?? ""}`}
        />
      ) : null}
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </span>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-content/12 px-1 font-sans text-[10px] text-content/55">
      {children}
    </kbd>
  );
}
