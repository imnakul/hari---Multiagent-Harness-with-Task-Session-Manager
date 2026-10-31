import { useState, type ReactElement } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SegmentedSwitch } from "../../../shared/ui/SegmentedSwitch";
import { Loader } from "../../../shared/ui/icons";
import { CONTINUE_PRESETS, type ContinuePreset } from "../../sessions/model/continueCard";
import { REWIND_NOTE, continueCostNote } from "../model/continueOnAccount";

/** Card presets offered when switching account; Thorough stays in the Continue menu. */
export type AccountCardPreset = Extract<ContinuePreset, "quick" | "balanced">;
const CARD_PRESETS = CONTINUE_PRESETS.filter(
  (preset): preset is (typeof CONTINUE_PRESETS)[number] & { id: AccountCardPreset } =>
    preset.id === "quick" || preset.id === "balanced",
);

type Props = {
  accountLabel: string;
  /** Why Continue here is unavailable (busy, live process). */
  blockedReason: string | null;
  /** Claude chats with a native transcript can be copied (L-102). Default true. */
  canContinueHere?: boolean;
  onContinue: () => Promise<void>;
  /** New chat beside with a context card (fork, L-200). Absent: not offered. */
  onCard?: (preset: AccountCardPreset) => void;
  onNewChat: () => void;
  onClose: () => void;
};

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors duration-100 disabled:opacity-40";

/** Asked each time a started chat switches account (L-102; card option L-200). */
export function ContinueOnAccountDialog({
  accountLabel,
  blockedReason,
  canContinueHere = true,
  onContinue,
  onCard,
  onNewChat,
  onClose,
}: Props): ReactElement {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<AccountCardPreset>("quick");
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
  const hint = CARD_PRESETS.find((option) => option.id === preset)?.hint;
  return (
    <Modal
      title={`Continue this chat on ${accountLabel}?`}
      onClose={() => {
        if (!copying) onClose();
      }}
      size="sm"
    >
      <div className="flex flex-col gap-3 p-4" aria-busy={copying}>
        {canContinueHere ? (
          <>
            <p className="text-[12px] leading-5 text-content/70">
              <span className="text-content">Continue here</span> keeps this chat and its
              history. {continueCostNote(accountLabel)}
            </p>
            <details>
              <summary className="cursor-pointer text-[11px] text-content/45">
                Details
              </summary>
              <p className="mt-1 text-[11px] leading-4 text-content/45">
                The original chat stays on the old account. {REWIND_NOTE}
              </p>
            </details>
          </>
        ) : (
          <p className="text-[12px] leading-5 text-content/70">
            This chat's history belongs to its current account, so it can't move. Start a new
            chat on {accountLabel}, with a short card about this one or empty.
          </p>
        )}
        {onCard ? (
          <div className="flex flex-col gap-1">
            <SegmentedSwitch<AccountCardPreset>
              ariaLabel="Context card"
              options={CARD_PRESETS}
              value={preset}
              onChange={setPreset}
            />
            {hint ? <p className="text-[11px] leading-4 text-content/50">{hint}</p> : null}
          </div>
        ) : null}
        {(canContinueHere && blockedReason) || error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {error ?? blockedReason}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={copying}
            onClick={onNewChat}
            className={`${BUTTON} text-content/70 hover:bg-content/10`}
          >
            Empty new chat
          </button>
          {onCard ? (
            <button
              type="button"
              disabled={copying}
              onClick={() => onCard(preset)}
              className={`${BUTTON} ${
                canContinueHere
                  ? "text-content/80 ring-1 ring-inset ring-content/15 hover:bg-content/10"
                  : "bg-content text-background-base hover:bg-content/80"
              }`}
            >
              Continue with card
            </button>
          ) : null}
          {canContinueHere ? (
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
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
