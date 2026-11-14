import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState, type JSX } from "react";
import { Copy, ExternalLink, File, Paperclip, Send, X } from "../../../shared/ui/icons";
import { isImagePath } from "../../files/model/filePreview";
import { filesFromClipboard, readBlobBase64 } from "../../sessions/model/attachments";
import { SHARE_SMALL_BUTTON } from "./PhoneStatus";

/**
 * Pasted files exist only in memory: each is saved like a pasted chat
 * attachment first, then sent from that path.
 *
 * @throws when a file is over the paste limit or can't be saved.
 */
async function savePastedFiles(files: readonly File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const file of files) {
    const data = await readBlobBase64(file);
    if (data === null) throw new Error(`${file.name || "That file"} is too big to paste. Use Files… instead.`);
    paths.push(await invoke<string>("write_attachment", { name: file.name || "pasted-file", data }));
  }
  return paths;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const isWebLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * Fork (Hari, L-287, L-290): Share's composer. Files (picked, pasted or
 * dropped) wait above the box with an × until Send, which sends them as one
 * group with the typed text as their caption. Enter sends, Shift+Enter adds a
 * line. A lone web link can also be sent and opened on the phone.
 */
export function ShareComposer({
  busy,
  attempt,
  staged,
  onStage,
}: {
  busy: boolean;
  /** Runs one send with the panel's busy and error handling; resolves false when it failed. */
  attempt: (action: () => Promise<void>) => Promise<boolean>;
  /** Files waiting to be sent (owned by the panel, so drops land here too). */
  staged: readonly string[];
  onStage: (paths: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const hasDraft = draft.trim().length > 0;
  const canSend = hasDraft || staged.length > 0;
  const link = staged.length === 0 && isWebLink(draft);

  const send = (mode: "send" | "clipboard" | "open") => {
    if (!canSend || busy) return;
    const text = draft;
    const paths = [...staged];
    void attempt(async () => {
      if (paths.length) {
        await invoke<void>("mobile_share_send_files", { paths, caption: text.trim() ? text : null });
      } else {
        await invoke<void>("mobile_share_send_text", {
          text,
          clipboard: mode === "clipboard",
          open: mode === "open",
        });
      }
    }).then((sent) => {
      if (!sent) return;
      setDraft((current) => (current === text ? "" : current));
      if (paths.length) onStage([]);
    });
  };

  const pickFiles = () =>
    void attempt(async () => {
      const picked = await openDialog({ multiple: true, directory: false, title: "Send to your phone" });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      if (paths.length) onStage([...staged, ...paths.filter((path) => !staged.includes(path))]);
    });

  return (
    <div className="shrink-0 border-t border-stroke p-2.5">
      <div className="rounded-xl border border-content/10 bg-content/[0.03] transition-colors focus-within:border-accent/50">
        {staged.length ? (
          <ul aria-label="Files to send" className="flex flex-wrap gap-1.5 px-2 pt-2">
            {staged.map((path) => (
              <li
                key={path}
                title={path}
                className="flex h-7 max-w-[12rem] items-center gap-1.5 rounded-lg bg-content/[0.07] pl-2 pr-0.5 text-[12px] text-content/80"
              >
                <File
                  className={`size-3.5 shrink-0 ${isImagePath(path) ? "text-accent" : "text-content/50"}`}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{fileName(path)}</span>
                <button
                  type="button"
                  aria-label={`Don't send ${fileName(path)}`}
                  onClick={() => onStage(staged.filter((item) => item !== path))}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
                >
                  <X className="size-3" strokeWidth={1.75} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send("send");
          }}
          onPaste={(event) => {
            const files = filesFromClipboard(event.clipboardData);
            if (files.length === 0 || busy) return;
            event.preventDefault();
            void attempt(async () => {
              const paths = await savePastedFiles(files);
              onStage([...staged, ...paths]);
            });
          }}
          rows={2}
          aria-label={staged.length ? "Caption" : "Text or a link for your phone"}
          placeholder={staged.length ? "Add a caption" : "Text or a link. Paste or drop files to attach them."}
          className="block max-h-40 min-h-[3.25rem] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-content placeholder:text-content/40 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          <button
            type="button"
            disabled={busy}
            title="Attach files"
            aria-label="Attach files"
            onClick={pickFiles}
            className={SHARE_SMALL_BUTTON}
          >
            <Paperclip className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            disabled={busy}
            title="Put this computer's clipboard on the phone's clipboard"
            onClick={() => void attempt(() => invoke<void>("mobile_share_send_clipboard"))}
            className={SHARE_SMALL_BUTTON}
          >
            <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
            Clipboard
          </button>
          <span className="ml-auto flex items-center gap-1">
            {link ? (
              <button
                type="button"
                disabled={busy}
                title="Send the link and open it on the phone"
                onClick={() => send("open")}
                className={SHARE_SMALL_BUTTON}
              >
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                Open there
              </button>
            ) : hasDraft && !staged.length ? (
              <button
                type="button"
                disabled={busy}
                title="Put this text on the phone's clipboard"
                onClick={() => send("clipboard")}
                className={SHARE_SMALL_BUTTON}
              >
                To clipboard
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || !canSend}
              title="Send (Enter)"
              onClick={() => send("send")}
              className={`${SHARE_SMALL_BUTTON} border-accent/40 bg-accent/15 text-content hover:bg-accent/25`}
            >
              <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
              Send
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
