import type { SessionSummary } from "@/features/workspace/types";

/**
 * Fork (Hari, L-368): the model's name with the account after it, as the
 * desktop's card shows it ("Opus 5.5 · Work"). The desktop names the account
 * only when its provider has two or more, and an older desktop never does.
 */
export function sessionModelLabel(
  session: Pick<SessionSummary, "model" | "modelName" | "accountName">,
): string {
  const model = session.modelName || session.model;
  if (!session.accountName) return model;
  return model ? `${model} · ${session.accountName}` : session.accountName;
}
