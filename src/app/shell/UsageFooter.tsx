import { ProcessMonitor } from "./ProcessMonitor";
import type { Session } from "../../features/sessions/model/session";
import { antigravityCliLimitsForModel } from "../../features/providers/model/antigravityCliUsage";
import { runtimeProviderBinaryPath } from "../../features/providers/model/providerBinaryPaths";
import { getCustomBinary } from "../../integrations/harness/core/customBinary";
import { RefreshCw, Terminal } from "../../shared/ui/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { Popover, type PopoverDismissReason } from "../../shared/ui/Popover";
import { consumeCodexRateLimitResetCredit } from "../../features/providers/model/rateLimitsFetch";
import {
  errorRateLimits,
  unavailableRateLimits,
  type RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import {
  getAllRateLimits,
  getCachedRateLimits,
  loadRateLimits,
  setCachedRateLimits,
  subscribeRateLimits,
  useCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import {
  useRateLimitsPolling,
  type RateLimitPollingTarget,
} from "../../features/providers/model/useRateLimitsPolling";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  type HarnessId,
} from "../../features/sessions/model/session";
import {
  loginHarness,
  supportsHarnessLogin,
} from "../../integrations/harness/core/auth";
import {
  runningTerminalChipLabel,
  type RunningTerminal,
} from "../../features/terminal/model/terminalTab";
import { MOD } from "../../platform/tauri/platform";
import { UsageProviderChip } from "./UsageProviderChip";
import { AccountUsageStrip } from "./AccountUsageStrip";
import {
  buildAccountChipEntries,
  loadAccountsInSequence,
} from "./allAccountsUsage";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../../integrations/harness/core/availabilityState";
import {
  getPickerVisibilitySnapshot,
  showProviderInModelPicker,
  subscribePickerVisibility,
} from "../../features/sessions/model/models";
import { PiUsage } from "./PiUsage";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "../../features/sessions/ui/ProviderSignInPanel";
import {
  newProviderAccount,
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccountExists,
  providerAccounts,
  saveProviderAccount,
  selectProviderAccount,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../features/providers/model/providerAccounts";
import {
  loadAllAccountsUsage,
  loadRemainingQuota,
  subscribeAllAccountsUsage,
  subscribeRemainingQuota,
} from "../../features/settings/model/settings";

const CLOCK_MS = 30_000;

/** Profile accounts and the installed CLI's saved account, respecting visibility. */
function useEnabledUsageProviders(): {
  accountProviders: ProviderAccountProvider[];
  antigravityCli: boolean;
} {
  const availability = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibility = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  return useMemo(
    () => ({
      accountProviders: PROVIDER_ACCOUNT_PROVIDERS.filter((provider) =>
        showProviderInModelPicker(
          provider,
          isHarnessAvailable(provider),
          hasProbedHarnessAvailability(),
        ),
      ),
      // Unlike profile accounts, do not run CLI reports before installation is
      // known. The availability subscription adds the chip when probing ends.
      antigravityCli:
        isHarnessAvailable("antigravity-cli") &&
        showProviderInModelPicker("antigravity-cli", true, true),
    }),
    // The snapshots are version counters that invalidate the module-level reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availability, visibility],
  );
}

export type UsageFooterSession = {
  id?: string;
  harness: HarnessId;
  model?: string;
  authRequired?: boolean;
  providerAccountId?: string;
};

export function UsageFooter({
  providers,
  session,
  project,
  terminals = [],
  terminalOpen = false,
  onToggleTerminal,
  onNewTerminal,
  onShowTerminal,
  projectTerminalActive = false,
  onSelectAccount,
  onManageAccounts,
  processSessions = [],
  processMetadata,
  onStopProcess,
}: {
  processSessions?: Session[];
  processMetadata?: Pick<Session, "id" | "title" | "cwd" | "worktreeCwd">[];
  onStopProcess?: (id: string) => Promise<unknown> | void;
  providers: RateLimitProvider[];
  session?: UsageFooterSession;
  project?: string;
  terminals?: RunningTerminal[];
  terminalOpen?: boolean;
  onToggleTerminal?: (fileId: string) => void;
  onNewTerminal?: () => void;
  onShowTerminal?: () => void;
  projectTerminalActive?: boolean;
  onSelectAccount?: (
    provider: ProviderAccountProvider,
    accountId: string,
  ) => void;
  onManageAccounts?: (provider: ProviderAccountProvider) => void;
}) {
  const requestedClaude = providers.includes("claude");
  const requestedCodex = providers.includes("codex");
  const wantOpencode = providers.includes("opencode");
  const cliAccountKey = runtimeProviderBinaryPath("antigravity-cli") ?? getCustomBinary("antigravity-cli") ?? "default";
  const cliLimits = antigravityCliLimitsForModel(
    useCachedRateLimits("antigravity-cli", cliAccountKey),
    session?.harness === "antigravity-cli" ? session.model : undefined,
  );
  const requestedDevin = providers.includes("devin");
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [accountsVersion, setAccountsVersion] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  const disposed = useRef(false);
  const claudeAccountId =
    session?.harness === "claude" && session.providerAccountId
      ? session.providerAccountId
      : selectedProviderAccountId("claude", project);
  const codexAccountId =
    session?.harness === "codex" && session.providerAccountId
      ? session.providerAccountId
      : selectedProviderAccountId("codex", project);
  const allAccountsUsage = useSyncExternalStore(
    subscribeAllAccountsUsage,
    loadAllAccountsUsage,
    () => false,
  );
  const enabledUsageProviders = useEnabledUsageProviders();
  const enabledAccountProviders = enabledUsageProviders.accountProviders;
  const wantCli =
    providers.includes("antigravity-cli") ||
    (allAccountsUsage && enabledUsageProviders.antigravityCli);
  const allUsage = useSyncExternalStore(
    subscribeRateLimits,
    getAllRateLimits,
    getAllRateLimits,
  );
  const accountEntries = useMemo(
    () =>
      allAccountsUsage
        ? buildAccountChipEntries(enabledAccountProviders, providerAccounts, [
            // The accounts in use stay visible first when the bar collapses.
            ...(requestedClaude ? [`claude:${claudeAccountId}`] : []),
            ...(requestedCodex ? [`codex:${codexAccountId}`] : []),
          ])
        : [],
    // accountsVersion changes whenever accounts are added, renamed or removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      allAccountsUsage,
      enabledAccountProviders,
      accountsVersion,
      requestedClaude,
      requestedCodex,
      claudeAccountId,
      codexAccountId,
    ],
  );
  // With every account on show, the per-provider chips for claude, codex and
  // devin are replaced, and they stop loading on their own.
  const accountMode = accountEntries.length > 0;
  // The open chat's account is highlighted, whichever provider it uses (L-95).
  const inUseKey =
    session?.harness === "claude"
      ? `claude:${claudeAccountId}`
      : session?.harness === "codex"
        ? `codex:${codexAccountId}`
        : session?.harness === "devin"
          ? "devin:default"
          : undefined;
  const cliInUse = session?.harness === "antigravity-cli";
  const wantClaude = requestedClaude && !accountMode;
  const wantCodex = requestedCodex && !accountMode;
  const wantDevin = requestedDevin && !accountMode;
  const claudeAccounts = providerAccounts("claude");
  const codexAccounts = providerAccounts("codex");
  const claudeAccountAvailable = providerAccountExists(
    "claude",
    claudeAccountId,
  );
  const codexAccountAvailable = providerAccountExists("codex", codexAccountId);
  const cachedClaude = useCachedRateLimits("claude", claudeAccountId);
  const cachedCodex = useCachedRateLimits("codex", codexAccountId);
  const opencode = useCachedRateLimits("opencode");
  const devin = useCachedRateLimits("devin");
  const claude = claudeAccountAvailable
    ? cachedClaude
    : unavailableRateLimits(
        "claude",
        "This conversation uses a removed account",
      );
  const codex = codexAccountAvailable
    ? cachedCodex
    : unavailableRateLimits(
        "codex",
        "This conversation uses a removed account",
      );

  useEffect(
    () =>
      subscribeProviderAccounts(() => setAccountsVersion((value) => value + 1)),
    [],
  );

  // Initial loads use the cache; foreground polling below refreshes stale reads.
  useEffect(() => {
    if (wantClaude && claudeAccountAvailable)
      void loadRateLimits("claude", claudeAccountId);
    if (wantCodex && codexAccountAvailable)
      void loadRateLimits("codex", codexAccountId);
    if (wantOpencode) void loadRateLimits("opencode");
    if (wantCli) void loadRateLimits("antigravity-cli", cliAccountKey);
    if (wantDevin) void loadRateLimits("devin");
  }, [
    claudeAccountAvailable,
    claudeAccountId,
    codexAccountAvailable,
    codexAccountId,
    wantClaude,
    wantCodex,
    wantOpencode,
    wantCli,
    cliAccountKey,
    wantDevin,
  ]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  // Accounts without a snapshot load one at a time, in chip order, so many
  // accounts never fire their provider requests in one burst.
  useEffect(() => {
    if (!accountMode) return;
    let cancelled = false;
    const cached = getAllRateLimits();
    void loadAccountsInSequence(
      accountEntries.filter((entry) => cached[entry.key] === undefined),
      (entry) => loadRateLimits(entry.provider, entry.account.id),
      () => cancelled || disposed.current,
    );
    return () => {
      cancelled = true;
    };
  }, [accountEntries, accountMode]);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    const jobs: Promise<unknown>[] = [];
    if (accountMode) {
      // An explicit click asks for a new read, even within the automatic
      // five-minute freshness floor. Keep overflow accounts in this queue.
      jobs.push(
        loadAccountsInSequence(
          accountEntries,
          (entry) => loadRateLimits(entry.provider, entry.account.id, true),
          () => disposed.current,
        ),
      );
    }
    if (wantClaude && claudeAccountAvailable)
      jobs.push(loadRateLimits("claude", claudeAccountId, true));
    if (wantCodex && codexAccountAvailable)
      jobs.push(loadRateLimits("codex", codexAccountId, true));
    if (wantOpencode) jobs.push(loadRateLimits("opencode", "default", true));
    if (wantCli) jobs.push(loadRateLimits("antigravity-cli", cliAccountKey, true));
    if (wantDevin) jobs.push(loadRateLimits("devin", "default", true));
    const run = Promise.allSettled(jobs)
      .then(() => undefined)
      .finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
    inflight.current = run;
    return run;
  }, [
    accountEntries,
    accountMode,
    claudeAccountAvailable,
    claudeAccountId,
    codexAccountAvailable,
    codexAccountId,
    wantClaude,
    wantCodex,
    wantOpencode,
    wantCli,
    cliAccountKey,
    wantDevin,
  ]);

  const pollingTargets = useMemo(() => {
    const targets: RateLimitPollingTarget[] = accountMode
      ? accountEntries.map((entry) => ({
          provider: entry.provider,
          accountId: entry.account.id,
        }))
      : [];
    if (wantClaude && claudeAccountAvailable)
      targets.push({ provider: "claude", accountId: claudeAccountId });
    if (wantCodex && codexAccountAvailable)
      targets.push({ provider: "codex", accountId: codexAccountId });
    if (wantDevin) targets.push({ provider: "devin", accountId: "default" });
    if (wantOpencode) targets.push({ provider: "opencode", accountId: "default" });
    if (wantCli)
      targets.push({ provider: "antigravity-cli", accountId: cliAccountKey });
    return targets;
  }, [
    accountMode, accountEntries,
    wantClaude, claudeAccountAvailable, claudeAccountId,
    wantCodex, codexAccountAvailable, codexAccountId,
    wantDevin, wantOpencode, wantCli, cliAccountKey,
  ]);
  useRateLimitsPolling(pollingTargets);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const consumeCodexResetFor = useCallback(
    async (accountId: string, creditId?: string) => {
      while (inflight.current) await inflight.current;
      setRefreshing(true);
      let outcome: Awaited<ReturnType<typeof consumeCodexRateLimitResetCredit>>;
      const operation = (async () => {
        try {
          outcome = await consumeCodexRateLimitResetCredit(
            creditId,
            accountId,
          );
          await loadRateLimits("codex", accountId, true);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not use Codex reset";
          setCachedRateLimits(
            "codex",
            accountId,
            errorRateLimits(
              "codex",
              message,
              getCachedRateLimits("codex", accountId),
            ),
          );
          throw error;
        }
      })();
      const tracked = operation.finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
      inflight.current = tracked.catch(() => undefined);
      await tracked;
      return outcome!;
    },
    [],
  );

  const consumeCodexReset = useCallback(
    (creditId?: string) => consumeCodexResetFor(codexAccountId, creditId),
    [codexAccountId, consumeCodexResetFor],
  );

  const reconnectProvider = useCallback(
    async (provider: RateLimitProvider, accountId: string) => {
      while (inflight.current) await inflight.current;
      setRefreshing(true);
      const operation = (async () => {
        try {
          await (accountId === "default"
            ? loginHarness(provider)
            : loginHarness(provider, accountId));
          const value = await loadRateLimits(provider, accountId, true);
          if (value.status !== "ok") {
            throw new Error(
              value.error ||
                `${HARNESS_TITLE[provider]} sign-in could not be verified`,
            );
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not complete sign-in";
          setCachedRateLimits(
            provider,
            accountId,
            errorRateLimits(
              provider,
              message,
              getCachedRateLimits(provider, accountId),
            ),
          );
          throw error;
        }
      })();
      const tracked = operation.finally(() => {
        inflight.current = null;
        setRefreshing(false);
      });
      inflight.current = tracked.catch(() => undefined);
      await tracked;
    },
    [],
  );

  const reconnectClaude = useCallback(
    () => reconnectProvider("claude", claudeAccountId),
    [claudeAccountId, reconnectProvider],
  );

  const reconnectCodex = useCallback(
    () => reconnectProvider("codex", codexAccountId),
    [codexAccountId, reconnectProvider],
  );

  const reconnectDevin = useCallback(
    () => reconnectProvider("devin", "default"),
    [reconnectProvider],
  );

  const selectAccount = useCallback(
    (provider: ProviderAccountProvider, accountId: string) => {
      selectProviderAccount(provider, project, accountId);
      onSelectAccount?.(provider, accountId);
    },
    [onSelectAccount, project],
  );

  const addAccount = useCallback(
    async (provider: ProviderAccountProvider, label: string) => {
      const account = newProviderAccount(provider, label);
      await loginHarness(provider, account.id);
      saveProviderAccount(account);
      selectAccount(provider, account.id);
      return account;
    },
    [selectAccount],
  );

  const remainingQuota = useSyncExternalStore(
    subscribeRemainingQuota,
    loadRemainingQuota,
    () => false,
  );

  const showOpencodeChip = wantOpencode && opencode.status !== "unavailable";
  const showUsage =
    accountMode || wantClaude || wantCodex || showOpencodeChip || wantCli || wantDevin;
  const noAccounts = allAccountsUsage && !accountMode;
  const showTerminals = terminals.length > 0;
  const showTerminalButton = Boolean(onNewTerminal || onShowTerminal);
  const terminalLabel = projectTerminalActive
    ? "Terminal"
    : `New Terminal (${MOD}\`)`;
  const onTerminalClick = projectTerminalActive
    ? (onShowTerminal ?? onNewTerminal)
    : (onNewTerminal ?? onShowTerminal);
  const ariaLabel =
    showUsage || session?.harness === "pi"
      ? "Provider usage"
      : showTerminals || showTerminalButton
        ? "Terminals"
        : session
          ? "Session"
          : undefined;

  const cliChip = (
    <UsageProviderChip
      limits={cliLimits}
      now={now}
      remainingQuota={remainingQuota}
      presentation={{ harness: "antigravity-cli", label: "Antigravity CLI", sourceLabel: "Quota and credits from the CLI’s saved account" }}
      inUse={cliInUse}
      onRefresh={() => void loadRateLimits("antigravity-cli", cliAccountKey, true)}
    />
  );
  const refreshButton = (
    <button
      type="button"
      className="grid size-4.5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content disabled:opacity-50"
      aria-label="Refresh usage"
      title="Refresh usage"
      disabled={refreshing}
      onClick={() => void refresh()}
    >
      <RefreshCw
        className={`size-2.5 ${refreshing ? "animate-spin" : ""}`}
        strokeWidth={1.75}
        aria-hidden
      />
    </button>
  );

  return (
    <footer
      aria-label={ariaLabel}
      className="flex h-7 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-stroke px-3 text-[11px] text-content/55"
    >
      {onStopProcess ? <ProcessMonitor sessions={processSessions} metadata={processMetadata} onStop={onStopProcess} /> : null}
      {session?.harness === "pi" ? (
        <PiUsage
          key={`${session.id}:${session.model}`}
          model={session.model}
          now={now}
        />
      ) : showUsage ? (
        <>
          {wantClaude ? (
            <UsageProviderChip
              limits={claude}
              now={now}
              remainingQuota={remainingQuota}
              accounts={claudeAccounts}
              accountId={claudeAccountId}
              onSelectAccount={(accountId) =>
                selectAccount("claude", accountId)
              }
              onAddAccount={(label) => addAccount("claude", label)}
              onManageAccounts={
                onManageAccounts ? () => onManageAccounts("claude") : undefined
              }
              onReconnect={reconnectClaude}
              onRefresh={() => void loadRateLimits("claude", claudeAccountId, true)}
              inUse={session?.harness === "claude"}
            />
          ) : null}
          {wantCodex ? (
            <UsageProviderChip
              limits={codex}
              now={now}
              remainingQuota={remainingQuota}
              project={project}
              accounts={codexAccounts}
              accountId={codexAccountId}
              onSelectAccount={(accountId) => selectAccount("codex", accountId)}
              onAddAccount={(label) => addAccount("codex", label)}
              onManageAccounts={
                onManageAccounts ? () => onManageAccounts("codex") : undefined
              }
              onConsumeReset={consumeCodexReset}
              onReconnect={reconnectCodex}
              onRefresh={() => void loadRateLimits("codex", codexAccountId, true)}
              inUse={session?.harness === "codex"}
            />
          ) : null}
          {wantCli && !accountMode ? cliChip : null}
          {showOpencodeChip ? (
            <UsageProviderChip
              limits={opencode}
              now={now}
              project={project}
              remainingQuota={remainingQuota}
              inUse={session?.harness === "opencode"}
              onRefresh={() => void loadRateLimits("opencode", "default", true)}
            />
          ) : null}
          {wantDevin ? (
            // Devin has one login per machine, so there is no account picker.
            <UsageProviderChip
              limits={devin}
              now={now}
              project={project}
              onReconnect={reconnectDevin}
              onRefresh={() => void loadRateLimits("devin", "default", true)}
              inUse={session?.harness === "devin"}
            />
          ) : null}
          {accountMode ? (
            <AccountUsageStrip
              entries={accountEntries}
              usage={allUsage}
              now={now}
              remainingQuota={remainingQuota}
              onReconnect={reconnectProvider}
              onConsumeReset={consumeCodexResetFor}
              onRefresh={(provider, accountId) =>
                void loadRateLimits(provider, accountId, true)
              }
              inUseKey={inUseKey}
              // Antigravity CLI is its own group after the profile accounts.
              trailing={wantCli ? cliChip : null}
              trailingCount={wantCli ? 1 : 0}
            >
              {refreshButton}
            </AccountUsageStrip>
          ) : (
            refreshButton
          )}
        </>
      ) : session ? (
        <SessionChip key={session.id ?? session.harness} session={session} />
      ) : noAccounts ? (
        <span role="status" className="text-content/35">
          No provider accounts to show
        </span>
      ) : null}
      {showTerminals || showTerminalButton ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showTerminals ? (
            <RunningTerminalChip
              terminals={terminals}
              open={terminalOpen}
              onToggle={onToggleTerminal}
            />
          ) : showTerminalButton ? (
            <button
              type="button"
              className={`inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 hover:bg-content/10 ${
                projectTerminalActive
                  ? "text-accent"
                  : "text-content/40 hover:text-content"
              }`}
              aria-label={terminalLabel}
              aria-pressed={projectTerminalActive}
              title={terminalLabel}
              onClick={onTerminalClick}
            >
              <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span>Terminal</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </footer>
  );
}

function TerminalLiveMark() {
  return (
    <span className="terminal-live shrink-0" aria-hidden>
      <span className="terminal-live-bar" />
      <span className="terminal-live-bar" />
      <span className="terminal-live-bar" />
    </span>
  );
}

function SessionChip({ session }: { session: UsageFooterSession }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [loginState, setLoginState] = useState<ProviderSignInState>("idle");
  const [loginError, setLoginError] = useState<string | null>(null);
  const authRequired = Boolean(
    session.authRequired && loginState !== "complete",
  );
  const canLogin = authRequired && supportsHarnessLogin(session.harness);

  useEffect(() => {
    if (!session.authRequired && loginState === "complete") {
      setLoginState("idle");
    }
  }, [loginState, session.authRequired]);

  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") {
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };

  const signIn = async () => {
    setLoginState("running");
    setLoginError(null);
    try {
      await loginHarness(session.harness);
      setOpen(false);
      setLoginState("complete");
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Could not complete sign-in",
      );
      setLoginState("error");
    }
  };

  if (!canLogin) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
        title={HARNESS_TITLE[session.harness]}
      >
        <HarnessIcon harness={session.harness} className="size-3 shrink-0" />
        <span>{HARNESS_LABEL[session.harness]}</span>
      </span>
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="-mx-1 inline-flex h-5 min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1 text-content/55 transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97]"
        aria-label={`${HARNESS_TITLE[session.harness]} sign-in required`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${HARNESS_TITLE[session.harness]} sign-in required`}
        onClick={() => setOpen((value) => !value)}
      >
        <HarnessIcon harness={session.harness} className="size-3 shrink-0" />
        <span>{HARNESS_LABEL[session.harness]}</span>
        {authRequired ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-300">
            sign in
          </span>
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={7}
          width={300}
          autoFocus
          onDismiss={dismiss}
          role="dialog"
          aria-label={`${HARNESS_TITLE[session.harness]} sign-in`}
          tabIndex={-1}
          className="text-content"
        >
          <ProviderSignInPanel
            harness={session.harness}
            state={loginState}
            error={loginError}
            onSignIn={() => void signIn()}
          />
        </Popover>
      ) : null}
    </>
  );
}

function RunningTerminalChip({
  terminals,
  open: panelOpen,
  onToggle,
}: {
  terminals: RunningTerminal[];
  open: boolean;
  onToggle?: (fileId: string) => void;
}) {
  const root = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const label = runningTerminalChipLabel(terminals);
  const many = terminals.length > 1;
  const title = terminals
    .map((terminal) => `"${terminal.process}" in ${terminal.label}`)
    .join("\n");
  const ariaLabel =
    terminals.length === 1
      ? panelOpen
        ? `Hide ${terminals[0]?.process}`
        : `Show ${terminals[0]?.process}`
      : panelOpen
        ? "Hide running terminals"
        : `${terminals.length} terminals are running processes`;

  const toggle = (fileId: string) => {
    setMenuOpen(false);
    onToggle?.(fileId);
  };

  return (
    <>
      <button
        ref={root}
        type="button"
        className="inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 whitespace-nowrap rounded px-1 -mx-1 hover:bg-content/10 hover:text-content"
        aria-label={ariaLabel}
        aria-pressed={panelOpen}
        aria-expanded={many && !panelOpen ? menuOpen : undefined}
        aria-haspopup={many && !panelOpen ? "menu" : undefined}
        title={title}
        onClick={() => {
          if (panelOpen || !many) {
            const target = terminals[0];
            if (target) toggle(target.id);
            return;
          }
          setMenuOpen((value) => !value);
        }}
      >
        <TerminalLiveMark />
        <span className="truncate font-mono text-[10px] tabular-nums">
          {label}
        </span>
      </button>
      {menuOpen && many && !panelOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          autoFocus
          onDismiss={() => setMenuOpen(false)}
          role="menu"
          aria-label="Running terminals"
          className="min-w-[12rem] p-1"
        >
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              role="menuitem"
              className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] leading-none text-content hover:bg-content/10"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggle(terminal.id)}
            >
              <span className="min-w-0 flex-1 truncate">
                {terminal.process}
              </span>
              <span className="max-w-[7rem] shrink-0 truncate text-[11px] text-content/40">
                {terminal.label}
              </span>
            </button>
          ))}
        </Popover>
      ) : null}
    </>
  );
}
