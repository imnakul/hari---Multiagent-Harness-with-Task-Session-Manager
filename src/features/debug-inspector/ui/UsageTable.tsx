import type { ReactElement } from "react";
import type { UsageMeasurement } from "../model/trace";
import { totalUsage } from "../model/analysis";

export function countLabel(value: number | undefined): string {
  return value === undefined ? "Unknown" : value.toLocaleString();
}
const COLUMNS = [
  ["uncachedInput", "Uncached input"],
  ["input", "Inclusive input"],
  ["output", "Output"],
  ["cacheRead", "Cache read"],
  ["cacheWrite", "Cache write"],
  ["cacheWrite5m", "Write · 5m TTL"],
  ["cacheWrite1h", "Write · 1h TTL"],
  ["reasoning", "Reasoning"],
  ["costUsd", "Reported USD"],
] as const;

export function UsageTable({
  measurements,
  aggregate = false,
}: {
  measurements: readonly UsageMeasurement[];
  aggregate?: boolean;
}): ReactElement {
  if (!measurements.length)
    return (
      <p className="py-6 text-sm text-content/45">
        No reported usage in this scope. Missing fields remain unknown.
      </p>
    );
  const totals = aggregate ? totalUsage(measurements) : undefined;
  const writes = measurements.filter((row) => (row.cacheWrite ?? 0) > 0).length;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-content/50">
        {writes} records report cache writes. Cache reuse can be compared only
        where reads and writes are reported. Repeated writes do not prove a
        cache miss. Codex inclusive input already contains cache reads; Claude
        raw input is uncached. Reasoning and TTL counters are subsets.
      </p>
      <div className="overflow-x-auto rounded-lg border border-content/10">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            Reported usage by measurement identity and scope
          </caption>
          <thead className="bg-content/5 text-content/50">
            <tr>
              <th className="px-3 py-2 font-medium">Identity / scope</th>
              {COLUMNS.map(([key, label]) => (
                <th
                  key={key}
                  className="whitespace-nowrap px-3 py-2 font-medium"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-content/10">
            {totals ? (
              <tr className="bg-content/3 font-medium">
                <th className="px-3 py-2">Sum of this scope only</th>
                {COLUMNS.map(([key]) => (
                  <td key={key} className="px-3 py-2 tabular-nums">
                    {countLabel(totals[key])}
                  </td>
                ))}
              </tr>
            ) : null}
            {measurements.slice(-100).map((row, index) => (
              <tr key={`${row.identity}:${index}`}>
                <th className="max-w-52 break-all px-3 py-2 font-normal">
                  <span className="font-mono text-content/70">
                    {row.identity}
                  </span>
                  <span className="block text-content/40">
                    {row.scope}
                    {row.model ? ` · ${row.model}` : ""}
                    {row.timestamp
                      ? ` · ${new Date(row.timestamp).toLocaleString()}`
                      : ""}
                  </span>
                </th>
                {COLUMNS.map(([key]) => (
                  <td
                    key={key}
                    className="whitespace-nowrap px-3 py-2 tabular-nums text-content/65"
                  >
                    {countLabel(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {measurements.length > 100 ? (
        <p className="text-xs text-content/45">
          Latest 100 rows shown; selected-scope totals include all retained
          records.
        </p>
      ) : null}
    </div>
  );
}
