import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";
import { Paperclip, X } from "../../../shared/ui/icons";
import {
  headerEntries,
  shortUrl,
  textualMime,
  type ConsoleRow,
  type NetworkRow,
} from "../model/browserContext";

export type ResponseBody = { body: string; base64Encoded?: boolean };

/** What the Response tab shows for one request. */
type BodyState =
  | { state: "loading" }
  | { state: "ready"; body: ResponseBody }
  | { state: "gone" };

/** Responses past this are shown cut; the full text is still in the page. */
const SHOWN_BODY_CHARS = 200_000;

const ICON_BUTTON =
  "grid size-6 shrink-0 place-items-center rounded-md text-content/50 transition-colors duration-100 hover:bg-content/10 hover:text-content";

/**
 * Fork (L-222): the details of one console message or request, beside the
 * list (over it when the panel is narrow). Headers are shown here only; they
 * never go into a chat note, since they can hold cookies and tokens.
 */
function DetailsFrame({
  title,
  onAttach,
  onClose,
  children,
}: {
  title: string;
  onAttach: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Details"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="absolute inset-0 z-10 flex min-w-0 flex-col bg-surface @[560px]:static @[560px]:w-[55%] @[560px]:shrink-0 @[560px]:border-l @[560px]:border-stroke"
    >
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-stroke pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-content/80" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={onAttach}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-content/60 transition-colors duration-100 hover:bg-content/10 hover:text-content"
        >
          <Paperclip aria-hidden className="size-3.5" />
          Add to chat
        </button>
        <button type="button" aria-label="Close details" title="Close (Esc)" onClick={onClose} className={ICON_BUTTON}>
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      {children}
    </section>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-content/45">{name}</dt>
      <dd className="min-w-0 select-text whitespace-pre-wrap break-all text-content/85">{children}</dd>
    </>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-1.5">
      {children}
    </dl>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-t border-stroke px-3 pb-0.5 pt-1.5 font-sans text-[11px] font-medium text-content/55 first:border-t-0">
      {children}
    </h3>
  );
}

function HeaderList({ headers }: { headers?: Record<string, string> }) {
  const entries = headerEntries(headers);
  if (!entries.length) return <p className="px-3 py-1 font-sans text-content/45">Not captured for this request.</p>;
  return (
    <Fields>
      {entries.map(([name, value]) => (
        <Field key={name} name={name}>
          {value}
        </Field>
      ))}
    </Fields>
  );
}

export function ConsoleDetails({
  row,
  pageUrl,
  onAttach,
  onClose,
}: {
  row: ConsoleRow;
  pageUrl: string;
  onAttach: () => void;
  onClose: () => void;
}) {
  return (
    <DetailsFrame title={`Console ${row.level}`} onAttach={onAttach} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11.5px]">
        <pre className="select-text whitespace-pre-wrap break-words px-3 py-2 text-content/85">{row.text}</pre>
        <Heading>Where</Heading>
        <Fields>
          <Field name="Source">{row.source || "Not given"}</Field>
          <Field name="Page">{pageUrl}</Field>
        </Fields>
      </div>
    </DetailsFrame>
  );
}

type RequestTab = "headers" | "payload" | "response";

export function RequestDetails({
  row,
  browserTab,
  onAttach,
  onClose,
}: {
  row: NetworkRow;
  browserTab: number;
  onAttach: (body: ResponseBody | null) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<RequestTab>("headers");
  const [body, setBody] = useState<BodyState | null>(null);
  const tabs: RequestTab[] = row.postData ? ["headers", "payload", "response"] : ["headers", "response"];
  const shown = tabs.includes(view) ? view : "headers";
  const canFetch = row.done && !row.error && textualMime(row.mimeType);

  useEffect(() => {
    if (shown !== "response" || !canFetch || body) return;
    let live = true;
    setBody({ state: "loading" });
    invoke<ResponseBody>("browser_response_body", { tab: browserTab, requestId: row.id })
      .then((result) => live && setBody({ state: "ready", body: result }))
      .catch(() => live && setBody({ state: "gone" }));
    return () => {
      live = false;
    };
    // `body` is left out on purpose: setting it must not start another fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, canFetch, row.id, browserTab]);

  const status = row.error
    ? `Failed: ${row.error}`
    : row.status != null
      ? `${row.status}${row.statusText ? ` ${row.statusText}` : ""}`
      : "Pending";

  return (
    <DetailsFrame
      title={`${row.method} ${shortUrl(row.url, 120)}`}
      onAttach={() => onAttach(body?.state === "ready" ? body.body : null)}
      onClose={onClose}
    >
      <div role="tablist" aria-label="Request details" className="flex h-7 shrink-0 items-center gap-1 border-b border-stroke px-2">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={shown === name}
            onClick={() => setView(name)}
            className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors duration-100 ${
              shown === name ? "bg-content/10 text-content" : "text-content/55 hover:text-content"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto font-mono text-[11.5px]">
        {shown === "headers" ? (
          <>
            <Heading>General</Heading>
            <Fields>
              <Field name="URL">{row.url}</Field>
              <Field name="Method">{row.method}</Field>
              <Field name="Status">{status}</Field>
              {row.type ? <Field name="Type">{row.type}</Field> : null}
              {row.mimeType ? <Field name="Content type">{row.mimeType}</Field> : null}
              {row.size != null ? <Field name="Size">{`${row.size} bytes`}</Field> : null}
            </Fields>
            <Heading>Response headers</Heading>
            <HeaderList headers={row.responseHeaders} />
            <Heading>Request headers</Heading>
            <HeaderList headers={row.requestHeaders} />
          </>
        ) : shown === "payload" ? (
          <pre className="select-text whitespace-pre-wrap break-all px-3 py-2 text-content/85">
            {prettyText(row.postData ?? "")}
          </pre>
        ) : (
          <ResponseView row={row} body={body} canFetch={canFetch} />
        )}
      </div>
    </DetailsFrame>
  );
}

function ResponseView({ row, body, canFetch }: { row: NetworkRow; body: BodyState | null; canFetch: boolean }) {
  const note = (text: string) => <p className="px-3 py-2 font-sans text-content/45">{text}</p>;
  if (row.error) return note(`The request failed (${row.error}), so there is no response.`);
  if (!row.done) return note("Still loading…");
  if (!canFetch) {
    return note(
      `This response isn't text${row.mimeType ? ` (${row.mimeType})` : ""}, so it isn't shown here.`,
    );
  }
  if (!body || body.state === "loading") return note("Loading the response…");
  if (body.state === "gone") {
    return note("The response is no longer available. The page may have moved on; reload it to capture it again.");
  }
  if (body.body.base64Encoded) return note("The response is binary, so it isn't shown here.");
  const text = prettyText(body.body.body);
  if (!text) return note("The response is empty.");
  return (
    <pre className="select-text whitespace-pre-wrap break-all px-3 py-2 text-content/85">
      {text.length > SHOWN_BODY_CHARS
        ? `${text.slice(0, SHOWN_BODY_CHARS)}\n… (${text.length - SHOWN_BODY_CHARS} more characters not shown)`
        : text}
    </pre>
  );
}

/** JSON indented for reading; anything else as it came. */
function prettyText(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
