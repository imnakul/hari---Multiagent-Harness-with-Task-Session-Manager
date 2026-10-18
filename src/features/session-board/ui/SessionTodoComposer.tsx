import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { QuickComposer } from "../../quick-composer/ui/QuickComposer";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";

const onShown = (): void => {};

/**
 * The shared composer in a modal, without the Task | Session switch. Used by
 * Session Manager ("Add Draft to Sessions", "Edit Draft") and by Task Manager
 * ("Work on…", prefilled from the task). Save to Draft keeps the session in
 * Session Manager; Start (with `onStart`) starts it now.
 */
export function SessionTodoComposer({
  initialLaunch,
  editing,
  title,
  description = "Save to Draft keeps it in Session Manager to start later. Start begins the session now.",
  onSave,
  onStart,
  onClose,
}: {
  initialLaunch: QuickLaunch;
  editing?: boolean;
  /** Modal title; defaults to the Session Manager wording. */
  title?: string;
  description?: string;
  onSave: (launch: QuickLaunch) => Promise<void>;
  /** Start the session now; `reveal` also opens it (Ctrl+Enter). */
  onStart?: (launch: QuickLaunch, reveal: boolean) => Promise<void>;
  onClose: () => void;
}): ReactNode {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    if (!saving.current) onClose();
  }, [onClose]);
  // One write at a time; the modal closes only after it succeeds, so a
  // failure stays visible in the composer with the prompt intact.
  const run = async (write: () => Promise<void>): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await write();
      onClose();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title ?? (editing ? "Edit Draft" : "Add Draft to Sessions")}
      description={description}
      onClose={close}
      // At least the floating composer's 680px, so its toolbar fits as it does there.
      size="lg"
      fitViewport
    >
      <div className="p-3" aria-busy={busy}>
        <QuickComposer
          onShown={onShown}
          initialLaunch={initialLaunch}
          onSubmitLaunch={(launch) => run(() => onSave(launch))}
          onStartLaunch={
            onStart
              ? (launch, reveal) => run(() => onStart(launch, reveal))
              : undefined
          }
          onDismiss={close}
          submitLabel={editing ? "Save changes" : "Save to Draft"}
        />
      </div>
    </Modal>
  );
}
