import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { continueHelperAvailable } from "../../../integrations/harness/core/continueHelper";
import {
  providerAccountExists,
  providerAccounts,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { ChevronDown, CornerDownRight } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { AI_HELPER_PROVIDERS, type AiHelperTarget } from "../../settings/model/settings";
import {
  CONTINUE_PRESETS,
  resolveContinueRun,
  type ContinueChoice,
  type ContinueEstimate,
  type ContinuePreset,
} from "../model/continueCard";
import { loadContinueChoice, saveContinueChoice } from "../model/continueChoice";
import { modelsFor, preferredModelId } from "../model/models";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { SecondOpinionButton } from "./SecondOpinionButton";

type Props = {
  from: HarnessId;
  fromModel?: string;
  /** Project folder the last choice is remembered for. */
  projectCwd: string;
  /** Operator is on in this chat, so a Claude chat must run Structured (L-193). */
  operatorOn?: boolean;
  estimate: (choice: ContinueChoice) => ContinueEstimate;
  onContinue: (choice: ContinueChoice) => void;
};

const PANEL_WIDTH = 300;
const SELF = "[data-provider-target],[data-continue-panel],[data-dialog-popover]";
const AUTO = "auto";
const SAME = "same";

type ClaudeExecution = "structured" | "interactive";

function initialChoice(from: HarnessId, fromModel: string | undefined, projectCwd: string): ContinueChoice {
  const saved = loadContinueChoice(projectCwd);
  if (saved && isHarnessAvailable(saved.target.harness)) {
    const { accountId, ...rest } = saved;
    const harness = saved.target.harness;
    // A removed account falls back to the default choice (L-193).
    const kept =
      accountId !== undefined &&
      supportsProviderAccounts(harness) &&
      providerAccountExists(harness, accountId);
    return kept ? saved : rest;
  }
  return {
    target: { harness: from, model: fromModel ?? preferredModelId(from), modelSettings: {} },
    preset: saved?.preset ?? "balanced",
  };
}

function modelName(harness: HarnessId, id: string): string {
  return modelsFor(harness).find((model) => model.id === id)?.name ?? id;
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1)}k` : String(tokens);
}

export function ContinueButton({
  from,
  fromModel,
  projectCwd,
  operatorOn = false,
  estimate,
  onContinue,
}: Props): ReactElement {
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const [accountsVersion, setAccountsVersion] = useState(0);
  useEffect(
    () => subscribeProviderAccounts(() => setAccountsVersion((value) => value + 1)),
    [],
  );
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ContinueChoice>(() =>
    initialChoice(from, fromModel, projectCwd),
  );
  const run = resolveContinueRun(choice);
  const helpers = useMemo(() => {
    void availabilityVersion;
    return AI_HELPER_PROVIDERS.filter((provider) => continueHelperAvailable({ provider }));
  }, [availabilityVersion]);
  const numbers = useMemo(() => (open ? estimate(choice) : null), [open, estimate, choice]);
  const helper = choice.helper ?? null;
  const preset = CONTINUE_PRESETS.find((option) => option.id === choice.preset);
  const harness = choice.target.harness;
  const accounts = useMemo(() => {
    void accountsVersion;
    return supportsProviderAccounts(harness) ? providerAccounts(harness) : [];
  }, [accountsVersion, harness]);
  const sameProvider = harness === from;
  const accountValue =
    choice.accountId && accounts.some((account) => account.id === choice.accountId)
      ? choice.accountId
      : sameProvider
        ? SAME
        : supportsProviderAccounts(harness)
          ? selectedProviderAccountId(harness, projectCwd)
          : "";
  const claudeExecution: ClaudeExecution =
    operatorOn || choice.target.modelSettings.claudeExecution !== "interactive"
      ? "structured"
      : "interactive";

  const toggle = (): void => {
    if (!open) setChoice(initialChoice(from, fromModel, projectCwd));
    setOpen((value) => !value);
  };
  const update = (patch: Partial<ContinueChoice>): void =>
    setChoice((current) => ({ ...current, ...patch }));
  const setHelper = (next: AiHelperTarget | null): void => update({ helper: next });
  const setAccount = (value: string): void =>
    setChoice((current) => {
      const { accountId: _old, ...rest } = current;
      return value === SAME ? rest : { ...rest, accountId: value };
    });
  const setExecution = (mode: ClaudeExecution): void =>
    setChoice((current) => ({
      ...current,
      target: {
        ...current.target,
        modelSettings: { ...current.target.modelSettings, claudeExecution: mode },
      },
    }));
  const submit = (): void => {
    // Operator can't run in Interactive Claude, so the new chat runs Structured.
    const final: ContinueChoice =
      operatorOn && harness === "claude"
        ? {
            ...choice,
            target: {
              ...choice.target,
              modelSettings: { ...choice.target.modelSettings, claudeExecution: "structured" },
            },
          }
        : choice;
    saveContinueChoice(projectCwd, final);
    setOpen(false);
    onContinue(final);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        title="Continue in a new chat"
        aria-label="Continue in a new chat"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`rounded-md p-1 ${
          open
            ? "bg-content/8 text-content/70"
            : "text-content/40 hover:bg-content/8 hover:text-content/70"
        }`}
        onClick={toggle}
      >
        <CornerDownRight aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={button}
          side="top"
          align="center"
          width={PANEL_WIDTH}
          autoFocus
          ignore={SELF}
          onDismiss={() => setOpen(false)}
          role="dialog"
          tabIndex={-1}
          aria-label="Continue in a new chat"
          data-continue-panel
          className="flex flex-col gap-2.5 p-3 font-sans text-[12px] text-content/80"
        >
          <div>
            <p className="text-[13px] font-medium text-content">Continue in a new chat</p>
            <p className="mt-0.5 text-[11px] leading-4 text-content/50 text-pretty">
              Opens beside this chat with a context card. Nothing is sent until you send.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-content/50">Continue with</span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <HarnessIcon harness={choice.target.harness} className="size-3.5 shrink-0" />
              <span className="truncate text-content">
                {modelName(choice.target.harness, choice.target.model)}
              </span>
            </span>
            <SecondOpinionButton
              from={from}
              fromModel={fromModel}
              onPick={(target) =>
                setChoice((current) => {
                  const { accountId: _old, ...rest } = current;
                  const keep = target.harness === current.target.harness;
                  return { ...(keep ? current : rest), target };
                })
              }
              icon={ChevronDown}
              title="Change model"
              disabledTitle="No other provider is available"
              description="Choose the agent and model for the new chat."
              menuLabel="Choose the agent for the new chat"
              includeCurrent
            />
          </div>

          {accounts.length > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-content/50">Account</span>
              <SearchableSelect
                label="Account"
                variant="row"
                align="end"
                searchable={false}
                value={accountValue}
                options={[
                  ...(sameProvider ? [{ value: SAME, label: "Same as this chat" }] : []),
                  ...accounts.map((account) => ({ value: account.id, label: account.label })),
                ]}
                onChange={setAccount}
              />
            </div>
          ) : null}

          {harness === "claude" ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-content/50">Claude runs</span>
                {operatorOn ? (
                  <span className="text-content/80">Structured</span>
                ) : (
                  <SegmentedSwitch<ClaudeExecution>
                    ariaLabel="Claude Code execution"
                    options={[
                      { id: "structured", label: "Structured" },
                      { id: "interactive", label: "Interactive" },
                    ]}
                    value={claudeExecution}
                    onChange={setExecution}
                  />
                )}
              </div>
              {operatorOn ? (
                <p className="text-[11px] leading-4 text-content/50 text-pretty">
                  Operator is on in this chat, and Interactive can't use Operator.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <SegmentedSwitch<ContinuePreset>
              ariaLabel="Context card"
              options={CONTINUE_PRESETS}
              value={choice.preset}
              onChange={(next) => update({ preset: next })}
            />
            {preset ? <p className="text-[11px] leading-4 text-content/50">{preset.hint}</p> : null}
          </div>

          {run.helper ? (
            <details className="group rounded-md border border-content/10 px-2 py-1.5">
              <summary className="cursor-pointer select-none text-[11px] text-content/60 hover:text-content/80">
                Advanced
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-content/60">Helper</span>
                  <SearchableSelect
                    label="Helper"
                    variant="row"
                    align="end"
                    searchable={false}
                    value={helper?.provider ?? AUTO}
                    options={[
                      { value: AUTO, label: "Automatic" },
                      ...helpers.map((provider) => ({
                        value: provider,
                        label: HARNESS_TITLE[provider],
                      })),
                    ]}
                    onChange={(value) => {
                      const provider = helpers.find((id) => id === value);
                      setHelper(provider ? { provider } : null);
                    }}
                  />
                </div>
                {helper ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-content/60">Model</span>
                    <SearchableSelect
                      label="Helper model"
                      variant="row"
                      align="end"
                      searchPlaceholder="Search models…"
                      value={helper.model ?? ""}
                      options={[
                        { value: "", label: "Default" },
                        ...modelsFor(helper.provider).map((model) => ({
                          value: model.id,
                          label: model.name,
                        })),
                      ]}
                      onChange={(value) =>
                        setHelper({
                          provider: helper.provider,
                          ...(helper.accountId ? { accountId: helper.accountId } : {}),
                          ...(value ? { model: value } : {}),
                        })
                      }
                    />
                  </div>
                ) : null}
                {helper?.provider === "antigravity" ? (
                  <p className="text-[11px] leading-4 text-content/50">
                    Stops if it tries a tool, then the next helper runs.
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-content/60">Passes</span>
                  <SegmentedSwitch<"1" | "2">
                    ariaLabel="Passes"
                    options={[
                      { id: "1", label: "One" },
                      { id: "2", label: "Two" },
                    ]}
                    value={run.passes === 2 ? "2" : "1"}
                    onChange={(next) => update({ passes: next === "2" ? 2 : 1 })}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-content/60">Context</span>
                  <SegmentedSwitch<"short" | "long">
                    ariaLabel="Context read"
                    options={[
                      { id: "short", label: "Short" },
                      { id: "long", label: "Long" },
                    ]}
                    value={run.context}
                    onChange={(next) => update({ context: next })}
                  />
                </div>
              </div>
            </details>
          ) : null}

          {numbers ? (
            <p className="text-[11px] leading-4 tabular-nums text-content/50">
              {numbers.helperReads > 0
                ? `Helper reads ~${formatTokens(numbers.helperReads)} tokens · `
                : "No helper · "}
              card ~{formatTokens(numbers.card)} tokens with your first message
            </p>
          ) : null}
          {choice.target.harness === from ? (
            <p className="text-[11px] leading-4 text-content/50">
              Same provider: the new chat keeps the full history when it can.
            </p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            className="self-end rounded-md bg-content px-3 py-1 text-[12px] font-medium text-background-base hover:bg-content/90 active:scale-96"
          >
            Continue
          </button>
        </Popover>
      ) : null}
    </>
  );
}
