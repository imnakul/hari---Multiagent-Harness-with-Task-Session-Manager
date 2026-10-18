import {
  interactiveTerminalFor,
  interactiveTerminalRevision,
  subscribeInteractiveTerminals,
} from "../../../integrations/harness/providers/claude/claudeInteractiveTerminal";
import { ClaudeInteractiveTerminal } from "./ClaudeInteractiveTerminal";
import { hasInteractiveClaudeDiagnostics } from "../../../integrations/harness/providers/claude/claudeInteractive";
import { useAntigravityCliAgents } from "../../providers/model/antigravityCliAgents";
import { ModelSettings } from "./ModelSettings";
import {
  ArrowUp,
  AiIdea,
  Check,
  CircleDashed,
  CursorMagicSelection,
  FilePlus,
  Plus,
  Share,
  Square,
  StickyNote,
  X,
} from "../../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  revokeAttachment,
} from "../model/attachments";
import { resizeComposer } from "../model/composerResize";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import { useFileDrop } from "../hooks/useFileDrop";
import type { ContextUsage } from "../model/contextUsage";
import {
  loadProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../../files/model/fileIndex";
import {
  buildMentionIndex,
  fileMentionParts,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
  replaceMentionToken,
  type MentionIndex,
  type MentionToken,
} from "../../files/model/fileMentions";
import type { ProjectFile } from "../../../platform/tauri/fs";
import {
  composeInboxMessage,
  type InboxComposerCard,
} from "../../inbox/model/githubTasks";
import type { HandoffComposerCard } from "../model/handoff";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  QueuedMessage,
  UsageLimit,
  RuntimeMode,
  WorkspaceMode,
  ComposerTurnOptions,
} from "../model/session";
import { HARNESS_TITLE, harnessSupportsAttachments } from "../model/session";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../model/userQuestion";
import type { McpFormPrompt, McpFormReply } from "../model/mcpForm";
import { isImeComposition } from "../../../shared/lib/keyboard";
import {
  captureDraft,
  dropPastedText,
  insertRestoredText,
} from "../../../shared/lib/draftRestore";
import {
  createBlankSkill,
  rankSkills,
  hasNativeCommands,
  isNativeCommandPrompt,
  replaceSlashToken,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../../skills/model/skills";
import { AccessPicker } from "./AccessPicker";
import type { ComposerCloudLaunch } from "../../provider-sessions/ui/CloudLaunchControls";
import { ComposerRunner } from "./ComposerRunner";
import { ContextMeter } from "./ContextMeter";
import type { ProcessedUsage } from "../model/tokenAccounting";
import type { Block } from "../model/session";
import { AttachmentChip } from "./AttachmentChip";
import { BranchPicker } from "../../source-control/ui/BranchPicker";
import { WorktreePicker } from "../../source-control/ui/WorktreePicker";
import {
  isWorkspaceModeShortcut,
  WorkspaceIdentity,
  WorkspacePicker,
} from "../../workspace/ui/WorkspacePicker";
import type { Worktree } from "../../source-control/model/worktrees";
import { CwdPicker } from "../../projects/ui/CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { McpServerPicker } from "./McpServerPicker";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { InboxMiniCard } from "../../inbox/ui/InboxMiniCard";
import { NoteMiniCard } from "../../notes/ui/NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import {
  ModelControlPills,
  ModelPicker,
  type ModelPickerAccount,
} from "./ModelPicker";
import { QuestionForm } from "./QuestionForm";
import { McpForm } from "./McpForm";
import { MessageQueue } from "./MessageQueue";
export { MessageQueue } from "./MessageQueue";
import { SkillPicker } from "../../skills/ui/SkillPicker";
import { SavedPromptMenu } from "../../prompts/ui/SavedPromptMenu";
import { useSavedPromptMenu } from "../../prompts/ui/useSavedPromptMenu";
import { pathKey, projectKey } from "../../../shared/lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../model/quoteDraft";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import {
  COMPOSER_RUNNER_CHANGE_EVENT,
  loadComposerRunner,
  loadModelControls,
  loadNotesEnabled,
  subscribeModelControls,
  subscribeNotesEnabled,
} from "../../settings/model/settings";
import {
  isNoteMentionPath,
  loadNotes,
  peekNotes,
  rankNoteFiles,
  notesAsProjectFiles,
  type Note,
  type NoteComposerCard,
} from "../../notes";
import { resolveTabGroupLogo } from "../../workspace/model/tabGroups";
import { useComposerSkills } from "./useComposerSkills";
import { Popover } from "../../../shared/ui/Popover";
import { UsageLimitNotice } from "./UsageLimitNotice";
import { consumePlanCommand, PLAN_COMMAND } from "../model/plan";
import {
  consumeOperatorCommand,
  operatorEnabledInThread,
  OPERATOR_COMMAND,
} from "../model/operatorCommand";
import {
  consumeOrchestratorCommand,
  ORCHESTRATOR_COMMAND,
} from "../model/orchestratorCommand";
import { consumeDraftCommand, DRAFT_COMMAND } from "../model/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_INDENT,
  ModeCommandPill,
  ModeCommandText,
  type ModeCommandToken,
} from "./modeCommands";
import {
  BTW_COMMAND,
  consumeBtwCommand,
  consumeBtwPrefix,
  supportsBtwHarness,
} from "../model/btw";
import { COMPACT_COMMAND, isCompactCommand } from "../model/compact";
import {
  consumeSessionFolderCommand,
  isSessionFolderCommand,
  runsSessionFolderCommandOnSpace,
  SESSION_FOLDER_COMMAND,
} from "../model/sessionFolderCommand";
import {
  loadSessionFolders,
  type SessionFolderTarget,
  type SessionFolder,
} from "../model/sessionFolders";
import { SessionFolderPicker } from "./SessionFolderPicker";
import { MCP_COMMAND, isMcpCommand } from "../model/mcpCommand";
import {
  mcpContextText,
  mcpTagParts,
  newMcpTag,
  taggedMcpServers,
  type McpTag,
} from "../model/mcpPicker";
import {
  COMPOSER_INPUT_RESTORE_EVENT,
  getComposerMcpTags,
  setComposerDraft,
  setComposerMcpTags,
  type ComposerInputRestore,
} from "../model/draftCache";
import { type McpConnection } from "../../settings/model/mcp";
import {
  getCachedMcpSettings,
  loadMcpSettings,
  subscribeMcpSettings,
  type McpSettingsSnapshot,
} from "../../settings/model/mcpSettingsCache";
import type { LastTurnRecall } from "../model/editLastTurn";
import { canSteerHarness } from "../../../integrations/harness/core/registry";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  FOLLOW_UP_BEHAVIOR_DEFAULT,
  loadFollowUpBehavior,
  subscribeFollowUpBehavior,
  type FollowUpBehavior,
} from "../../settings/model/settings";
import {
  resolveComposerActionAriaLabel,
  resolveComposerActionTooltip,
  resolveComposerButtonAction,
  resolveComposerKeyAction,
  resolveEffectiveSuggestionAction,
  type ActionResolutionContext,
} from "./composerAction";
import { useComposerAutocorrect } from "../../settings/model/displayPrefs";

type Props = {
  enabled?: boolean;
  focused: boolean;
  /** Bump to force a refocus even when `focused` was already true (e.g. window regains OS focus). */
  focusToken?: number;
  shell?: boolean;
  compact?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  disabled?: boolean;
  allowedModelHarnesses?: readonly HarnessId[];
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  cwd?: string;
  executionCwd: string;
  sessionId?: string;
  nativeSessionBound?: boolean;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  /** Keeps local file mentions, skills, and app modes off for host sessions. */
  remoteSession?: boolean;
  remoteFeatures?: { attachments: boolean; plan: boolean; draft: boolean };
  context?: ContextUsage;
  turnUsage?: ProcessedUsage;
  sessionUsage?: ProcessedUsage;
  blocks?: Block[];
  compactSupported?: boolean;
  quoteRequest?: QuoteRequest;
  initialDraft?: string;
  draftResetToken?: number;
  inboxCard?: InboxComposerCard;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  question?: UserQuestionPrompt;
  form?: McpFormPrompt;
  busy?: boolean;
  canSteer?: boolean;
  /** Allow typed follow-ups to be submitted while a turn is running. */
  allowBusySubmit?: boolean;
  editLastTurnSupported?: boolean;
  lastTurnRecall?: LastTurnRecall | null;
  queuedMessages?: QueuedMessage[];
  queueStatus?: MessageQueueStatus;
  queueHoldReason?: string;
  usageLimit?: UsageLimit;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onWorktreeChange?: (tree: Worktree) => Promise<void>;
  draftWorkspace?: boolean;
  workspaceMode?: WorkspaceMode;
  worktreeBase?: string;
  onWorkspaceModeChange?: (mode: WorkspaceMode, base?: string) => void;
  onWorktreeBaseChange?: (base: string) => void;
  worktreeRemoved?: boolean;
  onManageWorktrees?: () => void;
  onNewTerminal?: () => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  /** Account choice for the model picker (fork, L-96). */
  providerAccount?: ModelPickerAccount;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onOperatorDisable?: () => void;
  externalTurnActive?: boolean;
  onQuoteRequestConsumed?: (id: number) => void;
  onInboxCardDismiss?: () => void;
  onNoteCardDismiss?: () => void;
  onHandoffCardDismiss?: () => void;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  onFormReply?: (requestId: number, reply: McpFormReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  /** `draft` opens the side question with the text unsent, for a typed `/btw `. */
  onBtwCommand?: (
    text: string,
    options?: { draft?: boolean },
  ) => boolean | void;
  canSaveDraft?: boolean;
  onSaveDraft?: (text: string, attachments: Attachment[]) => boolean | void;
  onStop?: () => void;
  onCompactContext?: () => boolean;
  onPlaceInFolder?: (target: SessionFolderTarget) => void;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onEditQueuedMessage?: (messageId: string, text: string) => void;
  onQueuedMessageEditingChange?: (messageId?: string) => void;
  onSteerQueuedMessage?: (messageId: string) => void;
  onResumeQueue?: () => void;
  onUsageLimitResume?: () => void;
  onUsageLimitResumeAtReset?: (enabled: boolean) => void;
  onUsageLimitDismiss?: () => void;
  onOpenFile?: (path: string) => void;
  onDraftChange?: (text: string) => void;
  onPendingInputChange?: (pending: boolean) => void;
  onRecallLastTurnReady?: (recall: () => void) => void;
  onEditingLastTurnChange?: (editing: boolean) => void;
  /** Local | Cloud choice for a new session; Cloud launches instead of sending a local turn. */
  cloudLaunch?: ComposerCloudLaunch;
  /** "Work in" (This computer / Cloud / Remote) shown after the branch. */
  workIn?: ReactNode;
  children?: ReactNode;
};

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md ${
        active
          ? "bg-selection-emphasis text-content"
          : "bg-selection text-content/50 hover:bg-selection-hover hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/50`}
    >
      {children}
    </button>
  );
}

export function Composer({
  enabled = true,
  focused,
  focusToken,
  hotkeys = false,
  shell = false,
  compact = false,
  placeholder,
  inputAriaLabel,
  disabled = false,
  harness,
  model,
  allowedModelHarnesses,
  modelSettings = {},
  runtimeMode,
  cwd = "~",
  executionCwd,
  sessionId,
  nativeSessionBound = false,
  branch,
  recents = [],
  hideProjectPicker = false,
  hideBranchPicker = false,
  hideTopBar = false,
  remoteSession = false,
  remoteFeatures,
  context,
  turnUsage,
  sessionUsage,
  blocks = [],
  compactSupported = false,
  quoteRequest,
  initialDraft,
  draftResetToken,
  inboxCard,
  noteCard,
  handoffCard,
  question,
  busy = false,
  canSteer,
  allowBusySubmit = true,
  editLastTurnSupported = false,
  lastTurnRecall = null,
  queuedMessages = [],
  queueStatus,
  queueHoldReason,
  usageLimit,
  onFocus,
  onCwdChange,
  onBranchChange,
  onWorktreeChange,
  draftWorkspace = false,
  workspaceMode,
  worktreeBase,
  onWorkspaceModeChange,
  onWorktreeBaseChange,
  worktreeRemoved = false,
  onManageWorktrees,
  onNewTerminal,
  onModelChange,
  providerAccount,
  onModelSettingsChange,
  onRuntimeModeChange,
  onQuoteRequestConsumed,
  onInboxCardDismiss,
  onBtwCommand,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onQuestionReply,
  form,
  onFormReply,
  onQuestionInteraction,
  onSubmit,
  canSaveDraft = false,
  onSaveDraft,
  onStop,
  onCompactContext,
  onPlaceInFolder,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onQueuedMessageEditingChange,
  onSteerQueuedMessage,
  onResumeQueue,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onOpenFile,
  onDraftChange,
  onPendingInputChange,
  onRecallLastTurnReady,
  onEditingLastTurnChange,
  cloudLaunch,
  workIn,
  onOperatorDisable,
  externalTurnActive = false,
  children,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const borrowedAttachmentIdsRef = useRef(new Set<string>());
  const attachmentLifecycleRef = useRef(0);
  const consumedQuoteId = useRef<number | null>(null);
  const draftRevisionRef = useRef(0);
  const draftResetTokenRef = useRef(draftResetToken);
  /** Bumped when the draft is cleared, so a late file read cannot land on the next one. */
  const pasteGenerationRef = useRef(0);
  /** Pasted and dropped files still reading when Send is pressed. */
  const pasteFlightRef = useRef<Promise<void> | null>(null);
  const submitLockRef = useRef(false);
  const positionedInitialDraft = useRef(false);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  // React rewrites a textarea's text node whenever defaultValue changes, and
  // WebKit then resets the field, committing any IME composition. Parents
  // re-render with the latest draft (remote sessions on every poll), so keep
  // the mount-time value; the effect below applies later changes.
  const [mountDraft] = useState(initialDraft);
  const { branches: draftBranches } = useProjectBranchesState(
    executionCwd,
    draftWorkspace && enabled && !busy,
  );
  const resolvedWorktreeBase =
    worktreeBase && worktreeBase !== "HEAD"
      ? worktreeBase
      : branch || draftBranches?.current || worktreeBase || undefined;
  useEffect(() => {
    if (
      draftWorkspace &&
      workspaceMode === "worktree" &&
      worktreeBase === "HEAD" &&
      draftBranches?.current
    ) {
      onWorktreeBaseChange?.(draftBranches.current);
    }
  }, [
    draftBranches?.current,
    draftWorkspace,
    onWorktreeBaseChange,
    workspaceMode,
    worktreeBase,
  ]);
  const [hasValue, setHasValue] = useState(
    () =>
      (initialDraft ?? "").trim().length > 0 ||
      !!inboxCard ||
      !!noteCard ||
      !!handoffCard,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [interactiveTerminalOpen, setInteractiveTerminalOpen] = useState(false);
  useSyncExternalStore(subscribeInteractiveTerminals, interactiveTerminalRevision);
  const liveInteractiveTerminal = sessionId ? interactiveTerminalFor(sessionId) : undefined;
  const interactiveDiagnosticsAvailable = !!sessionId && hasInteractiveClaudeDiagnostics(sessionId);
  useEffect(() => { if (!liveInteractiveTerminal && !interactiveDiagnosticsAvailable) setInteractiveTerminalOpen(false); }, [liveInteractiveTerminal, interactiveDiagnosticsAvailable]);
  const [planSelected, setPlanSelected] = useState(false);
  const [operatorSelected, setOperatorSelected] = useState(false);
  const [orchestrationSelected, setOrchestrationSelected] = useState(false);
  const [draftSelected, setDraftSelected] = useState(false);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [skillActive, setSkillActive] = useState(0);
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [sessionFolderOpen, setSessionFolderOpen] = useState(false);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>([]);
  const [sessionFolderSelected, setSessionFolderSelected] = useState(false);
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const [mcpConnections, setMcpConnections] = useState<McpConnection[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Map<string, string>>(new Map());
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const cliAgentLocked = busy || nativeSessionBound;
  const cliAgents = useAntigravityCliAgents(
    harness, executionCwd, modelSettings.antigravityAgent, cliAgentLocked,
  );
  const [selectedMcp, setSelectedMcp] = useState<McpTag[]>(() =>
    sessionId ? getComposerMcpTags(sessionId) : [],
  );
  const mcpInsertAt = useRef<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const remote = remoteSession;
  // Local indexes (files, skills) must never read a remote session's path.
  const localCwd = remote ? "" : executionCwd;
  const [files, setFiles] = useState<ProjectFile[]>(
    () => peekProjectFiles(localCwd) ?? [],
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const modelControls = useSyncExternalStore(
    subscribeModelControls,
    loadModelControls,
    () => "menu" as const,
  );
  const controlsBeside = modelControls === "beside";
  const [notes, setNotes] = useState<Note[]>(() => peekNotes() ?? []);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [resendEdited, setResendEdited] = useState(false);
  const [runnerEnabled, setRunnerEnabled] = useState(loadComposerRunner);
  const autocorrect = useComposerAutocorrect();
  const [runnerLive, setRunnerLive] = useState(
    () => busy && loadComposerRunner(),
  );
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  slashRef.current = slash;
  mentionRef.current = mention;

  attachmentsRef.current = attachments;
  useEffect(() => {
    onPendingInputChange?.(draft.length > 0 || attachments.length > 0);
  }, [draft, attachments.length, onPendingInputChange]);

  const mentionOpen =
    !remote && mention !== null && (looksLikeProject(cwd) || notesEnabled);
  const navigationEmpty =
    draft.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const skillPickerOpen = creatingSkill || slash !== null;
  const pickerOpen = skillPickerOpen || sessionFolderOpen || mcpPickerOpen;
  const skillCatalog = useComposerSkills({
    harness,
    executionCwd: localCwd,
    sessionId,
    pickerOpen: pickerOpen && !remote,
  });
  const skills = skillCatalog.skills;
  const slashItems = useMemo(
    () =>
      remote
        ? [...(remoteFeatures?.plan ? [PLAN_COMMAND] : []), COMPACT_COMMAND]
        : [
            SESSION_FOLDER_COMMAND,
            MCP_COMMAND,
            OPERATOR_COMMAND,
            ...(hideTopBar ? [] : [ORCHESTRATOR_COMMAND]),
            PLAN_COMMAND,
            ...(canSaveDraft && onSaveDraft ? [DRAFT_COMMAND] : []),
            COMPACT_COMMAND,
            ...(supportsBtwHarness(harness) ? [BTW_COMMAND] : []),
            ...skills.filter(
              (skill) =>
                ![OPERATOR_COMMAND.name, "mono", "monocode"].includes(
                  skill.name,
                ) &&
                (skill.kind === "native" ||
                  (skill.name !== PLAN_COMMAND.name &&
                    skill.name !== COMPACT_COMMAND.name &&
                    skill.name !== SESSION_FOLDER_COMMAND.name &&
                    skill.name !== MCP_COMMAND.name &&
                    skill.name !== ORCHESTRATOR_COMMAND.name &&
                    skill.name !== DRAFT_COMMAND.name &&
                    skill.name !== BTW_COMMAND.name)),
            ),
          ],
    [
      harness,
      skills,
      remote,
      remoteFeatures?.plan,
      hideTopBar,
      canSaveDraft,
      onSaveDraft,
    ],
  );
  const skillLimit = hasNativeCommands(harness)
    ? Number.POSITIVE_INFINITY
    : undefined;
  const rankedSkills = rankSkills(slashItems, slash?.query ?? "", skillLimit);
  const attachmentsSupported =
    (!remote || !!remoteFeatures?.attachments) &&
    harnessSupportsAttachments(harness);
  const skillNames = useMemo(
    () => new Set(slashItems.map((skill) => skill.invocation)),
    [slashItems],
  );
  const leadingMode = leadingModeCommand(draft, skillNames);
  const modeIndent = leadingMode ? MODE_COMMAND_INDENT : undefined;
  useLayoutEffect(() => {
    // The indent can rewrap the first line after the input already resized.
    if (ref.current) resizeComposer(ref.current);
  }, [modeIndent]);
  const mentionFiles = useMemo(
    () => (notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files),
    [files, notes, notesEnabled],
  );
  const mentionIndex = useMemo(
    () => buildMentionIndex(mentionFiles),
    [mentionFiles],
  );
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  mentionIndexRef.current = mentionIndex;
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const fileHits = looksLikeProject(executionCwd)
      ? rankMentionFiles(
          files,
          mention?.query ?? "",
          recentOpenedFiles(executionCwd),
        )
      : [];
    const noteHits = notesEnabled
      ? rankNoteFiles(notes, mention?.query ?? "")
      : [];
    const seen = new Set(noteHits.map((file) => file.path));
    return [...noteHits, ...fileHits.filter((file) => !seen.has(file.path))];
  }, [executionCwd, files, mention?.query, mentionOpen, notes, notesEnabled]);

  const syncHasValue = useCallback(
    (text: string, files: Attachment[]) => {
      setHasValue(
        text.trim().length > 0 ||
          files.length > 0 ||
          !!inboxCard ||
          !!noteCard ||
          !!handoffCard,
      );
    },
    [inboxCard, noteCard, handoffCard],
  );

  useEffect(() => {
    const restore = (event: Event) => {
      const input = (event as CustomEvent<ComposerInputRestore>).detail;
      if (!input || input.sessionId !== sessionId) return;
      pasteGenerationRef.current += 1;
      draftRevisionRef.current += 1;
      const currentText = ref.current?.value ?? draft;
      const text =
        !currentText || currentText === input.text
          ? input.text
          : `${input.text}\n\n${currentText}`;
      const files = mergeAttachments(input.attachments, attachmentsRef.current);
      setComposerDraft(sessionId, text);
      attachmentsRef.current = files;
      borrowedAttachmentIdsRef.current.clear();
      setAttachments(files);
      setDraft(text);
      if (ref.current) {
        ref.current.value = text;
        resizeComposer(ref.current);
        ref.current.setSelectionRange(text.length, text.length);
      }
      syncHasValue(text, files);
    };
    window.addEventListener(COMPOSER_INPUT_RESTORE_EVENT, restore);
    return () => window.removeEventListener(COMPOSER_INPUT_RESTORE_EVENT, restore);
  }, [draft, sessionId, syncHasValue]);

  // A leading mode command in the text shows the same pill as picking the mode.
  const operatorThreadEnabled = !remote && operatorEnabledInThread(blocks);
  const operatorActive =
    operatorThreadEnabled ||
    operatorSelected || leadingMode?.name === OPERATOR_COMMAND.name;
  const orchestrationActive =
    orchestrationSelected || leadingMode?.name === ORCHESTRATOR_COMMAND.name;
  const draftActive = draftSelected || leadingMode?.name === DRAFT_COMMAND.name;
  const planActive = planSelected || leadingMode?.name === PLAN_COMMAND.name;

  /** Turning a mode off also drops its leading command from the text. */
  const clearLeadingMode = (name: string) => {
    const el = ref.current;
    if (!el || leadingModeCommand(el.value, skillNames)?.name !== name) return;
    const next = el.value.replace(/^\/[a-z]+\s?/, "");
    el.value = next;
    resizeComposer(el);
    el.setSelectionRange(0, 0);
    setDraft(next);
    onDraftChange?.(next);
    syncHasValue(next, attachmentsRef.current);
  };

  const openMcpPicker = useCallback(() => {
    setMcpConnections([]);
    setMcpStatus(new Map());
    setMcpError("");
    setMcpLoading(true);
    setMcpPickerOpen(true);
  }, []);

  useEffect(() => {
    if (!mcpPickerOpen) return;
    const apply = (snapshot: McpSettingsSnapshot) => {
      setMcpConnections(snapshot.servers);
      setMcpStatus(
        new Map(
          snapshot.servers
            .filter((server) => server.provider === "claude")
            .map((server) => [server.name, server.status]),
        ),
      );
      setMcpError(snapshot.error);
      setMcpLoading(false);
    };
    const stop = subscribeMcpSettings(executionCwd, apply);
    const cached = getCachedMcpSettings(executionCwd);
    if (cached) apply(cached);
    void loadMcpSettings(executionCwd, false, {
      claudeHealth: harness === "claude",
    });
    return stop;
  }, [executionCwd, harness, mcpPickerOpen]);

  useEffect(() => {
    setMcpPickerOpen(false);
  }, [executionCwd, harness, sessionId]);

  useEffect(() => {
    if (sessionId) setComposerMcpTags(sessionId, selectedMcp);
  }, [sessionId, selectedMcp]);

  useEffect(() => {
    syncHasValue(ref.current?.value ?? "", attachmentsRef.current);
  }, [inboxCard, noteCard, handoffCard, syncHasValue]);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!harnessSupportsAttachments(harness) || incoming.length === 0) return;
      const next = mergeAttachments(attachmentsRef.current, incoming);
      attachmentsRef.current = next;
      setAttachments(next);
      setPasteError(null);
      draftRevisionRef.current += 1;
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [harness, syncHasValue],
  );
  // Native listener registration crosses several IPC hops. Keep changing
  // composer callbacks and capabilities out of its subscription dependencies.
  const fileDropStateRef = useRef({
    attachmentsSupported,
    remote,
    addAttachments,
  });
  fileDropStateRef.current = { attachmentsSupported, remote, addAttachments };

  const rememberAttachmentRead = useCallback((work: Promise<void>) => {
    const flight = work.then(
      () => undefined,
      () => undefined,
    );
    const previous = pasteFlightRef.current;
    const joined = previous ? previous.then(() => flight) : flight;
    pasteFlightRef.current = joined;
    void joined.finally(() => {
      if (pasteFlightRef.current === joined) pasteFlightRef.current = null;
    });
  }, []);

  const readDroppedAttachments = useCallback(
    (read: () => Promise<Attachment[]>) => {
      const generation = pasteGenerationRef.current;
      setPasteError(null);
      rememberAttachmentRead(
        read()
          .then((incoming) => {
            if (
              pasteGenerationRef.current !== generation ||
              !fileDropStateRef.current.attachmentsSupported
            ) {
              incoming.forEach(revokeAttachment);
              return;
            }
            if (incoming.length === 0) {
              setPasteError(
                "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.",
              );
              return;
            }
            fileDropStateRef.current.addAttachments(incoming);
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(
              reason instanceof Error ? reason.message : String(reason),
            );
          }),
      );
    },
    [rememberAttachmentRead],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const previous = attachmentsRef.current;
      const removed = previous.find((file) => file.id === id);
      if (removed && !borrowedAttachmentIdsRef.current.delete(removed.id)) {
        revokeAttachment(removed);
      }
      const next = previous.filter((file) => file.id !== id);
      attachmentsRef.current = next;
      draftRevisionRef.current += 1;
      setAttachments(next);
      setPasteError(null);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue],
  );
  useEffect(() => {
    const lifecycle = ++attachmentLifecycleRef.current;
    return () => {
      queueMicrotask(() => {
        if (attachmentLifecycleRef.current !== lifecycle) return;
        pasteGenerationRef.current += 1;
        for (const file of attachmentsRef.current) {
          if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
            revokeAttachment(file);
          }
        }
        attachmentsRef.current = [];
        borrowedAttachmentIdsRef.current.clear();
      });
    };
  }, []);

  useEffect(() => {
    if (harnessSupportsAttachments(harness)) return;
    const previous = attachmentsRef.current;
    if (previous.length === 0) return;
    for (const file of previous) {
      if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
        revokeAttachment(file);
      }
    }
    attachmentsRef.current = [];
    setAttachments([]);
    syncHasValue(ref.current?.value ?? "", []);
  }, [harness, syncHasValue]);
  useEffect(() => {
    const refresh = () => setRunnerEnabled(loadComposerRunner());
    window.addEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
    return () =>
      window.removeEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!runnerEnabled) {
      setRunnerLive(false);
      return;
    }
    if (busy) setRunnerLive(true);
  }, [busy, runnerEnabled]);

  useEffect(() => {
    setSkillActive(0);
  }, [slash?.query, cwd]);

  useEffect(() => {
    setSessionFolderOpen(false);
    setSessionFolderSelected(false);
  }, [cwd]);

  useEffect(() => {
    setSkillActive((index) =>
      rankedSkills.length === 0 ? 0 : Math.min(index, rankedSkills.length - 1),
    );
  }, [rankedSkills.length]);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: ProjectFile[]) => {
      if (!cancelled) setFiles(next);
    };
    const cached = peekProjectFiles(localCwd);
    apply(cached ?? []);
    if (!localCwd) return;
    void loadProjectFiles(localCwd, mentionOpen)
      .then(apply)
      .catch(() => undefined);
    const unsub = subscribeProjectFiles(() => {
      const next = peekProjectFiles(localCwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [localCwd, mentionOpen]);

  useEffect(() => {
    if (!mentionOpen || !notesEnabled) return;
    let cancelled = false;
    void loadNotes().then((next) => {
      if (!cancelled) setNotes(next);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, notesEnabled]);

  useEffect(() => {
    setMentionActive(0);
  }, [mention?.query, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    if (el.value !== initialDraft) el.value = initialDraft;
    if (!positionedInitialDraft.current) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
      positionedInitialDraft.current = true;
    }
    resizeComposer(el);
  }, [initialDraft]);

  // Drafts changed while hidden could not be measured. Inbox panes are portaled
  // into place by a parent effect that runs after this one, so the first pass
  // can still find no layout box; retry once the move has landed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    resizeComposer(el);
    if (el.scrollHeight !== 0) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) resizeComposer(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);
  useEffect(() => {
    if (
      draftResetToken == null ||
      draftResetTokenRef.current === draftResetToken
    ) {
      return;
    }
    draftResetTokenRef.current = draftResetToken;
    pasteGenerationRef.current += 1;
    draftRevisionRef.current += 1;
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
    setDraftSelected(false);
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    syncHasValue("", attachmentsRef.current);
  }, [draftResetToken, onDraftChange, syncHasValue]);

  const syncHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The textarea can scroll itself to keep the caret visible before React
    // commits the updated highlight text. Sync again after that commit, when
    // the overlay has enough scrollable content to accept the same offset.
    syncHighlightScroll(el);
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) syncHighlightScroll(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, syncHighlightScroll]);

  // `!` inserts a saved prompt (Settings → Prompts) at the caret.
  const promptMenu = useSavedPromptMenu({
    apply: (next, cursor) => {
      const el = ref.current;
      if (!el) return;
      el.value = next;
      resizeComposer(el);
      el.setSelectionRange(cursor, cursor);
      draftRevisionRef.current += 1;
      setDraft(next);
      onDraftChange?.(next);
      syncHasValue(next, attachmentsRef.current);
      el.focus();
    },
  });

  const syncTokensFromTextarea = (el: HTMLTextAreaElement) => {
    if (creatingSkill) return;
    const cursor = el.selectionStart ?? 0;
    const token = slashTokenAt(el.value, cursor, hasNativeCommands(harness));
    setSlash(token);
    setMention(token ? null : mentionTokenAt(el.value, cursor));
    promptMenu.sync(el);
  };

  const openSessionFolderPicker = useCallback(() => {
    setSessionFolders(loadSessionFolders(cwd));
    setSessionFolderOpen(true);
  }, [cwd]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !quoteRequest) return;

    const result = consumeQuoteRequest(
      el.value,
      consumedQuoteId.current,
      quoteRequest,
    );
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      el.value = result.draft;
      resizeComposer(el);
      setDraft(result.draft);
      syncHasValue(result.draft, attachmentsRef.current);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(result.draft.length, result.draft.length);
      el.focus();
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [onQuoteRequestConsumed, quoteRequest, syncHasValue]);

  // `/btw ` opens the side conversation as soon as it is typed, carrying any
  // text after it over as the unsent side question.
  const enterBtwFromPrefix = useCallback(
    (el: HTMLTextAreaElement) => {
      if (!onBtwCommand || inboxCard || noteCard || handoffCard) return false;
      if (attachmentsRef.current.length > 0) return false;
      const rest = consumeBtwPrefix(el.value);
      if (rest == null || onBtwCommand(rest, { draft: true }) === false) {
        return false;
      }
      el.value = "";
      resizeComposer(el);
      draftRevisionRef.current += 1;
      setDraft("");
      onDraftChange?.("");
      syncHasValue("", attachmentsRef.current);
      setSlash(null);
      setMention(null);
      return true;
    },
    [
      handoffCard,
      inboxCard,
      noteCard,
      onBtwCommand,
      onDraftChange,
      syncHasValue,
    ],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      const el = ref.current;
      const token = slashRef.current;
      if (!el || !token) {
        setSlash(null);
        setCreatingSkill(false);
        return;
      }
      if (skill.kind === "builtin" && skill.name === MCP_COMMAND.name) {
        const next = `${el.value.slice(0, token.start)}${el.value.slice(token.end).replace(/^\s/, "")}`;
        el.value = next;
        resizeComposer(el);
        mcpInsertAt.current = token.start;
        el.setSelectionRange(token.start, token.start);
        setDraft(next);
        onDraftChange?.(next);
        syncHasValue(next, attachmentsRef.current);
        setSlash(null);
        openMcpPicker();
        return;
      }
      const sessionFolderCommand =
        skill.kind === "builtin" &&
        skill.name === SESSION_FOLDER_COMMAND.name &&
        !!onPlaceInFolder;
      if (sessionFolderCommand) {
        const next = replaceSlashToken(
          el.value,
          token,
          SESSION_FOLDER_COMMAND.invocation,
        );
        el.value = next;
        resizeComposer(el);
        let cursor = token.start + SESSION_FOLDER_COMMAND.invocation.length + 1;
        if (next[cursor] === " ") cursor += 1;
        el.setSelectionRange(cursor, cursor);
        setDraft(next);
        syncHasValue(next, attachmentsRef.current);
        setSlash(null);
        setCreatingSkill(false);
        openSessionFolderPicker();
        return;
      }
      const next = replaceSlashToken(el.value, token, skill.invocation);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setSlash(null);
      setCreatingSkill(false);
      if (skill.kind === "builtin" && skill.name === BTW_COMMAND.name) {
        enterBtwFromPrefix(el);
      }
      el.focus();
    },
    [
      enterBtwFromPrefix,
      onDraftChange,
      onPlaceInFolder,
      openMcpPicker,
      openSessionFolderPicker,
      syncHasValue,
    ],
  );

  const pickMention = useCallback(
    (file: ProjectFile) => {
      const el = ref.current;
      const token = mentionRef.current;
      if (!el || !token) {
        setMention(null);
        return;
      }
      const label = isNoteMentionPath(file.path)
        ? file.relative
        : mentionLabel(file, mentionIndexRef.current);
      const next = replaceMentionToken(el.value, token, label);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      setDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setMention(null);
      el.focus();
    },
    [syncHasValue],
  );

  useEffect(() => {
    if (!focused || disabled) return;

    const composer = ref.current?.closest("[data-composer]");
    const activeComposer = document.activeElement?.closest("[data-composer]");
    const activeComposerHidden = activeComposer?.closest(
      '[aria-hidden="true"], [inert]',
    );
    // Inactive workspace tabs stay mounted, so focus can still be sitting in
    // their composer when a new session becomes active. Only preserve focus
    // for another composer that is still visible (for example, a split pane).
    if (activeComposer && activeComposer !== composer && !activeComposerHidden)
      return;

    if (
      composer?.querySelector(
        "[data-skill-picker], [data-session-folder-picker], [data-mention-picker], [data-mcp-picker], [data-composer-plus], [data-question-form]",
      )
    )
      return;
    // Model/access/branch/settings/file pickers render through a portal into
    // document.body (see Popover.tsx), so they never appear under this
    // composer's own DOM subtree — check the whole document for those.
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-model-settings], [data-file-picker], [data-branch-picker]",
      )
    )
      return;
    ref.current?.focus();
  }, [disabled, focused, question, busy, focusToken]);

  const fileDrag = useFileDrop({
    anchor: boxRef,
    enabled: enabled && !disabled,
    state: fileDropStateRef,
    read: readDroppedAttachments,
    onError: setPasteError,
  });
  const restoreDraft = useCallback(
    (
      text: string,
      nextAttachments: Attachment[],
      borrowedIds: ReadonlySet<string> = borrowedAttachmentIdsRef.current,
    ) => {
      setDraft(text);
      onDraftChange?.(text);
      if (ref.current) {
        ref.current.value = text;
        resizeComposer(ref.current);
      }

      const nextIds = new Set(nextAttachments.map((file) => file.id));
      for (const file of attachmentsRef.current) {
        if (
          nextIds.has(file.id) ||
          borrowedAttachmentIdsRef.current.delete(file.id)
        ) {
          continue;
        }
        revokeAttachment(file);
      }
      borrowedAttachmentIdsRef.current = new Set(
        nextAttachments
          .filter((file) => borrowedIds.has(file.id))
          .map((file) => file.id),
      );
      attachmentsRef.current = nextAttachments;
      setAttachments(nextAttachments);
      syncHasValue(text, nextAttachments);
      ref.current?.focus();
    },
    [onDraftChange, syncHasValue],
  );

  const exitEditMode = useCallback(() => {
    draftRevisionRef.current += 1;
    pasteGenerationRef.current += 1;
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
    const previous = attachmentsRef.current;
    for (const file of previous) {
      if (!borrowedAttachmentIdsRef.current.delete(file.id)) {
        revokeAttachment(file);
      }
    }
    attachmentsRef.current = [];
    setAttachments([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setMcpPickerOpen(false);
    setSelectedMcp([]);
    syncHasValue("", []);
    ref.current?.focus();
  }, [onDraftChange, onEditingLastTurnChange, syncHasValue]);

  const recallLastTurn = useCallback(() => {
    if (!editLastTurnSupported || !lastTurnRecall) return;
    if (resendEdited) {
      exitEditMode();
      return;
    }
    restoreDraft(
      lastTurnRecall.text,
      lastTurnRecall.attachments,
      new Set(lastTurnRecall.attachments.map((file) => file.id)),
    );
    setResendEdited(true);
    onEditingLastTurnChange?.(true);
  }, [
    editLastTurnSupported,
    exitEditMode,
    lastTurnRecall,
    onEditingLastTurnChange,
    resendEdited,
    restoreDraft,
  ]);

  useEffect(() => {
    draftRevisionRef.current += 1;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [sessionId, onEditingLastTurnChange]);

  useEffect(() => {
    if (editLastTurnSupported) return;
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
  }, [editLastTurnSupported, onEditingLastTurnChange]);

  useEffect(() => {
    if (!editLastTurnSupported || !onRecallLastTurnReady) return;
    onRecallLastTurnReady(recallLastTurn);
  }, [editLastTurnSupported, onRecallLastTurnReady, recallLastTurn]);

  const followUpBehavior = useSyncExternalStore(
    subscribeFollowUpBehavior,
    loadFollowUpBehavior,
    () => FOLLOW_UP_BEHAVIOR_DEFAULT,
  );
  const effectiveCanSteer =
    !(harness === "claude" && modelSettings.claudeExecution === "interactive") &&
    (canSteer ?? canSteerHarness(harness));

  const actionContext: ActionResolutionContext = useMemo(
    () => ({
      busy: Boolean(busy),
      followUpBehavior,
      canSteer: effectiveCanSteer,
      planMode: planSelected,
      isMac: IS_MAC,
    }),
    [busy, followUpBehavior, effectiveCanSteer, planSelected],
  );

  const actionTooltip = useMemo(
    () => resolveComposerActionTooltip(actionContext),
    [actionContext],
  );

  const actionAriaLabel = useMemo(
    () => resolveComposerActionAriaLabel(actionContext),
    [actionContext],
  );

  const submit = (
    value: string,
    options?: { followUpBehavior?: FollowUpBehavior },
  ) => {
    if (
      disabled ||
      worktreeRemoved ||
      (busy && !allowBusySubmit) ||
      submitLockRef.current
    )
      return;
    submitLockRef.current = true;
    void completeSubmit(value, options).finally(() => {
      submitLockRef.current = false;
    });
  };
  const completeSubmit = async (
    submittedValue: string,
    options?: { followUpBehavior?: FollowUpBehavior },
  ) => {
    let pending = pasteFlightRef.current;
    const generation = pasteGenerationRef.current;
    while (pending) {
      await pending;
      // A reset or an earlier send retired this draft while the read was out.
      if (pasteGenerationRef.current !== generation) return;
      pending = pasteFlightRef.current;
    }
    const value = ref.current?.value ?? submittedValue;
    if (disabled || worktreeRemoved) return;
    if (isMcpCommand(value)) {
      mcpInsertAt.current = 0;
      if (ref.current) {
        ref.current.value = "";
        ref.current.style.height = "auto";
      }
      setDraft("");
      onDraftChange?.("");
      setSlash(null);
      syncHasValue("", attachments);
      openMcpPicker();
      return;
    }
    const draftCommand = canSaveDraft
      ? consumeDraftCommand(value)
      : { text: value, matched: false };
    if ((draftSelected || draftCommand.matched) && onSaveDraft) {
      const files = attachmentsRef.current;
      const text = draftCommand.text;
      if (!text.trim() && files.length === 0) return;
      const accepted = onSaveDraft(
        mcpContextText(taggedMcpServers(text, selectedMcp), text),
        files,
      );
      if (accepted === false || !ref.current) return;
      pasteGenerationRef.current += 1;
      ref.current.value = "";
      ref.current.style.height = "auto";
      setDraft("");
      onDraftChange?.("");
      setAttachments([]);
      setDraftSelected(false);
      setSelectedMcp([]);
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
      return;
    }
    const folderCommand = consumeSessionFolderCommand(value);
    const btwCommand = consumeBtwCommand(value);
    if (
      btwCommand.matched &&
      onBtwCommand &&
      attachmentsRef.current.length === 0 &&
      !inboxCard &&
      !noteCard &&
      !handoffCard
    ) {
      const accepted = onBtwCommand(btwCommand.text);
      if (accepted === false) return;
      pasteGenerationRef.current += 1;
      if (ref.current) {
        ref.current.value = "";
        ref.current.style.height = "auto";
      }
      setDraft("");
      onDraftChange?.("");
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", []);
      return;
    }
    if (folderCommand.matched && onPlaceInFolder && !sessionFolderSelected) {
      openSessionFolderPicker();
      return;
    }
    if (isCompactCommand(value)) {
      if (!onCompactContext?.()) return;
      if (!ref.current) return;
      pasteGenerationRef.current += 1;
      ref.current.value = "";
      ref.current.style.height = "auto";
      setDraft("");
      onDraftChange?.("");
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachmentsRef.current);
      return;
    }

    const command = consumePlanCommand(
      folderCommand.matched && sessionFolderSelected
        ? folderCommand.text
        : value,
    );
    const orchestratorCommand =
      !remote && !hideTopBar && !command.planning
        ? consumeOrchestratorCommand(command.text)
        : { text: command.text, matched: false };
    const text = isNativeCommandPrompt(orchestratorCommand.text, harness)
      ? orchestratorCommand.text
      : composeInboxMessage(inboxCard, orchestratorCommand.text);
    const submittedText =
      operatorSelected && !consumeOperatorCommand(text).matched
        ? `/operator ${text}`
        : text;
    const files = attachmentsRef.current;
    if (!text && files.length === 0 && !noteCard && !handoffCard) return;
    // Clear the parent draft before onSubmit. The app can synchronously remount
    // the composer when the first message leaves an empty session (EmptySession →
    // docked layout). If draftRef still holds the sent text, the new instance
    // resurrects it as initialDraft.
    // Cloud: launch exactly once through the cloud API. A refusal or failure
    // keeps the text, files and chosen modes so nothing is lost.
    const launchingInCloud = cloudLaunch?.active === true;
    if (launchingInCloud) {
      if (!cloudLaunch.canLaunch) return;
      const launched = await cloudLaunch.launch(
        text,
        files,
        planActive ||
          command.planning ||
          orchestrationActive ||
          orchestratorCommand.matched ||
          operatorActive ||
          draftActive,
      );
      if (!launched) return;
    }
    const resendDraftRevision = draftRevisionRef.current;
    const resendBorrowedAttachmentIds = new Set(
      borrowedAttachmentIdsRef.current,
    );
    const resendSelectedMcp = selectedMcp;
    onDraftChange?.("");
    const accepted = launchingInCloud ? true : onSubmit(
      mcpContextText(
        taggedMcpServers(submittedText, selectedMcp),
        submittedText,
      ),
      files,
      {
        intent:
          planSelected || command.planning
            ? "plan"
            : orchestrationSelected || orchestratorCommand.matched
              ? "orchestrate"
              : "default",
        followUpBehavior: options?.followUpBehavior,
        ...(resendEdited
          ? {
              resendEdited: true,
              onResendRejected: ({ providerRewound }) => {
                if (draftRevisionRef.current !== resendDraftRevision) return;
                restoreDraft(text, files, resendBorrowedAttachmentIds);
                setSelectedMcp(resendSelectedMcp);
                setResendEdited(!providerRewound);
                onEditingLastTurnChange?.(!providerRewound);
              },
            }
          : {}),
      },
    );
    // The app can reject a turn before it is recorded (for example while an
    // orchestration is paused). Keep the user's text, files and selected mode
    // intact so resolving the blocker never destroys their work.
    if (accepted === false) {
      restoreDraft(text, files);
      return;
    }
    pasteGenerationRef.current += 1;
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
    setDraft("");
    onDraftChange?.("");
    borrowedAttachmentIdsRef.current.clear();
    attachmentsRef.current = [];
    setAttachments([]);
    setSelectedMcp([]);
    setResendEdited(false);
    onEditingLastTurnChange?.(false);
    setPlanSelected(false);
    setOperatorSelected(false);
    setOrchestrationSelected(false);
    setSessionFolderSelected(false);
    setSessionFolderOpen(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
    setPasteError(null);
    syncHasValue("", []);
  };

  const executeComposerAction = (
    action: "send" | "queue" | "steer",
    text: string,
  ): void => {
    if (action === "send") {
      submit(text);
    } else if (action === "queue") {
      submit(text, { followUpBehavior: "queue" });
    } else if (action === "steer") {
      submit(text, { followUpBehavior: "steer" });
    }
  };

  const handleActionClick = (): void => {
    const action = resolveComposerButtonAction(actionContext);
    executeComposerAction(action, ref.current?.value ?? "");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (disabled) return;
    if (isImeComposition(e.nativeEvent)) return;
    if (creatingSkill) return;
    if (promptMenu.onKeyDown(e)) return;
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      consumeBtwCommand(e.currentTarget.value).matched
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (
      e.key === " " &&
      runsSessionFolderCommandOnSpace({
        text: e.currentTarget.value,
        selectionStart: e.currentTarget.selectionStart,
        selectionEnd: e.currentTarget.selectionEnd,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
    ) {
      e.preventDefault();
      openSessionFolderPicker();
      return;
    }

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index + 1) % rankedFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive(
          (index) => (index - 1 + rankedFiles.length) % rankedFiles.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const file = rankedFiles[mentionActive];
        if (file) pickMention(file);
        return;
      }
      if (e.key === "Enter") {
        const result = resolveEffectiveSuggestionAction(
          e.key,
          {
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            isComposing: e.nativeEvent.isComposing,
          },
          Boolean(rankedFiles[mentionActive]),
          actionContext,
        );

        if (result.type === "ignore" || result.type === "newline") {
          return;
        }
        if (result.type === "pick") {
          const file = rankedFiles[mentionActive];
          if (file) {
            e.preventDefault();
            pickMention(file);
            return;
          }
        }
        if (result.type === "action") {
          setMention(null);
          e.preventDefault();
          executeComposerAction(result.action, e.currentTarget.value);
          return;
        }
        return;
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (isCompactCommand(e.currentTarget.value) ||
        isMcpCommand(e.currentTarget.value) ||
        isSessionFolderCommand(e.currentTarget.value))
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }
    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive((index) => (index + 1) % rankedSkills.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedSkills.length === 0) return;
        setSkillActive(
          (index) => (index - 1 + rankedSkills.length) % rankedSkills.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const skill = rankedSkills[skillActive];
        if (skill) pickSkill(skill);
        return;
      }
      if (e.key === "Enter") {
        const result = resolveEffectiveSuggestionAction(
          e.key,
          {
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            isComposing: e.nativeEvent.isComposing,
          },
          Boolean(rankedSkills[skillActive]),
          actionContext,
          { keepOpenOnUnmatched: !slash.query },
        );

        if (result.type === "ignore" || result.type === "newline") {
          return;
        }
        if (result.type === "keep_open") {
          e.preventDefault();
          return;
        }
        if (result.type === "pick") {
          const skill = rankedSkills[skillActive];
          if (skill) {
            e.preventDefault();
            pickSkill(skill);
            return;
          }
        }
        if (result.type === "action") {
          setSlash(null);
          e.preventDefault();
          executeComposerAction(result.action, e.currentTarget.value);
          return;
        }
        return;
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      isCompactCommand(e.currentTarget.value)
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    // Explicit early newline path for Shift+Enter (including Ctrl+Shift+Enter / Cmd+Shift+Enter)
    if (e.key === "Enter" && e.shiftKey) {
      return;
    }

    if (e.key === "Enter") {
      const action = resolveComposerKeyAction(
        e.key,
        {
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          isComposing: e.nativeEvent.isComposing,
        },
        actionContext,
      );

      if (action === "newline" || action === "ignore") {
        return;
      }

      e.preventDefault();
      executeComposerAction(action, e.currentTarget.value);
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (
      !draftWorkspace ||
      !onWorkspaceModeChange ||
      !enabled ||
      busy ||
      isImeComposition(e.nativeEvent) ||
      !isWorkspaceModeShortcut(e)
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next =
      (workspaceMode ?? "current") === "current" ? "worktree" : "current";
    if (next === "worktree" && !resolvedWorktreeBase) return;
    onWorkspaceModeChange(
      next,
      next === "worktree" ? resolvedWorktreeBase : undefined,
    );
    ref.current?.focus();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    setPasteError(null);
    const messageFiles = messageFilesFromClipboard(e.clipboardData);
    if (messageFiles) {
      e.preventDefault();
      const generation = pasteGenerationRef.current;
      const captured = captureDraft(e.currentTarget);
      const text = e.clipboardData.getData("text/plain");
      if (captured) insertRestoredText(captured, text);
      if (!attachmentsSupported) return;
      rememberAttachmentRead(
        attachmentsFromFiles(messageFiles).then((pasted) => {
          if (pasteGenerationRef.current !== generation) {
            pasted.forEach(revokeAttachment);
            return;
          }
          addAttachments(pasted);
        }),
      );
      return;
    }
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) {
      // A webview reports a paste as text only, so a screenshot or a file
      // copied in a file manager arrives with nothing to attach; both live on
      // the native clipboard.
      if (!attachmentsSupported) return;
      const text = e.clipboardData.getData("text/plain");
      // Prose and whitespace alike are the webview's to insert.
      if (text && !isFileReferenceText(text)) return;
      // A file URI becomes a chip, so it is kept out of the draft; with no text
      // at all the paste carried an image the webview cannot see.
      e.preventDefault();
      // Captured before the read crosses an IPC hop. Send and draft reset bump
      // the generation, so a finished read cannot attach onto a draft that is gone.
      const generation = pasteGenerationRef.current;
      const captured = isFileReferenceText(text)
        ? captureDraft(e.currentTarget)
        : null;
      rememberAttachmentRead(
        nativeClipboardAttachments(text)
          .then(({ files: pasted, warning }) => {
            if (pasteGenerationRef.current !== generation) {
              pasted.forEach(revokeAttachment);
              return;
            }
            if (pasted.length) {
              // WebKit can insert the URI after preventDefault. The chip
              // replaces it, so the draft must not keep that text.
              if (captured) dropPastedText(captured, text);
              addAttachments(pasted);
            } else if (captured) insertRestoredText(captured, text);
            if (warning) setPasteError(warning);
          })
          .catch((reason: unknown) => {
            if (pasteGenerationRef.current !== generation) return;
            setPasteError(
              reason instanceof Error ? reason.message : String(reason),
            );
          }),
      );
      return;
    }
    e.preventDefault();
    if (!attachmentsSupported) return;
    const generation = pasteGenerationRef.current;
    rememberAttachmentRead(
      attachmentsFromFiles(files).then((pasted) => {
        if (pasteGenerationRef.current !== generation) {
          pasted.forEach(revokeAttachment);
          return;
        }
        addAttachments(pasted);
      }),
    );
  };

  const attachFromPicker = (): void => {
    if (!attachmentsSupported) return;
    void pickAttachments().then((files) => {
      addAttachments(files);
      ref.current?.focus();
    });
  };

  return (
    <div
      data-composer
      className={`relative shrink-0 ${shell || compact ? "" : "p-1.5 pt-0"}`}
      onMouseDown={disabled ? undefined : onFocus}
      onKeyDownCapture={disabled ? undefined : onComposerKeyDown}
    >
      {question && onQuestionReply ? (
        <QuestionForm
          prompt={question}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      ) : form && onFormReply ? (
        <McpForm prompt={form} onReply={onFormReply} />
      ) : null}
      {children}
      {cloudLaunch?.panel}
      {usageLimit ? (
        <UsageLimitNotice
          limit={usageLimit}
          onResume={onUsageLimitResume}
          onResumeAtReset={onUsageLimitResumeAtReset}
          onDismiss={onUsageLimitDismiss}
        />
      ) : null}
      <MessageQueue
        messages={queuedMessages}
        status={queueStatus}
        holdReason={queueHoldReason}
        onDelete={onDeleteQueuedMessage}
        onEdit={onEditQueuedMessage}
        onEditingChange={onQueuedMessageEditingChange}
        onSteer={onSteerQueuedMessage}
        onResume={onResumeQueue}
      />
      <div className="relative overflow-visible">
        {mcpPickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <McpServerPicker
              connections={mcpConnections}
              harness={harness}
              claudeStatus={mcpStatus}
              loading={mcpLoading}
              error={mcpError}
              onPick={(server) => {
                const el = ref.current;
                if (!el) return;
                const previous = selectedMcp.find(
                  (item) =>
                    item.server.provider === server.provider &&
                    item.server.name === server.name &&
                    item.server.scope === server.scope &&
                    item.server.configPath === server.configPath,
                );
                const tag = previous ?? newMcpTag(server, selectedMcp);
                if (!previous) setSelectedMcp((current) => [...current, tag]);
                if (!previous || !taggedMcpServers(el.value, [tag]).length) {
                  const at = Math.min(
                    mcpInsertAt.current ?? el.selectionStart,
                    el.value.length,
                  );
                  const before = el.value.slice(0, at);
                  const after = el.value.slice(at);
                  const leading = before && !/\s$/.test(before) ? " " : "";
                  const trailing = after && /^\s/.test(after) ? "" : " ";
                  const insertion = `${leading}${tag.token}${trailing}`;
                  const next = before + insertion + after;
                  el.value = next;
                  resizeComposer(el);
                  el.setSelectionRange(
                    at + insertion.length,
                    at + insertion.length,
                  );
                  draftRevisionRef.current += 1;
                  setDraft(next);
                  syncHasValue(next, attachmentsRef.current);
                  setMention(null);
                }
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                el.focus();
              }}
              onManage={() => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                window.dispatchEvent(new Event("monocode:open-mcp-settings"));
              }}
              onDismiss={(reason) => {
                mcpInsertAt.current = null;
                setMcpPickerOpen(false);
                if (reason === "escape") ref.current?.focus();
              }}
            />
          </div>
        ) : sessionFolderOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SessionFolderPicker
              folders={sessionFolders}
              onPick={(target) => {
                setSessionFolderOpen(false);
                setSessionFolderSelected(true);
                onPlaceInFolder?.(target);
                const el = ref.current;
                if (!el) return;
                const cursor = el.selectionStart ?? el.value.length;
                if (/^\s*\/add-to-folder$/i.test(el.value)) {
                  el.value = `${el.value} `;
                  resizeComposer(el);
                  setDraft(el.value);
                  syncHasValue(el.value, attachmentsRef.current);
                  el.setSelectionRange(el.value.length, el.value.length);
                } else {
                  el.setSelectionRange(cursor, cursor);
                }
                requestAnimationFrame(() => el.focus());
              }}
              onDismiss={() => {
                setSessionFolderOpen(false);
                ref.current?.focus();
              }}
            />
          </div>
        ) : promptMenu.open ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SavedPromptMenu state={promptMenu} />
          </div>
        ) : skillPickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SkillPicker
              skills={rankedSkills}
              query={slash?.query ?? ""}
              active={skillActive}
              creating={creatingSkill}
              cwd={executionCwd}
              error={createError}
              busy={createBusy}
              onActive={setSkillActive}
              onPick={pickSkill}
              onStartCreate={() => {
                setCreatingSkill(true);
                setCreateError(null);
              }}
              onCancelCreate={() => {
                setCreatingSkill(false);
                setCreateError(null);
                const el = ref.current;
                if (el) syncTokensFromTextarea(el);
                el?.focus();
              }}
              onCreate={(name, scope) => {
                setCreateBusy(true);
                setCreateError(null);
                void createBlankSkill({ cwd: executionCwd, name, scope })
                  .then((path) => {
                    const el = ref.current;
                    const token = slashRef.current;
                    if (el && token) {
                      const rest = el.value.slice(token.end).replace(/^\s/, "");
                      const next = `${el.value.slice(0, token.start)}${rest}`;
                      el.value = next;
                      resizeComposer(el);
                      el.setSelectionRange(token.start, token.start);
                      setDraft(next);
                      syncHasValue(next, attachments);
                    }
                    setCreatingSkill(false);
                    setSlash(null);
                    setCreateError(null);
                    void skillCatalog
                      .refresh({ refresh: true })
                      .catch(() => undefined);
                    onOpenFile?.(path);
                    el?.focus();
                  })
                  .catch((err: unknown) => {
                    setCreateError(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setCreateBusy(false));
              }}
            />
          </div>
        ) : null}
        {mentionOpen && !pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={
                looksLikeProject(executionCwd) &&
                peekProjectFiles(executionCwd) == null
              }
              includeNotes={notesEnabled}
              onActive={setMentionActive}
              onPick={pickMention}
            />
          </div>
        ) : null}
        <div
          ref={boxRef}
          data-composer-box
          data-composer-editing={resendEdited ? "" : undefined}
          className={`relative z-10 border bg-content/3 backdrop-blur-sm ${
            resendEdited
              ? "edit-last-turn-composer rounded-lg"
              : "rounded-lg border-content/10 has-focus:border-content/20"
          } ${
            fileDrag
              ? "border-accent/60"
              : resendEdited
                ? ""
                : "border-content/10 has-focus:border-content/20"
          }`}
        >
          {fileDrag ? (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-accent/8 text-[12px] text-content/70">
              Drop files to attach
            </div>
          ) : null}
          {hideTopBar ? null : (
            <div className="flex min-w-0 items-center gap-2.5 overflow-hidden px-3 pt-2.5">
              {!remote && !hideProjectPicker ? (
                <CwdPicker
                  cwd={cwd}
                  recents={recents}
                  projectLogoPath={projectLogoPath}
                  enabled={enabled}
                  onCwdChange={onCwdChange}
                  onNewTerminal={worktreeRemoved ? undefined : onNewTerminal}
                  onClose={() => ref.current?.focus()}
                />
              ) : null}
              {hideBranchPicker ? null : draftWorkspace &&
                onWorkspaceModeChange &&
                onWorktreeBaseChange ? (
                <>
                  <WorkspacePicker
                    cwd={executionCwd}
                    mode={workspaceMode ?? "current"}
                    base={resolvedWorktreeBase}
                    enabled={enabled && !busy}
                    onModeChange={onWorkspaceModeChange}
                    onBaseChange={onWorktreeBaseChange}
                    onSelectWorktree={onWorktreeChange}
                    onOpenSettings={onManageWorktrees}
                    onClose={() => ref.current?.focus()}
                  />
                  {(workspaceMode ?? "current") === "current" ? (
                    <BranchPicker
                      cwd={executionCwd}
                      branch={branch}
                      enabled={enabled && !busy}
                      onChange={onBranchChange}
                      onClose={() => ref.current?.focus()}
                    />
                  ) : null}
                </>
              ) : worktreeRemoved && onWorktreeChange ? (
                <WorktreePicker
                  cwd={cwd}
                  executionCwd={executionCwd}
                  enabled={enabled && !busy}
                  onSelect={onWorktreeChange}
                  worktreeRemoved={worktreeRemoved}
                  onBranchChange={onBranchChange}
                  onManage={onManageWorktrees}
                  onClose={() => ref.current?.focus()}
                />
              ) : (
                <>
                  {onWorktreeChange ? (
                    <WorkspaceIdentity
                      worktree={pathKey(cwd) !== pathKey(executionCwd)}
                    />
                  ) : null}
                  <BranchPicker
                    cwd={executionCwd}
                    branch={branch}
                    enabled={enabled && !busy}
                    onChange={onBranchChange}
                    onClose={() => ref.current?.focus()}
                  />
                </>
              )}
              {workIn}
              <div className="ml-auto flex shrink-0 items-center">
                <ContextMeter
                  sessionId={sessionId}
                  usage={context}
                  turnUsage={turnUsage}
                  sessionUsage={sessionUsage}
                  harness={harness}
                  model={model}
                  cwd={executionCwd || cwd}
                  blocks={blocks}
                  busy={busy}
                  onCompact={
                    compactSupported && !worktreeRemoved
                      ? onCompactContext
                      : undefined
                  }
                  compactDisabled={busy}
                />
              </div>
            </div>
          )}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((file) => (
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  onRemove={() => removeAttachment(file.id)}
                />
              ))}
            </div>
          ) : null}

          {pasteError ? (
            <p role="alert" className="px-3 pt-2 text-xs text-red-400">
              {pasteError}
            </p>
          ) : null}

          {inboxCard ? (
            <InboxMiniCard card={inboxCard} onDismiss={onInboxCardDismiss} />
          ) : null}

          {noteCard ? (
            <NoteMiniCard card={noteCard} onDismiss={onNoteCardDismiss} />
          ) : null}

          {handoffCard ? (
            <HandoffMiniCard
              card={handoffCard}
              onDismiss={onHandoffCardDismiss}
            />
          ) : null}

          <div className="relative">
            <div
              ref={highlightRef}
              aria-hidden
              style={{ textIndent: modeIndent }}
              className={`composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap wrap-break-word px-3 text-sm leading-5.5 text-content font-sans ${
                shell ? "py-4" : "py-3"
              }`}
            >
              <ComposerHighlight
                text={draft}
                mode={leadingMode}
                names={skillNames}
                mentions={mentionIndex.labels}
                mcpTags={selectedMcp}
              />
            </div>
            <textarea
              ref={ref}
              data-composer-empty={navigationEmpty ? "true" : undefined}
              style={{ textIndent: modeIndent }}
              rows={1}
              spellCheck={autocorrect}
              autoCorrect={autocorrect ? "on" : "off"}
              defaultValue={mountDraft}
              placeholder={
                worktreeRemoved
                  ? "Select a branch or worktree to continue…"
                  : inboxCard
                    ? "Add a note, or send to start…"
                    : noteCard
                      ? "Add a message, or send…"
                      : handoffCard
                        ? "Add context, or send to continue…"
                        : (placeholder ??
                          (shell
                            ? "Ask, build, / for commands, @ for references... "
                            : "Ask, build, / for commands, @ for references... "))
              }
              aria-label={inputAriaLabel}
              disabled={disabled}
              className={`composer-field scrollbar-none relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-transparent px-3 text-sm leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
                shell ? "py-4" : "py-3"
              }`}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => syncHighlightScroll(e.currentTarget)}
              onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
              onKeyUp={(e) => syncTokensFromTextarea(e.currentTarget)}
              onSelect={(e) => syncTokensFromTextarea(e.currentTarget)}
              onInput={(e) => {
                const el = e.currentTarget;
                if (enterBtwFromPrefix(el)) return;
                resizeComposer(el);
                draftRevisionRef.current += 1;
                setDraft(el.value);
                setSelectedMcp((current) => {
                  const retained = current.filter(
                    (tag) => taggedMcpServers(el.value, [tag]).length > 0,
                  );
                  return retained.length === current.length
                    ? current
                    : retained;
                });
                setPasteError(null);
                if (
                  sessionFolderSelected &&
                  !consumeSessionFolderCommand(el.value).matched
                ) {
                  setSessionFolderSelected(false);
                }
                syncHasValue(el.value, attachments);
                syncTokensFromTextarea(el);
              }}
            />
          </div>

          <div className="flex items-center gap-1 px-2 pb-2">
            <div
              ref={plusRef}
              className={compact ? "hidden" : "relative shrink-0"}
            >
              <ToolButton
                label="Add files or choose a mode"
                active={plusOpen}
                onClick={() => setPlusOpen((open) => !open)}
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
              </ToolButton>
              {plusOpen ? (
                <Popover
                  anchor={plusRef}
                  side="top"
                  align="start"
                  width={250}
                  onDismiss={() => setPlusOpen(false)}
                  data-composer-plus
                  className="p-1.5"
                >
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-content/40">
                    Add to message
                  </p>
                  <button
                    type="button"
                    data-shared-hover-item
                    disabled={!attachmentsSupported}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPlusOpen(false);
                      attachFromPicker();
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FilePlus className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[13px]">Upload file</span>
                      <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                        {attachmentsSupported
                          ? "Attach files or images"
                          : remote && !remoteFeatures?.attachments
                            ? "Update this machine’s host to attach files"
                            : `${HARNESS_TITLE[harness]} does not support attachments`}
                      </span>
                    </span>
                  </button>
                  {!remote || remoteFeatures?.plan ? (
                    <button
                      type="button"
                      aria-pressed={planActive}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPlanSelected(!planActive);
                        if (planActive) clearLeadingMode(PLAN_COMMAND.name);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      data-shared-hover-item
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <AiIdea className="mt-0.5 size-4 shrink-0 text-yellow-300/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">Plan mode</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          Review a plan before building
                        </span>
                      </span>
                      {planActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  ) : null}
                  {!remote ? (
                    <button
                      type="button"
                      aria-pressed={operatorActive}
                      disabled={operatorThreadEnabled && (busy || externalTurnActive || !onOperatorDisable)}
                      title={operatorThreadEnabled
                        ? "Turn off Operator access for this chat" : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (operatorThreadEnabled) {
                          setOperatorSelected(false);
                          clearLeadingMode(OPERATOR_COMMAND.name);
                          onOperatorDisable?.();
                          return;
                        }
                        setOperatorSelected(!operatorActive);
                        if (operatorActive) {
                          clearLeadingMode(OPERATOR_COMMAND.name);
                        }
                        setPlanSelected(false);
                        setOrchestrationSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      data-shared-hover-item
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <CursorMagicSelection className="mt-0.5 size-4 shrink-0 text-sky-300/80" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">Operator</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          {operatorThreadEnabled
                            ? "Enabled for this chat"
                            : "Give this thread access to MonoCode"}
                        </span>
                      </span>
                      {operatorActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-sky-300/80" />
                      ) : null}
                    </button>
                  ) : null}
                  {!remote && !hideTopBar && (
                    <button
                      type="button"
                      aria-pressed={orchestrationActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOrchestrationSelected(!orchestrationActive);
                        if (orchestrationActive) {
                          clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                        }
                        setPlanSelected(false);
                        setOperatorSelected(false);
                        setDraftSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      data-shared-hover-item
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <Share className="mt-0.5 size-4 shrink-0 text-fuchsia-300/65" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px]">Orchestrator</span>
                          <span className="rounded-full bg-fuchsia-300/10 px-1.5 py-0.5 text-[9px] font-medium leading-none tracking-wide text-fuchsia-200/55 mb-px">
                            v1
                          </span>
                        </span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          Plan and coordinate agent work
                        </span>
                      </span>
                      {orchestrationActive && (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-fuchsia-300/80" />
                      )}
                    </button>
                  )}
                  {canSaveDraft && onSaveDraft ? (
                    <button
                      type="button"
                      aria-pressed={draftActive}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDraftSelected(!draftActive);
                        if (draftActive) clearLeadingMode(DRAFT_COMMAND.name);
                        setPlanSelected(false);
                        setOperatorSelected(false);
                        setOrchestrationSelected(false);
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      data-shared-hover-item
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-content hover:bg-content/10"
                    >
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-content/60" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">Draft</span>
                        <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-content/45">
                          Save this message without starting the agent
                        </span>
                      </span>
                      {draftActive ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  ) : null}
                </Popover>
              ) : null}
            </div>
            {(!compact || operatorThreadEnabled) && operatorActive ? (
              <ModeCommandPill
                name={OPERATOR_COMMAND.name}
                disabled={operatorThreadEnabled && (busy || externalTurnActive)}
                title={operatorThreadEnabled
                  ? (!onOperatorDisable ? "Operator access enabled for this chat; later messages keep access" : busy || externalTurnActive ? "Turn Operator off after the current turn finishes" : "Turn off Operator access for later messages")
                  : undefined}
                onClear={operatorThreadEnabled ? (onOperatorDisable ? () => {
                  setOperatorSelected(false);
                  clearLeadingMode(OPERATOR_COMMAND.name);
                  onOperatorDisable();
                } : undefined) : () => {
                    setOperatorSelected(false);
                    clearLeadingMode(OPERATOR_COMMAND.name);
                    ref.current?.focus();
                  }}
              />
            ) : null}
            {!compact && orchestrationActive ? (
              <ModeCommandPill
                name={ORCHESTRATOR_COMMAND.name}
                onClear={() => {
                  setOrchestrationSelected(false);
                  clearLeadingMode(ORCHESTRATOR_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {!compact && planActive ? (
              <ModeCommandPill
                name={PLAN_COMMAND.name}
                onClear={() => {
                  setPlanSelected(false);
                  clearLeadingMode(PLAN_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            {!compact && draftActive ? (
              <ModeCommandPill
                name={DRAFT_COMMAND.name}
                onClear={() => {
                  setDraftSelected(false);
                  clearLeadingMode(DRAFT_COMMAND.name);
                  ref.current?.focus();
                }}
              />
            ) : null}
            <div
              className="composer-toolbar flex min-w-0 flex-1 items-center"
              onWheel={(e) => {
                if (
                  e.target instanceof Element &&
                  e.target.closest(
                    "[data-model-picker], [data-model-control], [data-access-picker], [data-model-settings]",
                  )
                ) {
                  return;
                }
                const el = e.currentTarget;
                if (el.scrollWidth <= el.clientWidth) return;
                if (e.deltaX === 0 && e.deltaY !== 0) el.scrollLeft += e.deltaY;
              }}
            >
              <div className="flex shrink-0 items-center gap-1">
                {interactiveTerminalOpen && (liveInteractiveTerminal || interactiveDiagnosticsAvailable) && sessionId && harness === "claude" && !remoteSession ? (
                  <ClaudeInteractiveTerminal sessionId={sessionId} onClose={() => setInteractiveTerminalOpen(false)} />
                ) : null}
                <ModelPicker
                  harness={harness}
                  model={model}
                  values={modelSettings}
                  claudeExecution={harness === "claude" && !remoteSession && sessionId ? {
                    disabled: busy,
                    onOpenTerminal: liveInteractiveTerminal ? () => setInteractiveTerminalOpen(true) : undefined,
                    onOpenDiagnostics: interactiveDiagnosticsAvailable ? () => setInteractiveTerminalOpen(true) : undefined,
                  } : undefined}
                  providerAccount={remoteSession ? undefined : providerAccount}
                  allowedHarnesses={allowedModelHarnesses}
                  project={cwd}
                  hideSettings={controlsBeside}
                  hotkeys={hotkeys && enabled}
                  onChange={onModelChange}
                  onSettingsChange={(settings) =>
                    onModelSettingsChange?.(settings)
                  }
                  onClose={() => ref.current?.focus()}
                />
                {controlsBeside ? (
                  <ModelControlPills
                    harness={harness}
                    model={model}
                    values={modelSettings}
                    onSettingsChange={(settings) =>
                      onModelSettingsChange?.(settings)
                    }
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                {harness === "antigravity-cli" && !remoteSession ? (
                  <ModelSettings
                    harness={harness}
                    model={model}
                    values={modelSettings}
                    settingsOverride={cliAgents.settings}
                    disabled={cliAgentLocked || cliAgents.loading}
                    onChange={(settings) => onModelSettingsChange?.(settings)}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
                {cliAgents.error ? (
                  <span role="status" className="text-[11px] text-amber-400" title={cliAgents.error}>
                    Agents unavailable
                  </span>
                ) : null}
                {!compact && harness !== "fx" ? (
                  <AccessPicker
                    harness={harness}
                    value={runtimeMode}
                    busy={busy}
                    onChange={onRuntimeModeChange}
                    onClose={() => ref.current?.focus()}
                  />
                ) : null}
              </div>
            </div>

            {resendEdited ? (
              <button
                type="button"
                title="Stop editing last message"
                aria-label="Stop editing last message"
                onMouseDown={(event) => event.preventDefault()}
                onClick={exitEditMode}
                className="edit-last-turn-button flex h-6.5 shrink-0 items-center gap-1 rounded-md border border-current/20 px-2 text-[11px] font-medium transition-[background-color,color,border-color] hover:border-current/35 hover:bg-content/15 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <X className="size-3" strokeWidth={1.8} />
                <span>Cancel edit</span>
              </button>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
              <ComposerAction
                busy={busy}
                disabled={disabled || (cloudLaunch?.active === true && !cloudLaunch.canLaunch)}
                hasValue={hasValue && !worktreeRemoved}
                actionTooltip={actionTooltip}
                actionAriaLabel={actionAriaLabel}
                label={draftActive ? "Save draft" : "Send"}
                onSend={handleActionClick}
                allowBusySubmit={allowBusySubmit}
                onStop={() => onStop?.()}
              />
            </div>
          </div>
        </div>
        {runnerLive && runnerEnabled && !remote ? (
          <ComposerRunner
            boxRef={boxRef}
            cwd={cwd}
            busy={busy}
            enabled={enabled}
            onExited={() => setRunnerLive(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ComposerHighlight({
  text,
  mode,
  names,
  mentions,
  mcpTags,
}: {
  text: string;
  mode: ModeCommandToken | null;
  names: ReadonlySet<string>;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  const rest = mode ? text.slice(mode.end) : text;
  const parts = skillTextParts(rest, names);
  return (
    <>
      {mode ? <ModeCommandText text={text} mode={mode} /> : null}
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="text-skill">
            {part.text}
          </span>
        ) : (
          // Skill tokens always end on whitespace, so each remaining run still
          // starts on a boundary `@mention` matching can rely on.
          <MentionRuns
            key={index}
            text={part.text}
            mentions={mentions}
            mcpTags={mcpTags}
          />
        ),
      )}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}

function MentionRuns({
  text,
  mentions,
  mcpTags,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
  mcpTags: McpTag[];
}) {
  return (
    <>
      {mcpTagParts(text, mcpTags).map((part, index) =>
        part.tag ? (
          <span
            key={index}
            className="text-mention"
            data-mcp-tag={part.tag.token}
          >
            {part.text}
          </span>
        ) : (
          <FileMentionRuns key={index} text={part.text} mentions={mentions} />
        ),
      )}
    </>
  );
}

function FileMentionRuns({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyMap<string, ProjectFile>;
}) {
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="text-mention">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              {/* `indent-0`: a leading mode command indents the first line,
                  and this box would otherwise inherit that indent. */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 indent-0">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon
                    name={part.file.name}
                    isDir={Boolean(part.file.isDir)}
                    size={13}
                  />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export function ComposerAction({
  busy,
  disabled = false,
  hasValue,
  actionTooltip,
  actionAriaLabel,
  allowBusySubmit = true,
  label = "Send",
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled?: boolean;
  hasValue: boolean;
  actionTooltip?: string;
  actionAriaLabel?: string;
  allowBusySubmit?: boolean;
  label?: string;
  onSend: () => void;
  onStop: () => void;
}) {
  if (disabled) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled
        className="composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default"
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    );
  }
  if (busy) {
    return (
      <>
        {hasValue && allowBusySubmit ? (
          <button
            type="button"
            title={actionTooltip ?? label}
            aria-label={actionAriaLabel ?? label}
            onClick={onSend}
            className="composer-send primary-action grid size-6.5 place-items-center rounded-md"
          >
            <ArrowUp className="size-3.5" strokeWidth={2.25} />
          </button>
        ) : null}
        <button
          type="button"
          title="Stop"
          aria-label="Stop"
          onClick={onStop}
          className="grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} />
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!hasValue}
      onClick={onSend}
      className="composer-send primary-action grid size-6.5 place-items-center rounded-md disabled:cursor-default"
    >
      <ArrowUp className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}
