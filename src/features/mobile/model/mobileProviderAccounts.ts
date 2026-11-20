import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountExists,
  providerAccounts,
  selectedProviderAccountId,
  supportsAccountProfiles,
} from "../../providers/model/providerAccounts";
import type { HarnessId, Session } from "../../sessions/model/session";
import { sessionAccountLabel } from "../../sessions/ui/useCompactModelLabels";

const PROVIDERS = ["claude", "codex"] as const;

/** Only profile names and IDs cross the mobile link; credentials stay on desktop. */
export function mobileProviderAccounts(project: string) {
  return {
    accounts: PROVIDERS.flatMap((provider) => providerAccounts(provider)),
    selectedAccounts: Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider,
        selectedProviderAccountId(provider, project),
      ]),
    ),
  };
}

export function mobileSessionAccountId(session: Session): string | undefined {
  if (!supportsAccountProfiles(session.harness)) return undefined;
  return (
    session.providerAccountId ??
    (session.blocks.some((block) => block.role === "user")
      ? DEFAULT_PROVIDER_ACCOUNT_ID
      : selectedProviderAccountId(session.harness, session.cwd))
  );
}

/**
 * Fork (L-368): the account name the phone's session list shows beside the
 * model, as the desktop's card does: only when the provider has two or more
 * accounts, so a single-account setup looks as before.
 */
export function mobileSessionAccountName(
  harness: HarnessId,
  accountId: string | undefined,
): { accountName?: string } {
  const label = sessionAccountLabel({ harness, providerAccountId: accountId });
  return label ? { accountName: label } : {};
}

/** Validate against the final provider, including when the phone changes models. */
export function mobileAccountChoice(
  harness: HarnessId,
  project: string,
  params: Record<string, unknown>,
): string | undefined {
  const explicit = params.providerAccountId !== undefined;
  if (!supportsAccountProfiles(harness)) {
    if (explicit)
      throw new Error("This provider does not support account switching");
    return undefined;
  }
  const accountId = explicit
    ? params.providerAccountId
    : selectedProviderAccountId(harness, project);
  if (
    typeof accountId !== "string" ||
    !providerAccountExists(harness, accountId)
  )
    throw new Error(
      "Account is no longer available. Choose another account in the model picker.",
    );
  return accountId;
}
