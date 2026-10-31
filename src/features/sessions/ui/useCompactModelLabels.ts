import { useSyncExternalStore } from "react";
import {
  loadCompactModelLabels,
  subscribeCompactModelLabels,
} from "../../settings/model/settings";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { resolveModel } from "../model/models";
import type { SessionSummary } from "../data/sessionStore";

/** Live subscription so the Experimentation switch updates existing cards. */
export function useCompactModelLabels(): boolean {
  return useSyncExternalStore(
    subscribeCompactModelLabels,
    loadCompactModelLabels,
    () => false,
  );
}

/** Prefer the actual in-flight turn model if the next-turn choice changed. */
export function compactModelLabel(session: SessionSummary): string {
  const active = session.activeTurnModel;
  if (active?.name) return active.name;
  return resolveModel(session.harness, session.model).name;
}

/**
 * Fork (L-196): the chat's account name, only when its provider has two or
 * more accounts. A removed account reads as the default one.
 */
export function sessionAccountLabel(
  session: Pick<SessionSummary, "harness" | "providerAccountId">,
): string | null {
  if (!supportsProviderAccounts(session.harness)) return null;
  const accounts = providerAccounts(session.harness);
  if (accounts.length < 2) return null;
  const id = session.providerAccountId || DEFAULT_PROVIDER_ACCOUNT_ID;
  return (accounts.find((account) => account.id === id) ?? accounts[0]).label;
}

/** Live, so a renamed or removed account updates existing cards. */
export function useSessionAccountLabel(
  session: Pick<SessionSummary, "harness" | "providerAccountId">,
): string | null {
  return useSyncExternalStore(
    subscribeProviderAccounts,
    () => sessionAccountLabel(session),
    () => null,
  );
}

/** "Opus 5.5 · work" when an account name applies. */
export function withAccountLabel(
  model: string | null,
  account: string | null,
): string | null {
  return model && account ? `${model} · ${account}` : model;
}
