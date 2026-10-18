import { inspectHarnessContext } from "../../../integrations/harness/core/registry";
import { nativeSegments, type NativeContextBreakdown } from "../model/contextBreakdown";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  contextFreshness,
  contextPercent,
  contextRatio,
  contextTooltip,
  formatTokens,
  type ContextUsage,
} from "../model/contextUsage";
import { Popover } from "../../../shared/ui/Popover";
import { listSkills, readTextFile, type DiscoveredSkill } from "../../../platform/tauri/fs";
import { joinPath } from "../../../shared/lib/paths";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import { formatQuotaPercent, formatResetCountdown, rateLimitWindowTooltip, type ProviderRateLimits } from "../../providers/model/rateLimits";
import { fetchClaudeRateLimits, fetchCodexRateLimits } from "../../providers/model/rateLimitsFetch";
import { loadDetailedContext, loadRemainingQuota, subscribeDetailedContext, subscribeRemainingQuota } from "../../settings/model/settings";
import { type Block, type HarnessId } from "../model/session";
import { computeSystemAndToolsBreakdown, loadSystemAndToolsConfig, type LoadedSystemConfig } from "../model/systemBreakdown";
import { type ProcessedUsage } from "../model/tokenAccounting";
import { calculateUsageCost, computeContextBreakdown, estimateBlocksTokens, estimateTokens, formatCurrency, resolveModelPricing, type ContextBreakdownItem } from "../model/tokenCosting";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ring turns amber then red as the window fills. */
function ringClass(ratio: number): string {
  if (ratio >= 0.9) return "text-red-400";
  if (ratio >= 0.75) return "text-amber-400";
  return "text-content/45";
}

export type ContextMeterProps = {
  sessionId?: string;
  /** Context window usage. */
  usage?: ContextUsage;
  /** Processed usage for the active (or latest) turn. */
  turnUsage?: ProcessedUsage;
  /** Processed usage across the session. */
  sessionUsage?: ProcessedUsage;
  /** Whether the session is actively streaming or running a turn. */
  busy?: boolean;
  /** Active harness ID ("claude" | "codex" | ...). */
  harness?: HarnessId;
  /** Model name or identifier. */
  model?: string;
  /** Workspace cwd. */
  cwd?: string;
  /** Session transcript blocks. */
  blocks?: Block[];
  /** Optional handler to trigger context compaction. */
  onCompact?: () => boolean | void;
  /** Whether compaction is currently disabled. */
  compactDisabled?: boolean;
  /** Known empty conversation, without a provider context reading. */
  empty?: boolean;
};

function UsageBreakdownRows({
  usage,
}: {
  usage: ProcessedUsage;
}): React.JSX.Element {
  return (
    <div className="space-y-0.5 text-[11px] text-content/70">
      <div className="flex justify-between">
        <span className="text-content/50">Input</span>
        <span className="tabular-nums">{usage.input.toLocaleString()}</span>
      </div>
      {usage.cachedInput !== undefined && usage.cachedInput > 0 ? (
        <div className="flex justify-between pl-2">
          <span className="text-content/40">Cached input</span>
          <span className="tabular-nums">
            {usage.cachedInput.toLocaleString()}
          </span>
        </div>
      ) : null}
      {usage.cacheWrite !== undefined && usage.cacheWrite > 0 ? (
        <div className="flex justify-between pl-2">
          <span className="text-content/40">Cache write</span>
          <span className="tabular-nums">
            {usage.cacheWrite.toLocaleString()}
          </span>
        </div>
      ) : null}
      <div className="flex justify-between">
        <span className="text-content/50">Output</span>
        <span className="tabular-nums">{usage.output.toLocaleString()}</span>
      </div>
      {usage.reasoning !== undefined && usage.reasoning > 0 ? (
        <div className="flex justify-between pl-2">
          <span className="text-content/40">Reasoning</span>
          <span className="tabular-nums">
            {usage.reasoning.toLocaleString()}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export type CompactContextSummaryProps = {
  headline: string;
  detail: string;
};

export function CompactContextSummary({
  headline,
  detail,
}: CompactContextSummaryProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 text-left whitespace-nowrap">
      <span className="font-medium text-content">{headline}</span>
      <span className="tabular-nums text-content/60 text-[11px]">{detail}</span>
    </div>
  );
}

export const COMPACT_CONTEXT_METER_POPOVER_CLASS: string =
  "w-max max-w-[calc(100vw-2rem)] px-3 py-2 text-xs text-content select-none shadow-xl border border-content/10 bg-surface rounded-lg";

export const DETAILED_CONTEXT_METER_POPOVER_CLASS: string =
  "w-[320px] max-w-[calc(100vw-2rem)] max-h-[82vh] overflow-y-auto p-3.5 text-xs text-content select-none shadow-xl border border-content/10 bg-surface rounded-xl";

/**
 * Circular gauge for how full the model context window is.
 *
 * Renders nothing until the harness reports both halves — Cursor's ACP stream
 * carries no usage at all, and a ring guessing at a number is worse than no
 * ring. A conversation with nothing in it yet is the exception: its context
 * is known to be empty, so `empty` shows a bare ring.
 */
export function ContextMeter({
  sessionId,
  usage,
  turnUsage,
  sessionUsage,
  busy,
  harness,
  model,
  cwd,
  blocks,
  onCompact,
  compactDisabled = false,
  empty = false,
}: ContextMeterProps): React.JSX.Element | null {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const [builtinToolsExpanded, setBuiltinToolsExpanded] = useState(false);
  const [mcpServersExpanded, setMcpServersExpanded] = useState(true);
  const [pluginsExpanded, setPluginsExpanded] = useState(true);
  const [memoryFilesExpanded, setMemoryFilesExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [turnExpanded, setTurnExpanded] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);

  const [systemConfig, setSystemConfig] = useState<LoadedSystemConfig | null>(null);
  const [memoryFiles, setMemoryFiles] = useState<ContextBreakdownItem[]>([]);
  const [skills, setSkills] = useState<ContextBreakdownItem[]>([]);
  const [rateLimits, setRateLimits] = useState<ProviderRateLimits | null>(null);

  const detailedContext = useSyncExternalStore(
    subscribeDetailedContext,
    loadDetailedContext,
    () => false,
  );
  const remainingQuota = useSyncExternalStore(
    subscribeRemainingQuota,
    loadRemainingQuota,
    () => false,
  );

  const root = useRef<HTMLButtonElement>(null);
  const ratio = usage && usage.used > 0 ? contextRatio(usage) : null;
  const percent = usage && usage.used > 0 ? contextPercent(usage) : null;

  const hasData =
    usage != null ||
    turnUsage != null ||
    sessionUsage != null ||
    (blocks && blocks.length > 0);

  const isOpen = hovered || pinned;
  const freshness = contextFreshness(usage, blocks, busy);
  const requestToken = useRef(0);
  const [nativeReading, setNativeReading] = useState<{
    breakdown: NativeContextBreakdown;
    forUsage: ContextUsage | undefined;
    forSessionId: string;
  } | null>(null);
  const [inspectionState, setInspectionState] = useState<
    "idle" | "checking" | "unavailable"
  >("idle");
  useEffect(() => {
    const token = ++requestToken.current;
    let active = true;
    setNativeReading(null);
    setInspectionState("idle");
    if (
      !isOpen ||
      !detailedContext ||
      harness !== "claude" ||
      !sessionId ||
      busy ||
      freshness !== "current"
    )
      return;
    const controller = new AbortController();
    setInspectionState("checking");
    void inspectHarnessContext("claude", sessionId, controller.signal)
      .then((breakdown) => {
        if (!active || token !== requestToken.current) return;
        setNativeReading(
          breakdown
            ? { breakdown, forUsage: usage, forSessionId: sessionId }
            : null,
        );
        setInspectionState(breakdown ? "idle" : "unavailable");
      })
      .catch(() => {
        if (active && token === requestToken.current)
          setInspectionState("unavailable");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isOpen, detailedContext, sessionId, harness, usage, busy, freshness]);
  const native =
    !busy &&
    freshness === "current" &&
    nativeReading?.forUsage === usage &&
    nativeReading?.forSessionId === sessionId
      ? nativeReading?.breakdown
      : undefined;

  // Inspect system prompt, tools, memory files and skills for Claude and Codex
  useEffect(() => {
    let active = true;
    if (!isOpen || !detailedContext) return;

    async function inspect() {
      // 1. Load system & tools configuration (MCP servers, plugins, global rules)
      try {
        const sysCfg = await loadSystemAndToolsConfig({ harness, cwd });
        if (active) {
          setSystemConfig(sysCfg);
        }
      } catch {
        // Ignore system config load errors
      }

      if (!cwd) return;

      const candidates =
        harness === "codex"
          ? ["AGENTS.md", ".codex/instructions.md"]
          : ["CLAUDE.md", ".claude/CLAUDE.md", ".claude/MEMORY.md"];

      const foundFiles: ContextBreakdownItem[] = [];
      for (const rel of candidates) {
        try {
          const full = joinPath(cwd!, rel);
          const content = await readTextFile(full);
          if (active && content) {
            foundFiles.push({
              name: rel,
              path: full,
              tokens: estimateTokens(content),
            });
          }
        } catch {
          // File does not exist
        }
      }

      let foundSkills: ContextBreakdownItem[] = [];
      try {
        const discovered = await listSkills(cwd!);
        if (active && Array.isArray(discovered)) {
          foundSkills = (discovered as DiscoveredSkill[])
            .filter((s) =>
              harness
                ? s.source === harness ||
                  s.source === "agents" ||
                  s.source === "monocode"
                : true,
            )
            .map((s) => ({
              name: s.name,
              tokens: estimateTokens(`${s.name} ${s.description}`),
            }));
        }
      } catch {
        // Ignore skill discovery errors
      }

      if (active) {
        setMemoryFiles(foundFiles);
        setSkills(foundSkills);
      }
    }

    void inspect();
    return () => {
      active = false;
    };
  }, [isOpen, detailedContext, cwd, harness]);

  // Fetch plan rate limits (5-hour and weekly) when popover is open
  useEffect(() => {
    let active = true;
    if (!isOpen || !detailedContext || (harness !== "claude" && harness !== "codex")) return;

    async function fetchLimits() {
      try {
        const limits =
          harness === "codex"
            ? await fetchCodexRateLimits()
            : await fetchClaudeRateLimits();
        if (active && limits && limits.status === "ok") {
          setRateLimits(limits);
        }
      } catch {
        // Ignore limit fetch failures
      }
    }

    void fetchLimits();
    return () => {
      active = false;
    };
  }, [isOpen, detailedContext, harness]);

  const messagesTokens = blocks ? estimateBlocksTokens(blocks) : 0;
  const estimated = computeContextBreakdown({
    usedTokens: usage?.used,
    globalRules: systemConfig?.globalRules,
    windowTokens: usage?.window,
    memoryFiles,
    skills,
    messagesTokens,
    harness,
  });

  const breakdown =
    estimated.state === "known"
      ? estimated
      : {
          usedTokens: 0,
          windowTokens: 0,
          percentUsed: 0,
          segments: [],
          systemAndTools: 0,
          memoryFiles: [],
          memoryFilesTotal: 0,
          skills: [],
          skillsTotal: 0,
        };
  const segments = native ? nativeSegments(native) : breakdown.segments;
  const displayedMemory = native
    ? native.memoryFiles.map((file) => ({
        name: file.path,
        path: file.path,
        tokens: file.tokens,
      }))
    : breakdown.memoryFiles;
  const contextValue = (tokens: number): string =>
    `${native ? "" : "~"}${formatTokens(tokens)}`;

  const systemBreakdown = useMemo(() => {
    return computeSystemAndToolsBreakdown({
      totalTokens: breakdown.systemAndTools,
      harness,
      globalRules: systemConfig?.globalRules,
      mcpServers: systemConfig?.mcpServers,
      plugins: systemConfig?.plugins,
    });
  }, [breakdown.systemAndTools, harness, systemConfig]);

  const pricing = resolveModelPricing(model, harness);
  const turnCost = calculateUsageCost(turnUsage, pricing);
  const sessionCost = calculateUsageCost(sessionUsage, pricing);

  const handlePointerEnter = useCallback((): void => {
    setHovered(true);
  }, []);

  const handlePointerLeave = useCallback((): void => {
    setHovered(false);
  }, []);

  const handleClick = useCallback((): void => {
    setPinned((p) => !p);
  }, []);

  const handleDismiss = useCallback((): void => {
    setPinned(false);
    setHovered(false);
  }, []);

  const title =
    usage?.window != null && usage.used > 0
      ? `Context window: ${usage.used.toLocaleString()} / ${usage.window.toLocaleString()} tokens (${percent}%)`
      : "Context window & token usage";

  const compactSummary =
    freshness === "unknown"
      ? {
          headline: "Current context",
          detail: "No context reading yet. It appears after the first reply.",
        }
      : usage
        ? contextTooltip(usage)
        : {
            headline: "Current context",
            detail: "No context reading yet. It appears after the first reply.",
          };

  if (empty && !hasData) return <span title="No context used yet" className="grid shrink-0"><MeterRing ratio={0} label="No context used yet" /></span>;
  if (!hasData && !sessionId) return null;

  return (
    <div
      className="relative inline-flex items-center"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <button
        ref={root}
        type="button"
        onClick={handleClick}
        aria-label={title}
        aria-expanded={isOpen}
        className="flex size-6 items-center justify-center rounded-md text-content/50 transition-colors hover:bg-content/5 hover:text-content"
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className={`-rotate-90 ${busy ? "animate-pulse" : ""}`}
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            className="text-content/15"
          />
          {ratio !== null && ratio > 0 ? (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={STROKE}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
              strokeLinecap="round"
              className={ringClass(ratio)}
            />
          ) : null}
        </svg>
      </button>

      {isOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          gap={6}
          onDismiss={handleDismiss}
          dismissOnEscape
          className={
            detailedContext
              ? DETAILED_CONTEXT_METER_POPOVER_CLASS
              : COMPACT_CONTEXT_METER_POPOVER_CLASS
          }
        >
          {detailedContext ? (
            <div className="space-y-3">
            {/* Header */}
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-content">Current context</span>
                <div className="flex items-center gap-2">
                  {onCompact ? (
                    <button
                      type="button"
                      disabled={compactDisabled}
                      onClick={() => {
                        onCompact();
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-content/10 text-content/70 hover:bg-content/15 hover:text-content disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Compact
                    </button>
                  ) : null}
                  <span className="tabular-nums text-content/70 text-[11px]">
                    {estimated.state === "known" ? `${formatTokens(native?.totalTokens ?? breakdown.usedTokens)} / ${formatTokens(native?.windowTokens ?? breakdown.windowTokens)} (${native ? Math.round(native.totalTokens / Math.max(1, native.windowTokens) * 100) : breakdown.percentUsed}%)` : null}
                  </span>
                </div>
              </div>

              <ContextReadingStatus freshness={freshness} native={Boolean(native)} inspectionState={inspectionState} />
              {/* Horizontal Stacked Bar */}
              {estimated.state === "known" ? <div
                className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-content/10"
                aria-hidden
              >
                {segments.map((seg) => {
                  if (seg.percent <= 0) return null;
                  return (
                    <div
                      key={seg.id}
                      className={`h-full ${seg.colorClass}`}
                      style={{ width: `${Math.max(0.5, seg.percent)}%` }}
                      title={`${seg.label}: ${seg.tokens.toLocaleString()} tokens (${seg.percent.toFixed(1)}%)`}
                    />
                  );
                })}
              </div> : null}
              {native ? <p className="text-[10px] text-content/60">Some of these numbers are Claude Code's own estimates.</p> : null}
            </div>

            {/* Context Segments Legend / Overview */}
            <div className="space-y-1 text-[11px]">
              {segments.map((seg) => {
                if (seg.tokens <= 0 && seg.id !== "free") return null;
                return (
                  <div
                    key={seg.id}
                    className="flex items-center justify-between text-content/70"
                    title={seg.id === "unclassified" ? "Tokens the provider counted that MonoCode can't attribute, usually older tool output and replies." : undefined}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`size-2 shrink-0 rounded-full ${seg.colorClass}`}
                      />
                      <span className="truncate">
                        {seg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 tabular-nums shrink-0">
                      <span>{seg.source === "estimated" ? "~" : ""}{formatTokens(seg.tokens)} <span className="text-content/40 text-[10px]">{seg.source === "estimated" ? "Estimated" : "Reported"}</span></span>
                      <span className="text-content/40 w-9 text-right">
                        {seg.percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Collapsible System & Tools Breakdown */}
            {!native && breakdown.systemAndTools > 0 && detailedContext ? (
              <div className="border-t border-content/10 pt-2 space-y-1">
                <button
                  type="button"
                  onClick={() => setSystemExpanded((e) => !e)}
                  className="flex w-full items-center justify-between text-left text-[11px] text-content/80 hover:text-content"
                >
                  <span className="flex items-center gap-1">
                    {systemExpanded ? (
                      <ChevronDown
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <ChevronRight
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    )}
                    <span>System & tools</span>
                  </span>
                  <span className="tabular-nums text-content/50">
                    ~{formatTokens(systemBreakdown.totalTokens)}
                  </span>
                </button>
                {systemExpanded ? (
                  <div className="space-y-1.5 pl-4 text-[11px] text-content/70">
                    {/* Base system instructions */}
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-content/60">
                        Base prompt ({harness === "codex" ? "Codex" : "Claude"})
                      </span>
                      <span className="tabular-nums shrink-0">
                        ~{formatTokens(systemBreakdown.baseInstructions)}
                      </span>
                    </div>

                    {/* Global rules (e.g. ~/.claude/CLAUDE.md or ~/.codex/AGENTS.md) */}
                    {systemBreakdown.globalRules.length > 0 ? (
                      <div className="space-y-0.5">
                        {systemBreakdown.globalRules.map((rule) => (
                          <div
                            key={rule.name}
                            className="flex items-center justify-between gap-1"
                            title={rule.path}
                          >
                            <span className="text-content/60 truncate">
                              {rule.name}
                            </span>
                            <span className="tabular-nums shrink-0">
                              ~{formatTokens(rule.tokens)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* Environment / workspace context */}
                    {systemBreakdown.environment > 0 ? (
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-content/60">
                          Environment & git context
                        </span>
                        <span className="tabular-nums shrink-0">
                          ~{formatTokens(systemBreakdown.environment)}
                        </span>
                      </div>
                    ) : null}

                    {/* Built-in tools */}
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setBuiltinToolsExpanded((e) => !e)}
                        className="flex w-full items-center justify-between text-left text-content/70 hover:text-content"
                      >
                        <span className="flex items-center gap-1">
                          {builtinToolsExpanded ? (
                            <ChevronDown
                              className="size-2.5 shrink-0"
                              strokeWidth={1.75}
                            />
                          ) : (
                            <ChevronRight
                              className="size-2.5 shrink-0"
                              strokeWidth={1.75}
                            />
                          )}
                          <span>
                            Built-in tools ({systemBreakdown.builtinTools.length})
                          </span>
                        </span>
                        <span className="tabular-nums text-content/50 shrink-0">
                          ~{formatTokens(systemBreakdown.builtinToolsTotal)}
                        </span>
                      </button>
                      {builtinToolsExpanded ? (
                        <div className="space-y-0.5 pl-3 text-[10.5px] text-content/60">
                          {systemBreakdown.builtinTools.map((t) => (
                            <div
                              key={t.name}
                              className="flex items-center justify-between gap-1"
                              title={t.description}
                            >
                              <span className="truncate">{t.name}</span>
                              <span className="tabular-nums shrink-0">
                                ~{formatTokens(t.tokens)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* MCP Servers */}
                    {systemBreakdown.mcpServers.length > 0 ? (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setMcpServersExpanded((e) => !e)}
                          className="flex w-full items-center justify-between text-left text-content/70 hover:text-content"
                        >
                          <span className="flex items-center gap-1">
                            {mcpServersExpanded ? (
                              <ChevronDown
                                className="size-2.5 shrink-0"
                                strokeWidth={1.75}
                              />
                            ) : (
                              <ChevronRight
                                className="size-2.5 shrink-0"
                                strokeWidth={1.75}
                              />
                            )}
                            <span>
                              MCP Servers ({systemBreakdown.mcpServers.length})
                            </span>
                          </span>
                          <span className="tabular-nums text-content/50 shrink-0">
                            size not reported
                          </span>
                        </button>
                        {mcpServersExpanded ? (
                          <div className="space-y-0.5 pl-3 text-[10.5px] text-content/60">
                            {systemBreakdown.mcpServers.map((s) => (
                              <div
                                key={s.name}
                                className="flex items-center justify-between gap-1"
                                title={s.command || s.url}
                              >
                                <span className="truncate">{s.name}{" · "}</span>
                                <span className="tabular-nums shrink-0">
                                  size not reported
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Plugins (Codex) */}
                    {systemBreakdown.plugins.length > 0 ? (
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setPluginsExpanded((e) => !e)}
                          className="flex w-full items-center justify-between text-left text-content/70 hover:text-content"
                        >
                          <span className="flex items-center gap-1">
                            {pluginsExpanded ? (
                              <ChevronDown
                                className="size-2.5 shrink-0"
                                strokeWidth={1.75}
                              />
                            ) : (
                              <ChevronRight
                                className="size-2.5 shrink-0"
                                strokeWidth={1.75}
                              />
                            )}
                            <span>
                              Plugins ({systemBreakdown.plugins.length})
                            </span>
                          </span>
                          <span className="tabular-nums text-content/50 shrink-0">
                            size not reported
                          </span>
                        </button>
                        {pluginsExpanded ? (
                          <div className="space-y-0.5 pl-3 text-[10.5px] text-content/60">
                            {systemBreakdown.plugins.map((p) => (
                              <div
                                key={p.name}
                                className="flex items-center justify-between gap-1"
                              >
                                <span className="truncate">{p.name}{" · "}</span>
                                <span className="tabular-nums shrink-0">
                                  size not reported
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {native ? <NativeContextDetails breakdown={native} /> : null}

            {/* Collapsible Memory Files */}
            {displayedMemory.length > 0 ? (
              <div className="border-t border-content/10 pt-2 space-y-1">
                <button
                  type="button"
                  onClick={() => setMemoryFilesExpanded((e) => !e)}
                  className="flex w-full items-center justify-between text-left text-[11px] text-content/80 hover:text-content"
                >
                  <span className="flex items-center gap-1">
                    {memoryFilesExpanded ? (
                      <ChevronDown
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <ChevronRight
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    )}
                    <span>Memory files</span>
                  </span>
                  <span className="tabular-nums text-content/50">
                    {contextValue(native ? displayedMemory.reduce((sum, file) => sum + file.tokens, 0) : breakdown.memoryFilesTotal)} (
                    {displayedMemory.length})
                  </span>
                </button>
                {memoryFilesExpanded ? (
                  <div className="space-y-1 pl-4 text-[11px] text-content/60">
                    {displayedMemory.map((file) => (
                      <div
                        key={file.name}
                        className="flex items-center justify-between gap-1"
                        title={file.path}
                      >
                        <span className="truncate">{file.name}</span>
                        <span className="tabular-nums shrink-0">
                          {contextValue(file.tokens)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Collapsible Skills */}
            {!native && breakdown.skills.length > 0 ? (
              <div className="border-t border-content/10 pt-2 space-y-1">
                <button
                  type="button"
                  onClick={() => setSkillsExpanded((e) => !e)}
                  className="flex w-full items-center justify-between text-left text-[11px] text-content/80 hover:text-content"
                >
                  <span className="flex items-center gap-1">
                    {skillsExpanded ? (
                      <ChevronDown
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <ChevronRight
                        className="size-3 shrink-0"
                        strokeWidth={1.75}
                      />
                    )}
                    <span>Skills</span>
                  </span>
                  <span className="tabular-nums text-content/50">
                    {contextValue(breakdown.skillsTotal)} (
                    {breakdown.skills.length})
                  </span>
                </button>
                {skillsExpanded ? (
                  <div className="space-y-1 pl-4 text-[11px] text-content/60">
                    {breakdown.skills.map((skill) => (
                      <div
                        key={skill.name}
                        className="flex items-center justify-between gap-1"
                      >
                        <span className="truncate">{skill.name}</span>
                        <span className="tabular-nums shrink-0">
                          {contextValue(skill.tokens)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Plan Quota Limits (if known) */}
            {rateLimits &&
            (rateLimits.session != null || rateLimits.weekly != null) ? (
              <div className="border-t border-content/10 pt-2 space-y-1.5 text-[11px]">
                <div className="font-medium text-content/90">
                  Plan quota
                </div>
                {rateLimits.session ? (
                  <div
                    className="flex items-center justify-between text-content/70"
                    title={rateLimitWindowTooltip(
                      rateLimits.session,
                      undefined,
                      remainingQuota,
                    )}
                  >
                    <span>5-hour quota</span>
                    <div className="flex items-center gap-2 tabular-nums">
                      {rateLimits.session.resetsAt ? (
                        <span className="text-content/50 text-[10px]">
                          {formatResetCountdown(
                            rateLimits.session.resetsAt - Date.now(),
                          )}
                        </span>
                      ) : null}
                      <span className="font-medium text-content/90">
                        {formatQuotaPercent(
                          rateLimits.session.usedPercent,
                          remainingQuota,
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}
                {rateLimits.weekly ? (
                  <div
                    className="flex items-center justify-between text-content/70"
                    title={rateLimitWindowTooltip(
                      rateLimits.weekly,
                      undefined,
                      remainingQuota,
                    )}
                  >
                    <span>Weekly quota</span>
                    <div className="flex items-center gap-2 tabular-nums">
                      {rateLimits.weekly.resetsAt ? (
                        <span className="text-content/50 text-[10px]">
                          {formatResetCountdown(
                            rateLimits.weekly.resetsAt - Date.now(),
                          )}
                        </span>
                      ) : null}
                      <span className="font-medium text-content/90">
                        {formatQuotaPercent(
                          rateLimits.weekly.usedPercent,
                          remainingQuota,
                        )}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Costing and Token Processing */}
            <div className="border-t border-content/10 pt-2 space-y-2">
              <div className="flex items-baseline justify-between text-content">
                <span className="font-medium text-[11px]">
                  Costing & Processing
                </span>
                {sessionCost.totalCost > 0 ? (
                  <span className="text-[11px] font-semibold text-emerald-400 tabular-nums">
                    {formatCurrency(sessionCost.totalCost)} session
                  </span>
                ) : null}
              </div>

              {/* Turn cost & breakdown */}
              {turnUsage != null ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setTurnExpanded((e) => !e)}
                    className="flex w-full items-center justify-between text-left text-[11px] text-content/80 hover:text-content"
                  >
                    <span className="flex items-center gap-1">
                      {turnExpanded ? (
                        <ChevronDown
                          className="size-3 shrink-0"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <ChevronRight
                          className="size-3 shrink-0"
                          strokeWidth={1.75}
                        />
                      )}
                      <span>Processed this turn</span>
                    </span>
                    <div className="flex items-center gap-1.5 tabular-nums">
                      {turnCost.cacheSavings > 0 ? (
                        <span className="text-[10px] text-emerald-400">
                          (Saved {formatCurrency(turnCost.cacheSavings)})
                        </span>
                      ) : null}
                      <span>{formatTokens(turnUsage.total)} tokens · {formatCurrency(turnCost.totalCost)}</span>
                    </div>
                  </button>
                  {turnExpanded ? (
                    <div className="pl-4">
                      <UsageBreakdownRows usage={turnUsage} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Session breakdown */}
              {sessionUsage != null ? (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSessionExpanded((e) => !e)}
                    className="flex w-full items-center justify-between text-left text-[11px] text-content/80 hover:text-content"
                  >
                    <span className="flex items-center gap-1">
                      {sessionExpanded ? (
                        <ChevronDown
                          className="size-3 shrink-0"
                          strokeWidth={1.75}
                        />
                      ) : (
                        <ChevronRight
                          className="size-3 shrink-0"
                          strokeWidth={1.75}
                        />
                      )}
                      <span>Processed this chat</span>
                    </span>
                    <span className="tabular-nums text-content/50">
                      {sessionUsage.total.toLocaleString()}
                    </span>
                  </button>
                  {sessionExpanded ? (
                    <div className="pl-4">
                      <UsageBreakdownRows usage={sessionUsage} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Footer note */}
            <div className="border-t border-content/10 pt-1.5 flex items-center justify-between text-[10px] text-content/40">
              <span>
                {harness === "codex"
                  ? "Codex telemetry"
                  : harness === "claude"
                    ? "Claude Code telemetry"
                    : "Harness telemetry"}
              </span>
              <span>
                ${pricing.inputPer1M.toFixed(2)}/M in · $
                {pricing.outputPer1M.toFixed(2)}/M out
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <CompactContextSummary headline={compactSummary.headline} detail={compactSummary.detail} />
            {freshness !== "unknown" ? <ContextReadingStatus freshness={freshness} native={false} inspectionState="idle" /> : null}
          </div>
        )}
        </Popover>
      ) : null}
    </div>
  );
}

export function ContextReadingStatus({
  freshness,
  native,
  inspectionState,
}: {
  freshness: ReturnType<typeof contextFreshness>;
  native: boolean;
  inspectionState: "idle" | "checking" | "unavailable";
}): React.JSX.Element {
  return (
    <div className="mt-1 space-y-1 text-[10px] text-content/60">
      {freshness === "unknown" ? (
        <p>No context reading yet. It appears after the first reply.</p>
      ) : (
        <>
          <span className="rounded-full bg-content/10 px-1.5 text-[10px]">
            {native ? "Reported by Claude Code" : "Estimated"}
          </span>
          {freshness === "updating" ? (
            <span className="rounded-full bg-content/10 px-1.5 text-[10px]">
              Updating…
            </span>
          ) : null}
          {freshness === "stale" ? (
            <span className="rounded-full bg-content/10 px-1.5 text-[10px]">
              Out of date — updates after the next reply
            </span>
          ) : null}
        </>
      )}
      {inspectionState === "checking" ? (
        <p>Checking with Claude Code…</p>
      ) : inspectionState === "unavailable" ? (
        <p>Claude Code's breakdown wasn't available.</p>
      ) : null}
    </div>
  );
}

export function NativeContextDetails({
  breakdown,
}: {
  breakdown: NativeContextBreakdown;
}): React.JSX.Element {
  const messageRows = breakdown.messages
    ? ([
        ["Tool calls", breakdown.messages.toolCalls],
        ["Tool results", breakdown.messages.toolResults],
        ["Attachments", breakdown.messages.attachments],
        ["Assistant", breakdown.messages.assistant],
        ["User", breakdown.messages.user],
        ["Unattributed", breakdown.messages.unattributed],
      ] satisfies [string, number][])
    : [];
  return (
    <div className="space-y-2 text-[11px] text-content/70">
      {breakdown.categories
        .filter((category) => category.kind === "deferred")
        .map((category, index) => (
          <div key={index}>
            Deferred (not in context): {category.name} ·{" "}
            {formatTokens(category.tokens)}
          </div>
        ))}
      {breakdown.mcpServers.length > 0 ? (
        <details className="border-t border-content/10 pt-2">
          <summary className="cursor-pointer">MCP servers</summary>
          {breakdown.mcpServers.map((server) => (
            <div key={server.serverName} className="flex justify-between gap-2">
              <span>
                {server.serverName}
                {server.deferredTools > 0
                  ? ` · ${server.deferredTools} tools deferred`
                  : ""}
              </span>
              <span>{formatTokens(server.tokens)}</span>
            </div>
          ))}
        </details>
      ) : null}
      {breakdown.skills ? (
        <div>
          Skills ({breakdown.skills.count}) ·{" "}
          {formatTokens(breakdown.skills.tokens)}
        </div>
      ) : null}
      {breakdown.messages ? (
        <details className="border-t border-content/10 pt-2">
          <summary className="cursor-pointer">Messages</summary>
          {messageRows
            .filter(([, tokens]) => tokens > 0)
            .map(([label, tokens]) => (
              <div key={label} className="flex justify-between">
                <span>{label}</span>
                <span>{formatTokens(tokens)}</span>
              </div>
            ))}
        </details>
      ) : null}
    </div>
  );
}

function MeterRing({ ratio, label }: { ratio: number; label?: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={ringClass(ratio)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        className="opacity-25"
      />
      {/* A round cap would leave a dot on an empty ring. */}
      {ratio > 0 ? (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      ) : null}
    </svg>
  );
}
