import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { openPathWithDefaultApp, revealPath } from "../../../platform/tauri/fs";
import { Check, Copy, ExternalLink, File, FolderOpen, Send, X } from "../../../shared/ui/icons";
import { openWebLink } from "../../browser/model/openWebLink";
import { formatFileSize } from "../../files/model/filePreview";
import { LocalMedia } from "../../sessions/ui/LocalMedia";
import { shareCaption, type ShareEntry } from "../model/mobileShare";
import { isShareMedia, shareTime } from "../model/shareView";
import { shareErrorMessage } from "./PhoneStatus";

const ACTION =
  "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-content/55 transition-[background-color,color,transform] duration-100 hover:bg-content/10 hover:text-content active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60";

/** A button whose label briefly says it worked ("Copied", "Sent"). */
function FlashAction({
  icon,
  label,
  done,
  title,
  onRun,
  onError,
}: {
  icon: ReactNode;
  label: string;
  done: string;
  title?: string;
  onRun: () => Promise<void>;
  onError: (error: string) => void;
}): JSX.Element {
  const [flashed, setFlashed] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      title={title}
      onClick={() =>
        void onRun().then(
          () => {
            setFlashed(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setFlashed(false), 1400);
          },
          (reason: unknown) => onError(shareErrorMessage(reason)),
        )
      }
      className={ACTION}
    >
      {flashed ? <Check className="size-3.5" strokeWidth={2} aria-hidden /> : icon}
      <span aria-live="polite">{flashed ? done : label}</span>
    </button>
  );
}

function FileCard({ entry }: { entry: ShareEntry }): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-content/[0.07] text-content/55">
        <File className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-content">{entry.name}</span>
        {entry.size !== undefined ? (
          <span className="block text-[11.5px] tabular-nums text-content/45">{formatFileSize(entry.size)}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Fork (Hari, L-287): one Share item as a chat bubble. From the phone on the
 * left, to the phone on the right; pictures and videos inline, files with
 * Open and Show in folder, links with Open, Open on phone and Copy.
 */
export function ShareBubble({
  entry,
  paired,
  onError,
}: {
  entry: ShareEntry;
  paired: boolean;
  onError: (error: string) => void;
}): JSX.Element {
  const outgoing = entry.direction === "out";
  const path = entry.path;
  const link = entry.kind === "link" ? entry.text?.trim() : undefined;
  const run = (action: () => Promise<void>) => void action().catch((reason: unknown) => onError(shareErrorMessage(reason)));
  const label = entry.name ?? "file";

  const body =
    entry.kind === "file" ? (
      path && isShareMedia(entry) ? (
        <LocalMedia
          path={path}
          label={label}
          onOpen={() => run(() => openPathWithDefaultApp(path))}
          fallback={<FileCard entry={entry} />}
        />
      ) : (
        <FileCard entry={entry} />
      )
    ) : link ? (
      <a
        href={link}
        onClick={(event) => {
          event.preventDefault();
          openWebLink(link);
        }}
        className="break-all text-[13px] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {link}
      </a>
    ) : (
      <span className="block whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-content">{entry.text}</span>
    );

  return (
    <li className={`group flex flex-col ${outgoing ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[min(32rem,85%)] rounded-2xl border px-3 py-2 ${
          outgoing
            ? "rounded-br-md border-accent/25 bg-accent/[0.12]"
            : "rounded-bl-md border-content/10 bg-content/[0.05]"
        }`}
      >
        {body}
      </div>
      <div
        className={`mt-1 flex max-w-full flex-wrap items-center gap-0.5 px-1 ${outgoing ? "flex-row-reverse" : ""}`}
      >
        <span className="px-1 text-[11px] text-content/40">
          <span className="tabular-nums">{shareTime(entry.at)}</span> · {shareCaption(entry)}
        </span>
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          {link ? (
            <>
              <button type="button" onClick={() => openWebLink(link)} className={ACTION}>
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                Open
              </button>
              {paired ? (
                <FlashAction
                  icon={<Send className="size-3.5" strokeWidth={1.75} aria-hidden />}
                  label="Open on phone"
                  done="Sent"
                  title="Opens this link on the phone (or in its notification)"
                  onRun={() => invoke<void>("mobile_share_send_text", { text: link, clipboard: false, open: true })}
                  onError={onError}
                />
              ) : null}
            </>
          ) : null}
          {entry.kind !== "file" && entry.text !== undefined ? (
            <FlashAction
              icon={<Copy className="size-3.5" strokeWidth={1.75} aria-hidden />}
              label="Copy"
              done="Copied"
              onRun={() => copyText(entry.text ?? "")}
              onError={onError}
            />
          ) : null}
          {path ? (
            <>
              <button
                type="button"
                aria-label={`Open ${label}`}
                onClick={() => run(() => openPathWithDefaultApp(path))}
                className={ACTION}
              >
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                Open
              </button>
              <button
                type="button"
                aria-label={`Show ${label} in folder`}
                onClick={() => run(() => revealPath(path))}
                className={ACTION}
              >
                <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
                Show in folder
              </button>
            </>
          ) : null}
          <button
            type="button"
            title="Remove from history (a file stays where it is)"
            aria-label="Remove from history"
            onClick={() => run(() => invoke<void>("mobile_share_remove", { ids: [entry.id] }))}
            className={ACTION}
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </span>
      </div>
    </li>
  );
}
