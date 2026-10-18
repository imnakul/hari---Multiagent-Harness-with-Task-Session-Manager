import { useState, type ReactElement } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Loader } from "../../../shared/ui/icons";
import { REWIND_NOTE, continueCostNote } from "../model/continueOnAccount";

type Props = {
  accountLabel: string;
  /** Why Continue here is unavailable (busy, live process). */
  blockedReason: string | null;
  onContinue: () => Promise<void>;
  onNewChat: () => void;
  onClose: () => void;
};

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium disabled:opacity-40";

export function ContinueOnAccountDialog({
  accountLabel,
  blockedReason,
  onContinue,
  onNewChat,
  onClose,
}: Props): ReactElement {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    if (copying) return;
    setCopying(true);
    setError(null);
    try {
      await onContinue();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCopying(false);
    }
  };
  return (
    <Modal
      title={`Continue this chat on ${accountLabel}?`}
      onClose={() => {
        if (!copying) onClose();
      }}
      size="sm"
    >
      <div className="flex flex-col gap-3 p-4" aria-busy={copying}>
        <p className="text-[12px] leading-5 text-content/70">
          {continueCostNote(accountLabel)}
        </p>
        <details>
          <summary className="cursor-pointer text-[11px] text-content/45">
            Details
          </summary>
          <p className="mt-1 text-[11px] leading-4 text-content/45">
            The original chat stays on the old account. {REWIND_NOTE}
          </p>
        </details>
        {blockedReason || error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {blockedReason ?? error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={copying}
            onClick={onNewChat}
            className={`${BUTTON} text-content/70 hover:bg-content/10`}
          >
            New chat
          </button>
          <button
            type="button"
            disabled={copying || !!blockedReason}
            onClick={() => void run()}
            className={`${BUTTON} bg-content text-background-base hover:bg-content/80`}
          >
            {copying ? (
              <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            {copying ? "Copying…" : "Continue here"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
