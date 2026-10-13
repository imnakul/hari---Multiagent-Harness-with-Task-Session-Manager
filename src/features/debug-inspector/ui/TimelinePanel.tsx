import { useState, type ReactElement } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import type { TraceEvent, UsageScope } from "../model/trace";
import { UsageTable } from "./UsageTable";

export function TimelinePanel({
  allEvents,
}: {
  allEvents: readonly TraceEvent[];
}): ReactElement {
  const [provider, setProvider] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<UsageScope>("turn");
  const [selectedId, setSelectedId] = useState("");
  const events = allEvents.filter(
    (event) =>
      (!provider || event.provider === provider) &&
      (!kind || event.kind === kind),
  );
  const selected = events.find((event) => event.id === selectedId);
  const providers = [...new Set(allEvents.map((event) => event.provider))];
  const kinds = [...new Set(allEvents.map((event) => event.kind))].sort();
  const usage = events.flatMap((event) =>
    event.usage?.scope === scope ? [event.usage] : [],
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <SearchableSelect
          label="Trace provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "", label: "All providers" },
            ...providers.map((value) => ({ value, label: value })),
          ]}
          variant="pill"
        />
        <SearchableSelect
          label="Event type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "", label: "All event types" },
            ...kinds.map((value) => ({ value, label: value })),
          ]}
          variant="pill"
        />
      </div>
      <div className="max-h-96 overflow-auto overscroll-contain rounded-lg border border-content/10">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">
            Correlated diagnostic event timeline
          </caption>
          <thead className="sticky top-0 bg-panel text-content/50">
            <tr>
              {["Time", "Event", "Provider / purpose", "Activity", "State"].map(
                (label) => (
                  <th
                    key={label}
                    className="whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-content/10">
            {events
              .slice(-200)
              .reverse()
              .map((event) => (
                <tr
                  key={event.id}
                  className={
                    selectedId === event.id
                      ? "bg-selection-strong"
                      : "hover:bg-content/5"
                  }
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-content/45">
                    {new Date(event.at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-pressed={selectedId === event.id}
                      className="whitespace-nowrap text-content/80 underline decoration-content/20 underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => setSelectedId(event.id)}
                    >
                      {event.kind}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-content/65">
                    {event.provider}
                    <span className="block text-content/40">
                      {event.purpose}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-content/55">
                    {event.activity}
                  </td>
                  <td className="px-3 py-2 text-content/55">
                    {event.state ?? "Observed"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!events.length ? (
          <p className="p-6 text-sm text-content/45">No matching events.</p>
        ) : null}
      </div>
      <p className="text-xs text-content/40">
        Latest 200 matching events shown. Select a row for correlation and
        source. Replays update the same record within the bounded identity
        horizon.
      </p>
      {selected ? <EventDetails event={selected} /> : null}
      <SearchableSelect
        label="Live usage scope"
        value={scope}
        onChange={(value) => {
          const next = (
            [
              "message",
              "turn",
              "session-cumulative",
              "sdk-result",
              "last-response",
            ] as const
          ).find((scope) => scope === value);
          if (next) setScope(next);
        }}
        options={[
          "message",
          "turn",
          "session-cumulative",
          "sdk-result",
          "last-response",
        ].map((value) => ({ value, label: value }))}
        variant="pill"
      />
      <UsageTable
        measurements={usage}
        aggregate={scope === "message" || scope === "turn"}
      />
    </div>
  );
}

function EventDetails({ event }: { event: TraceEvent }): ReactElement {
  const fields = [
    ["Source", event.source],
    ["Session", event.sessionId],
    ["Native session", event.nativeId],
    ["Account", event.accountId],
    ["Submission", event.submissionId],
    ["Dispatch", event.attemptId],
    ["Turn", event.turnId],
    ["Process", event.processId],
    ["Deduplication identity", event.identity],
    ["Observed response / item ID", event.responseId],
    ["Provider turn ID", event.providerTurnId],
    ["Observed request ID", event.requestId],
    ["Authorship", event.authorship],
    ["Model", event.model],
    ["Effort", event.effort],
    [
      "Known settings",
      event.settings ? JSON.stringify(event.settings) : undefined,
    ],
    ["Context used", event.contextUsed?.toLocaleString()],
    ["Context window", event.contextWindow?.toLocaleString()],
    ["Runtime mode", event.runtimeMode],
    ["Tool category", event.toolName],
    [
      "Duration",
      event.durationMs === undefined ? undefined : `${event.durationMs} ms`,
    ],
    ["Last observed", new Date(event.updatedAt).toLocaleString()],
  ];
  return (
    <section className="rounded-lg border border-content/10 p-4">
      <h2 className="mb-3 text-sm font-semibold text-content">Event details</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-content/40">{label}</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-content/75">
              {value ?? "Unknown"}
            </dd>
          </div>
        ))}
      </dl>
      {event.usage ? (
        <div className="mt-4">
          <UsageTable measurements={[event.usage]} />
        </div>
      ) : null}
    </section>
  );
}
