import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { Loader, Search } from "../../../shared/ui/icons";
import { LAYER } from "../../../shared/lib/layers";
import {
  providerAccounts,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  parseNativeSessionInput,
  resolveNativeSession,
} from "../model/nativeSessionInput";
import {
  listProviderConversations,
  setProviderConversationArchived,
  type NativeProvider,
  type ProviderConversation,
} from "../model/providerSessions";
import { PROVIDER_LABEL, folderName } from "../model/conversationSummary";
import { ProviderConversationStore } from "../model/conversationStore";
import { ProviderConversationList } from "./ProviderConversationList";
import { loadRecents } from "../../projects/model/recents";
import {
  continueAccountTargets,
  copyClaudeSession,
} from "../../providers/model/continueOnAccount";

type Props = {
  providers: readonly NativeProvider[];
  onResume: (row: ProviderConversation) => Promise<void>;
  onClose: () => void;
};

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-content/10 bg-content/5 pr-2.5 text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25 disabled:opacity-50";

/**
 * Resumes a local Claude Code or Codex conversation. The list loads on open and
 * whenever provider, account or project changes; search text applies on Enter
 * (or when cleared) so typing never triggers a scan.
 */
export function ResumeSessionDialog({
  providers,
  onResume,
  onClose,
}: Props): ReactElement {
  const [provider, setProvider] = useState<NativeProvider>(
    providers[0] ?? "claude",
  );
  const [accountId, setAccountId] = useState("default");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const [query, setQuery] = useState("");
  const [projectCwd, setProjectCwd] = useState("");
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [request, setRequest] = useState<{
    provider: NativeProvider;
    accountId: string;
    query: string;
    projectCwd: string;
  } | null>(null);
  const store = useMemo(
    () =>
      new ProviderConversationStore({
        accounts: () => [request?.accountId ?? "default"],
        list: (selected, options) =>
          listProviderConversations(selected, {
            ...options,
            query: request?.query,
            projectCwd: request?.projectCwd,
          }),
      }),
    [request],
  );
  const lists = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const activeRequest =
    request?.provider === provider && request.accountId === accountId;
  useEffect(() => {
    store.setProviders(request ? [request.provider] : []);
    return () => store.setProviders([]);
  }, [store, request]);
  const projects = useMemo(() => loadRecents(), []);
  const accountSnapshot = useSyncExternalStore(
    subscribeProviderAccounts,
    () => JSON.stringify(providerAccounts(provider)),
    () => JSON.stringify(providerAccounts(provider)),
  );
  const accounts = useMemo(
    () => providerAccounts(provider),
    [provider, accountSnapshot],
  );
  const close = (): void => {
    if (!submitting.current) onClose();
  };
  const find = (overrides?: { query?: string }): void => {
    if (submitting.current) return;
    if (
      !providers.includes(provider) ||
      !accounts.some((account) => account.id === accountId)
    ) {
      setError("Choose an enabled provider and available account first.");
      return;
    }
    setError(null);
    const next = {
      provider,
      accountId,
      query: (overrides?.query ?? query).trim(),
      projectCwd,
    };
    // An identical request keeps the loaded list instead of rescanning.
    setRequest((current) =>
      current &&
      current.provider === next.provider &&
      current.accountId === next.accountId &&
      current.query === next.query &&
      current.projectCwd === next.projectCwd
        ? current
        : next,
    );
  };
  // A removed account falls back to the first available one.
  useEffect(() => {
    if (!accounts.some((account) => account.id === accountId))
      setAccountId(accounts[0]?.id ?? "default");
  }, [accounts, accountId]);
  // Load on open and on provider, account or project change. find() reads the
  // current query on purpose: typing alone must not rescan.
  useEffect(() => {
    if (
      providers.includes(provider) &&
      accounts.some((account) => account.id === accountId)
    )
      find();
  }, [provider, accountId, projectCwd]);
  const resumeRow = async (row: ProviderConversation): Promise<void> => {
    if (submitting.current) return;
    if (
      row.provider !== provider ||
      row.providerAccountId !== accountId ||
      !providers.includes(provider) ||
      !accounts.some((account) => account.id === accountId)
    ) {
      setError(
        "This conversation belongs to a different or removed provider account. Find again.",
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setOpeningKey(row.key);
    setError(null);
    try {
      await onResume(row);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
      setOpeningKey(null);
    }
  };
  /** Fork L-102: copy the chat to another account's folder, then resume it there. */
  const resumeOn = async (
    row: ProviderConversation,
    targetId: string,
  ): Promise<void> => {
    if (submitting.current) return;
    if (
      row.provider !== "claude" ||
      !accounts.some((account) => account.id === targetId)
    ) {
      setError("Choose an available Claude account first.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setOpeningKey(row.key);
    setError(null);
    try {
      await copyClaudeSession({
        fromAccount: row.providerAccountId,
        toAccount: targetId,
        sessionId: row.nativeId,
        cwd: row.cwd,
      });
      const target = await resolveNativeSession(
        { provider: "claude", nativeId: row.nativeId },
        targetId,
      );
      await onResume(target);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
      setOpeningKey(null);
    }
  };
  const archive = async (
    row: ProviderConversation,
    archived: boolean,
  ): Promise<void> => {
    if (submitting.current) return;
    try {
      await setProviderConversationArchived(row.key, archived);
      await store.refresh(provider);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const submit = async (): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const reference = parseNativeSessionInput(input, provider);
      if (reference.provider !== provider)
        throw new Error(
          `This command is for ${PROVIDER_LABEL[reference.provider]}. Choose that provider first.`,
        );
      if (!providers.includes(provider))
        throw new Error("Enable this provider in Settings first.");
      if (!accounts.some((account) => account.id === accountId))
        throw new Error(
          "This account was removed. Choose an available account.",
        );
      const row = await resolveNativeSession(reference, accountId);
      await onResume(row);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const providerOptions = (["claude", "codex"] as const)
    .filter((value) => providers.includes(value))
    .map((value) => ({
      id: value,
      label: value === "claude" ? "Claude Code" : "Codex",
    }));
  const showProviderSwitch = providers.length > 1;
  const showAccountSelect = accounts.length > 1;
  return (
    <Modal
      title="Resume session"
      description="Continue a Claude Code or Codex conversation from this computer."
      onClose={close}
      size="md"
      fitViewport
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        aria-busy={busy}
      >
        {showProviderSwitch || showAccountSelect ? (
          <div className="flex items-center gap-2">
            {showProviderSwitch ? (
              <SegmentedSwitch
                ariaLabel="Provider"
                value={provider}
                options={providerOptions}
                onChange={(value) => {
                  if (busy) return;
                  setProvider(value);
                  setAccountId("default");
                  setError(null);
                }}
              />
            ) : null}
            {showAccountSelect ? (
              <div className="ml-auto w-44 min-w-0">
                <SearchableSelect
                  label="Account"
                  value={accountId}
                  options={accounts.map((account) => ({
                    value: account.id,
                    label: account.label,
                  }))}
                  disabled={busy}
                  searchable={false}
                  layer={LAYER.dialogPopover}
                  onChange={(value) => {
                    setAccountId(value);
                    setError(null);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <div className="relative flex h-9 min-w-0 flex-1 items-center">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 size-3.5 text-content/40"
              strokeWidth={1.75}
            />
            <input
              aria-label="Search conversations"
              value={query}
              disabled={busy}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim() === "") find({ query: "" });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  find();
                }
              }}
              placeholder="Search by name, message, folder or ID"
              className={`${INPUT_CLASS} pl-8`}
            />
          </div>
          <div className="w-40 shrink-0">
            <SearchableSelect
              label="Project"
              value={projectCwd}
              disabled={busy}
              layer={LAYER.dialogPopover}
              options={[
                { value: "", label: "All projects" },
                ...projects.map((project) => ({
                  value: project.path,
                  label: folderName(project.path),
                  description: project.path,
                })),
              ]}
              onChange={setProjectCwd}
            />
          </div>
        </div>
        {activeRequest ? (
          <div
            className="h-72 min-h-0 overflow-hidden rounded-md border border-content/10"
            inert={busy || undefined}
          >
            <ProviderConversationList
              provider={provider}
              menuLayer={LAYER.dialogPopover}
              state={lists[provider]}
              showArchived={store.getIncludeArchived()}
              openingKey={openingKey}
              actionError={null}
              onDismissActionError={() => setError(null)}
              onShowArchivedChange={(value) => store.setIncludeArchived(value)}
              onRefresh={() => {
                if (!submitting.current) void store.refresh(provider);
              }}
              onLoadMore={() => {
                if (!submitting.current) void store.loadMore(provider);
              }}
              onOpen={(row) => {
                void resumeRow(row);
              }}
              onArchive={(row, archived) => {
                void archive(row, archived);
              }}
              resumeOnAccounts={
                provider === "claude" ? continueAccountTargets("") : []
              }
              onResumeOn={(row, targetId) => {
                void resumeOn(row, targetId);
              }}
            />
          </div>
        ) : null}
        <details>
          <summary className="cursor-pointer text-[12px] text-content/55">
            Paste a session ID instead
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="Session ID or resume command"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              maxLength={1024}
              placeholder={
                provider === "claude"
                  ? "claude --resume <session-id>"
                  : "codex resume <session-id>"
              }
              className={`${INPUT_CLASS} min-w-0 flex-1 pl-2.5`}
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || providers.length === 0}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-content px-3 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : null}
              {busy ? "Resuming…" : "Resume"}
            </button>
          </div>
        </details>
        <p className="text-[11px] leading-4 text-content/45">
          Must be on this computer. Close it in the other app first.
        </p>
        {error ? (
          <p
            role="alert"
            className="whitespace-pre-wrap break-words text-[11px] leading-4 text-red-400/90"
          >
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
