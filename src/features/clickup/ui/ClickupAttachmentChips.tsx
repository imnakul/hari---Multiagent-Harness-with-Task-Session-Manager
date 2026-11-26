import { useEffect, useState, type JSX } from "react";
import { File as FileIcon, X } from "../../../shared/ui/icons";
import { holdAttachmentPreviewUrl, loadAttachmentPreviewUrl } from "../../sessions/model/attachments";
import { formatFileSize, type ClickupPendingFile } from "../model/clickupUpload";

function Thumbnail({ file }: { file: ClickupPendingFile }): JSX.Element {
  const [url, setUrl] = useState<string | null>(file.previewUrl ?? null);
  useEffect(() => {
    if (file.previewUrl || !file.path || !file.mimeType.startsWith("image/")) return;
    const path = file.path;
    const release = holdAttachmentPreviewUrl(path);
    let alive = true;
    void loadAttachmentPreviewUrl(path).then((loaded) => {
      if (alive) setUrl(loaded);
    });
    return () => {
      alive = false;
      release();
    };
  }, [file.path, file.previewUrl, file.mimeType]);
  return url ? (
    <img src={url} alt="" className="size-7 shrink-0 rounded object-cover" />
  ) : (
    <FileIcon aria-hidden className="size-4 shrink-0 text-content/55" />
  );
}

/** Fork (L-395): the files waiting to upload with a new task, each removable until the task is created. */
export function ClickupAttachmentChips({
  files,
  onRemove,
  disabled,
}: {
  files: readonly ClickupPendingFile[];
  onRemove: (id: string) => void;
  disabled: boolean;
}): JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files to attach" className="flex flex-col gap-1.5">
      {files.map((file) => (
        <li
          key={file.id}
          className="zen-step-in flex items-center gap-2 rounded-md border border-content/10 px-2 py-1.5 text-[12.5px] text-content"
        >
          <Thumbnail file={file} />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 tabular-nums text-content/45">{formatFileSize(file.size)}</span>
          {file.status === "done" ? <span className="shrink-0 text-content/55">Uploaded</span> : null}
          {file.status === "failed" ? (
            <span role="alert" className="shrink-0 text-red-400">
              Didn&apos;t upload
            </span>
          ) : null}
          {file.status === "done" ? null : (
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              title="Remove"
              disabled={disabled}
              className="grid size-6 shrink-0 place-items-center rounded text-content/55 transition-colors hover:bg-content/[0.06] hover:text-content disabled:opacity-40 active:scale-[0.96]"
              onClick={() => onRemove(file.id)}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
