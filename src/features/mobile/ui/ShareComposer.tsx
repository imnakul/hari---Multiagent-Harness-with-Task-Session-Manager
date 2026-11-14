import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState, type JSX } from "react";
import { Copy, Paperclip, Send } from "../../../shared/ui/icons";
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

/**
 * Fork (Hari, L-287): the Share view's composer. Enter sends, Shift+Enter
 * adds a line; pasting a picture or file sends it straight away.
 */
export function ShareComposer({
  busy,
  attempt,
}: {
  busy: boolean;
  /** Runs one send with the view's busy and error handling; resolves false when it failed. */
  attempt: (action: () => Promise<void>) => Promise<boolean>;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const hasDraft = draft.trim().length > 0;

  const sendDraft = (clipboard: boolean) => {
    if (!hasDraft || busy) return;
    const text = draft;
    void attempt(() => invoke<void>("mobile_share_send_text", { text, clipboard })).then((sent) => {
      if (sent) setDraft((current) => (current === text ? "" : current));
    });
  };

  const pickFiles = () =>
    void attempt(async () => {
      const picked = await openDialog({ multiple: true, directory: false, title: "Send to your phone" });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      if (paths.length) await invoke<void>("mobile_share_send_files", { paths });
    });

  return (
    <div className="shrink-0 border-t border-stroke p-3">
      <div className="rounded-xl border border-content/10 bg-content/[0.03] transition-colors focus-within:border-accent/50">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            sendDraft(false);
          }}
          onPaste={(event) => {
            const files = filesFromClipboard(event.clipboardData);
            if (files.length === 0 || busy) return;
            event.preventDefault();
            void attempt(async () => {
              const paths = await savePastedFiles(files);
              await invoke<void>("mobile_share_send_files", { paths });
            });
          }}
          rows={2}
          aria-label="Text or a link for your phone"
          placeholder="Text or a link for your phone. Paste or drop files to send them."
          className="block max-h-40 min-h-[3.25rem] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-content placeholder:text-content/40 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          <button type="button" disabled={busy} onClick={pickFiles} className={SHARE_SMALL_BUTTON}>
            <Paperclip className="size-3.5" strokeWidth={1.75} aria-hidden />
            Files…
          </button>
          <button
            type="button"
            disabled={busy}
            title="Put this computer's clipboard on the phone's clipboard"
            onClick={() => void attempt(() => invoke<void>("mobile_share_send_clipboard"))}
            className={SHARE_SMALL_BUTTON}
          >
            <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
            Send clipboard
          </button>
          <button
            type="button"
            disabled={busy || !hasDraft}
            title="Put this text on the phone's clipboard"
            onClick={() => sendDraft(true)}
            className={`ml-auto ${SHARE_SMALL_BUTTON}`}
          >
            To clipboard
          </button>
          <button
            type="button"
            disabled={busy || !hasDraft}
            title="Send (Enter)"
            onClick={() => sendDraft(false)}
            className={`${SHARE_SMALL_BUTTON} border-accent/40 bg-accent/15 text-content hover:bg-accent/25`}
          >
            <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
