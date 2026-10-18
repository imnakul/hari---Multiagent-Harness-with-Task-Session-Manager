import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { accountStatus } from "../../features/providers/model/accountUsage";
import {
  formatWindowLabel,
  idleRateLimits,
  type ProviderRateLimits,
} from "../../features/providers/model/rateLimits";
import type { CodexRateLimitResetOutcome } from "../../features/providers/model/rateLimitsFetch";
import {
  AccountStatusLabel,
  meterWindows,
  UsageMeter,
} from "../../features/providers/ui/ProviderAccountUsage";
import { HARNESS_TITLE } from "../../features/sessions/model/session";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { Popover, type PopoverDismissReason } from "../../shared/ui/Popover";
import {
  GROUP_DIVIDER_PX,
  splitVisibleEntries,
  type AccountChipEntry,
} from "./allAccountsUsage";
import { UsageProviderChip } from "./UsageProviderChip";

/**
 * One usage chip per account, collapsing what does not fit into a "+N" chip.
 * It fills the space the footer leaves for usage and measures that space, so
 * the terminal controls on the right are never pushed out. A thin divider
 * separates each provider's group (fork, L-85). `trailing` (chips for
 * providers without profile accounts, like Antigravity CLI) form the last
 * group, and `children` (the refresh button) trail everything.
 */
export function AccountUsageStrip({
  entries,
  usage,
  now,
  remainingQuota,
  onReconnect,
  onConsumeReset,
  inUseKey,
  trailing,
  trailingCount = 0,
  children,
}: {
  entries: readonly AccountChipEntry[];
  usage: Record<string, ProviderRateLimits>;
  now: number;
  remainingQuota: boolean;
  onReconnect: (
    provider: AccountChipEntry["provider"],
    accountId: string,
  ) => Promise<void>;
  onConsumeReset: (
    accountId: string,
    creditId?: string,
  ) => Promise<CodexRateLimitResetOutcome>;
  /** `provider:accountId` of the account the open chat runs on. */
  inUseKey?: string;
  trailing?: ReactNode;
  /** How many chips `trailing` renders, so the strip can leave room for them. */
  trailingCount?: number;
  children?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const groupCount =
    new Set(entries.map((entry) => entry.provider)).size +
    (trailingCount > 0 ? 1 : 0);
  const { visible, overflow } = useMemo(
    () =>
      splitVisibleEntries(
        entries,
        width,
        Math.max(0, groupCount - 1) * GROUP_DIVIDER_PX +
          trailingCount * TRAILING_CHIP_PX,
      ),
    [entries, width, groupCount, trailingCount],
  );
  const limitsFor = (entry: AccountChipEntry): ProviderRateLimits =>
    usage[entry.key] ?? idleRateLimits(entry.provider);

  return (
    <div
      ref={container}
      role="group"
      aria-label="Usage for every account"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
    >
      {visible.map((entry, index) => (
        <Fragment key={entry.key}>
          {index > 0 && visible[index - 1]?.provider !== entry.provider ? (
            <GroupDivider />
          ) : null}
          <UsageProviderChip
            limits={limitsFor(entry)}
            now={now}
            remainingQuota={remainingQuota}
            accountLabel={entry.label}
            inlineWindow="shortest"
            inUse={entry.key === inUseKey}
            onReconnect={() => onReconnect(entry.provider, entry.account.id)}
            onConsumeReset={
              entry.provider === "codex"
                ? (creditId) => onConsumeReset(entry.account.id, creditId)
                : undefined
            }
          />
        </Fragment>
      ))}
      {overflow.length > 0 ? (
        <OverflowChip entries={overflow} limitsFor={limitsFor} now={now} />
      ) : null}
      {trailing && trailingCount > 0 ? (
        <>
          {visible.length > 0 ? <GroupDivider /> : null}
          {trailing}
        </>
      ) : null}
      {children}
    </div>
  );
}

/** Rough width of a provider chip rendered in `trailing`. */
const TRAILING_CHIP_PX = 260;

function GroupDivider() {
  return (
    <span
      aria-hidden="true"
      data-testid="usage-group-divider"
      className="h-3.5 w-px shrink-0 bg-content/20"
    />
  );
}

function OverflowChip({
  entries,
  limitsFor,
  now,
}: {
  entries: AccountChipEntry[];
  limitsFor: (entry: AccountChipEntry) => ProviderRateLimits;
  now: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = `${entries.length} more ${entries.length === 1 ? "account" : "accounts"}`;

  const dismiss = (reason: PopoverDismissReason) => {
    setOpen(false);
    if (reason === "escape") {
      requestAnimationFrame(() => trigger.current?.focus());
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded px-1.5 text-content/55 tabular-nums transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97]"
        aria-label={`${label}, usage details`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        +{entries.length}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={7}
          width={320}
          maxHeight={460}
          autoFocus
          onDismiss={dismiss}
          role="dialog"
          aria-label={`${label} usage`}
          tabIndex={-1}
          className="overflow-y-auto p-2.5 text-content"
        >
          <h2 className="px-1 pb-2 text-[13px] font-medium leading-4">
            More accounts
          </h2>
          <ul className="flex flex-col gap-1">
            {entries.map((entry) => {
              const limits = limitsFor(entry);
              const meters = meterWindows(limits);
              return (
                <li
                  key={entry.key}
                  className="rounded-lg bg-content/[0.035] px-2.5 py-2 text-[11px] ring-1 ring-inset ring-content/[0.06]"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <HarnessIcon
                      harness={entry.provider}
                      className="size-3 shrink-0"
                    />
                    <span className="min-w-0 truncate">
                      <span className="text-content/50">
                        {HARNESS_TITLE[entry.provider]} ·{" "}
                      </span>
                      {entry.label}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-3 text-[10px]">
                    <AccountStatusLabel
                      status={accountStatus(limits, now)}
                      className={meters.length > 0 ? "shrink-0" : "min-w-0"}
                    />
                    {meters.length > 0 ? (
                      <span className="flex min-w-0 flex-1 gap-2.5">
                        {meters.map((meter) => (
                          <UsageMeter
                            key={meter.title}
                            title={formatWindowLabel(
                              meter.window.windowMinutes,
                            )}
                            window={meter.window}
                            now={now}
                            className="min-w-0 flex-1"
                          />
                        ))}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Popover>
      ) : null}
    </>
  );
}
