import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState, type JSX } from "react";
import { ChevronLeft, File, Folder, LoaderCircle, RefreshCw } from "../../../shared/ui/icons";
import { formatFileSize } from "../../files/model/filePreview";
import { parsePhoneFolder, type PhoneFolder } from "../model/phoneFiles";
import { SHARE_SMALL_BUTTON, shareErrorMessage } from "./PhoneStatus";

/**
 * Fork (Hari, L-297): the phone's storage, browsed from the computer. Folders
 * open on click; ticked files are sent to the computer and arrive in Share.
 * Needs All files access for Hari on the phone.
 */
export function PhoneFilesView({ onError }: { onError: (error: string) => void }): JSX.Element {
  const [folder, setFolder] = useState<PhoneFolder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [sent, setSent] = useState<number | null>(null);

  const open = useCallback((path: string, offset = 0) => {
    setLoading(true);
    setError(null);
    invoke<unknown>("mobile_phone_files_list", { path, offset })
      .then((raw) => {
        const next = parsePhoneFolder(raw);
        if (!next) throw new Error("The phone sent a list this computer can't read. Update Hari.");
        setFolder((current) =>
          offset > 0 && current && current.path === next.path
            ? { ...next, items: [...current.items, ...next.items] }
            : next,
        );
        if (offset === 0) setPicked([]);
      })
      .catch((reason: unknown) => setError(shareErrorMessage(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => open(""), [open]);

  const send = () => {
    const paths = picked;
    invoke<void>("mobile_phone_files_send", { paths }).then(
      () => {
        setSent(paths.length);
        setPicked([]);
      },
      (reason: unknown) => onError(shareErrorMessage(reason)),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2 text-[12px]">
        <button
          type="button"
          disabled={!folder?.parent || loading}
          aria-label="Up one folder"
          title="Up one folder"
          onClick={() => folder?.parent && open(folder.parent)}
          className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-35"
        >
          <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-content/70" title={folder?.path}>
          {folder ? folder.label : "Phone"}
        </span>
        {loading ? <LoaderCircle className="size-3.5 animate-spin text-content/45" aria-label="Loading" /> : null}
        <button
          type="button"
          aria-label="Refresh"
          title="Refresh"
          disabled={loading}
          onClick={() => open(folder?.path ?? "")}
          className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/10 hover:text-content"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error ? (
          <div role="alert" className="mx-auto mt-10 max-w-xs px-3 text-center text-[12.5px] text-content/60">
            <p>{error}</p>
            <button type="button" onClick={() => open(folder?.path ?? "")} className={`mt-3 ${SHARE_SMALL_BUTTON}`}>
              Try again
            </button>
          </div>
        ) : folder && folder.items.length === 0 ? (
          <p className="mt-10 text-center text-[12.5px] text-content/45">This folder is empty.</p>
        ) : (
          <ul>
            {folder?.items.map((item) => (
              <li key={item.path}>
                {item.dir ? (
                  <button
                    type="button"
                    onClick={() => open(item.path)}
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-content/[0.05]"
                  >
                    <Folder className="size-4 shrink-0 text-accent/80" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-content">{item.name}</span>
                  </button>
                ) : (
                  <label className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-content/[0.05]">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.path)}
                      onChange={(event) =>
                        setPicked((current) =>
                          event.target.checked
                            ? [...current, item.path].slice(0, 50)
                            : current.filter((path) => path !== item.path),
                        )
                      }
                      className="size-3.5 shrink-0 accent-[rgb(var(--accent))]"
                    />
                    <File className="size-4 shrink-0 text-content/45" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-content">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-content/40">{formatFileSize(item.size)}</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
        {folder && folder.items.length < folder.total && !error ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => open(folder.path, folder.items.length)}
            className={`mx-auto my-2 flex ${SHARE_SMALL_BUTTON}`}
          >
            Show more ({folder.total - folder.items.length})
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-stroke px-3 py-2 text-[12px] text-content/55">
        <span className="min-w-0 flex-1 truncate">
          {picked.length
            ? `${picked.length} selected`
            : sent !== null
              ? `Asked the phone for ${sent} file${sent === 1 ? "" : "s"}; they arrive in Share`
              : "Tick files to bring them to this computer"}
        </span>
        <button
          type="button"
          disabled={!picked.length}
          onClick={send}
          className={`${SHARE_SMALL_BUTTON} border-accent/40 bg-accent/15 text-content hover:bg-accent/25`}
        >
          Send to computer
        </button>
      </div>
    </div>
  );
}
