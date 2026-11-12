import type { AgentModel } from "../model/models";
import { Lock } from "../../../shared/ui/icons";

/**
 * Fork (L-259): a Free pill and a lock for models the account's plan can't
 * run. The lock's reason is in the row's title and accessible name.
 */
export function ModelBadges({
  model,
}: {
  model: AgentModel;
}): React.JSX.Element | null {
  if (!model.badge && !model.locked) return null;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
      {model.badge === "free" ? (
        <span className="rounded px-1 py-px text-[10px] font-medium leading-3 text-diff-add-fg ring-1 ring-inset ring-current/30">
          Free
        </span>
      ) : null}
      {model.locked ? (
        <Lock className="size-3 text-content/40" strokeWidth={1.75} />
      ) : null}
    </span>
  );
}
