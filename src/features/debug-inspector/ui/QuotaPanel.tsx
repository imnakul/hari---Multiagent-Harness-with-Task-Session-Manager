import { useState, type ReactElement } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { TraceSnapshot } from "../model/trace";
import {
  compareQuota,
  intervalEvents,
  intervalTurnMeasurements,
  localIntervalMeasurements,
} from "../model/analysis";
import { UsageTable } from "./UsageTable";
import type { LocalEvidence } from "../model/evidence";

export function QuotaPanel({
  snapshot,
  local,
}: {
  snapshot: TraceSnapshot;
  local?: LocalEvidence;
}): ReactElement {
  const [account, setAccount] = useState("");
  const [beforeAt, setBeforeAt] = useState("");
  const [afterAt, setAfterAt] = useState("");
  const accounts = [
    ...new Set(
      snapshot.quotas.map((row) => `${row.provider}:${row.accountId}`),
    ),
  ];
  const selectedAccount = account || accounts[0];
  const readings = snapshot.quotas.filter(
    (row) => `${row.provider}:${row.accountId}` === selectedAccount,
  );
  const before =
    readings.find((row) => `${row.at}` === beforeAt) ?? readings[0];
  const after =
    readings.find((row) => `${row.at}` === afterAt) ??
    readings[readings.length - 1];
  const comparisons = before && after ? compareQuota(before, after) : [];
  const events =
    before && after ? intervalEvents(snapshot.events, before, after) : [];
  const historical =
    local && before && after
      ? localIntervalMeasurements(local, before, after)
      : [];
  const options = readings.map((row) => ({
    value: `${row.at}`,
    label: new Date(row.at).toLocaleString(),
  }));
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-content/55">
        Only quota readings already obtained by normal MonoCode activity appear
        here. The inspector never refreshes provider quota. Compare two
        observations for the same account and reset window.
      </p>
      {!readings.length ? (
        <p className="rounded-lg border border-dashed border-content/15 p-6 text-sm text-content/45">
          No successful cached quota readings observed. Normal account usage
          controls may provide readings later; the inspector will not request
          them.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <SearchableSelect
              label="Quota account"
              value={selectedAccount ?? ""}
              onChange={(value) => {
                setAccount(value);
                setBeforeAt("");
                setAfterAt("");
              }}
              options={accounts.map((value) => ({ value, label: value }))}
            />
            <SearchableSelect
              label="From observation"
              value={before ? `${before.at}` : ""}
              onChange={setBeforeAt}
              options={options}
            />
            <SearchableSelect
              label="To observation"
              value={after ? `${after.at}` : ""}
              onChange={setAfterAt}
              options={options}
            />
          </div>
          {!comparisons.length ? (
            <p className="text-sm text-content/55">
              Choose two distinct observations in chronological order.{" "}
              {readings.length} readings retained.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-content/10">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">
                    Account-wide quota comparison
                  </caption>
                  <thead className="bg-content/5 text-content/50">
                    <tr>
                      {[
                        "Window",
                        "Remaining before",
                        "Remaining after",
                        "Used change",
                      ].map((label) => (
                        <th className="px-3 py-2 font-medium" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisons.map((row) => (
                      <tr key={row.name} className="border-t border-content/10">
                        <th className="px-3 py-2 font-normal">{row.name}</th>
                        <td className="px-3 py-2 tabular-nums">
                          {row.beforeRemaining.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {row.afterRemaining.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2">
                          {row.usedChange === undefined
                            ? row.limitation
                            : `${row.usedChange.toFixed(1)} percentage points`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-content/50">
                {events.filter((event) => event.kind === "submission").length}{" "}
                submissions ·{" "}
                {events.filter((event) => event.kind === "dispatch").length}{" "}
                dispatches ·{" "}
                {events.filter((event) => event.kind === "response").length}{" "}
                response observations recorded inside this interval. Aggregate
                usage below requires a settled operation with covered start and
                end; cross-boundary or missing lifecycle evidence is excluded.
              </p>
              <UsageTable
                measurements={
                  before && after
                    ? intervalTurnMeasurements(snapshot.events, before, after)
                    : []
                }
                aggregate
              />
              {local ? (
                <section className="space-y-3 border-t border-content/10 pt-4">
                  <h2 className="text-sm font-semibold text-content">
                    Historical local evidence in this interval
                  </h2>
                  <p className="text-xs leading-relaxed text-content/50">
                    {local.source} · native session {local.nativeId} · account{" "}
                    {local.accountId}. This is shown separately from live
                    totals. Only matching-account records with provider
                    timestamps can be placed in the interval; missing timestamps
                    remain unavailable. File and retention limits may omit
                    activity. Codex cumulative snapshots overlap and are never
                    summed.
                  </p>
                  <UsageTable
                    measurements={historical}
                    aggregate={local.provider === "claude"}
                  />
                </section>
              ) : null}
            </>
          )}
        </>
      )}
      <div className="rounded-lg bg-content/5 p-4 text-xs leading-relaxed text-content/60">
        <strong className="text-content/80">Interpretation limits</strong>
        <p className="mt-1">
          Reported tokens and cache usage describe observed execution. Quota
          percentages describe the whole account. Other applications/devices,
          hidden CLI retries and provider-side subscription weighting are
          unavailable. A percentage change cannot establish exact per-session
          billing or causation. Possible explanations include helpers,
          compaction, additional tools and repeated cache creation; investigate
          trace evidence before drawing a conclusion.
        </p>
      </div>
    </div>
  );
}
