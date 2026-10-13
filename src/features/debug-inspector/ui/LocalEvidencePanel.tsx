import { useEffect, useRef, useState, type ReactElement } from "react";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { isMonoSession } from "../../monos/model/mono";
import { providerAccounts } from "../../providers/model/providerAccounts";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  readLocalEvidence,
  readStoredIdentity,
  type LocalEvidence,
} from "../model/evidence";
import type { UsageScope } from "../model/trace";
import { UsageTable } from "./UsageTable";

type ReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; evidence: LocalEvidence };
export function LocalEvidencePanel({
  sessionId,
  sessions,
  onEvidence,
}: {
  sessionId: string;
  sessions: readonly SessionSummary[];
  onEvidence: (evidence: LocalEvidence | undefined) => void;
}): ReactElement {
  const [mode, setMode] = useState("session");
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [accountId, setAccountId] = useState("default");
  const [nativeId, setNativeId] = useState("");
  const [scope, setScope] = useState<UsageScope>("message");
  const [state, setState] = useState<ReadState>({ status: "idle" });
  const generation = useRef(0);
  const inFlight = useRef(false);
  const evidenceCallback = useRef(onEvidence);
  evidenceCallback.current = onEvidence;
  useEffect(() => {
    generation.current += 1;
    setState({ status: "idle" });
    evidenceCallback.current(undefined);
    return () => {
      generation.current += 1;
    };
  }, [sessionId, mode, provider, accountId, nativeId]);
  const read = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    setState({ status: "loading" });
    try {
      const selected = sessions.find((session) => session.id === sessionId);
      const identity =
        mode === "session"
          ? await readStoredIdentity(sessionId, isMonoSession(sessionId))
          : { provider, nativeId: nativeId.trim(), accountId };
      if (generation.current !== request) return;
      if (
        mode === "session" &&
        (!selected || selected.harness !== identity.provider)
      )
        throw new Error("Identity unavailable");
      const evidence = await readLocalEvidence(
        identity.provider,
        identity.nativeId,
        identity.accountId,
      );
      if (generation.current !== request) return;
      setState({ status: "ready", evidence });
      evidenceCallback.current(evidence);
      setScope(
        evidence.provider === "claude" ? "message" : "session-cumulative",
      );
    } catch {
      if (generation.current !== request) return;
      setState({
        status: "error",
        message:
          "Could not read scoped local metadata. Check the native ID/account and that an uncompressed, readable transcript exists. No provider was started.",
      });
    } finally {
      inFlight.current = false;
    }
  };
  const evidence = state.status === "ready" ? state.evidence : undefined;
  const scopes: UsageScope[] = [
    "message",
    "session-cumulative",
    "sdk-result",
    "last-response",
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-content/55">
        Read Claude Code or Codex transcript metadata on this machine. Choose a
        saved MonoCode chat, or provide an exact native ID from an accessible
        interactive/Desktop session in the same account store. Desktop sessions
        outside that store and other providers’ local formats are unsupported.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <SearchableSelect
          label="Evidence selection"
          value={mode}
          onChange={setMode}
          options={[
            { value: "session", label: "Selected MonoCode chat" },
            { value: "native", label: "Exact native session" },
          ]}
          searchable={false}
        />
        {mode === "native" ? (
          <>
            <SearchableSelect
              label="Native provider"
              value={provider}
              onChange={(value) => {
                setProvider(value === "codex" ? "codex" : "claude");
                setAccountId("default");
              }}
              options={[
                { value: "claude", label: "Claude Code" },
                { value: "codex", label: "Codex" },
              ]}
              searchable={false}
            />
            <SearchableSelect
              label="Native account"
              value={accountId}
              onChange={setAccountId}
              options={providerAccounts(provider).map((account) => ({
                value: account.id,
                label: account.label,
              }))}
            />
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-content/50">
              Native session ID
              <input
                value={nativeId}
                onChange={(event) => setNativeId(event.target.value)}
                maxLength={128}
                className="min-w-0 rounded-md border border-content/10 bg-content/5 px-3 py-2 font-mono text-content outline-none focus-visible:border-accent"
              />
            </label>
          </>
        ) : null}
        <SecondaryButton
          disabled={
            state.status === "loading" ||
            (mode === "session" ? !sessionId : !nativeId.trim())
          }
          onClick={() => {
            void read();
          }}
        >
          {state.status === "loading"
            ? "Reading metadata…"
            : "Read local metadata"}
        </SecondaryButton>
      </div>
      {state.status === "idle" ? (
        <p className="rounded-lg border border-dashed border-content/15 p-6 text-sm text-content/45">
          No local files have been read. This action reads metadata only; it
          never resumes or probes a provider.
        </p>
      ) : null}
      {state.status === "loading" ? (
        <p role="status" className="py-6 text-sm text-content/55">
          Reading a bounded snapshot of the selected transcript…
        </p>
      ) : null}
      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded-lg border border-content/15 p-4 text-sm text-content/70"
        >
          {state.message}
        </p>
      ) : null}
      {evidence ? (
        <>
          <div className="rounded-lg bg-content/5 p-3 text-xs leading-relaxed text-content/60">
            <strong className="text-content">{evidence.source}</strong> ·{" "}
            {new Date(evidence.observedAt).toLocaleString()} · account{" "}
            {evidence.accountId}
            <br />
            {evidence.readBytes.toLocaleString()} /{" "}
            {evidence.fileBytes.toLocaleString()} bytes ·{" "}
            {evidence.measurements.length} measurements ·{" "}
            {evidence.truncated ? "Partial coverage" : "Bounded file coverage"}{" "}
            ·{" "}
            {evidence.changedDuringRead
              ? "File changed during read; retry for a consistent snapshot"
              : "File stable during read"}
            <br />
            {evidence.malformedLines} malformed lines · {evidence.partialLines}{" "}
            partial lines skipped. Re-reading replaces this snapshot; it never
            adds usage to live totals.
          </div>
          <SearchableSelect
            label="Local usage scope"
            value={scope}
            onChange={(value) => {
              const next = scopes.find((item) => item === value);
              if (next) setScope(next);
            }}
            options={scopes.map((value) => ({ value, label: value }))}
            searchable={false}
          />
          <UsageTable
            measurements={evidence.measurements.filter(
              (row) => row.scope === scope,
            )}
            aggregate={scope === "message"}
          />
          <p className="text-xs leading-relaxed text-content/45">
            {evidence.limitations.join(" ")} Last-response snapshots and
            cumulative counters overlap; they are displayed separately. Model
            requests, retries, cache misses and subscription billing may remain
            hidden.
          </p>
        </>
      ) : null}
    </div>
  );
}
