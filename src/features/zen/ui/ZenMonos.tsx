import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  listMonos,
  monoLook,
  monosSnapshot,
  subscribeMonos,
  type Mono,
  type MonoLook,
} from "../../monos/model/mono";

export type ZenMonoEntry = { mono: Mono; look: MonoLook };

/** Every Mono with its look, live (L-230). */
export function useZenMonos(): readonly ZenMonoEntry[] {
  const snapshot = useSyncExternalStore(subscribeMonos, monosSnapshot, monosSnapshot);
  return useMemo(() => {
    void snapshot;
    return listMonos().map((mono) => ({ mono, look: monoLook(mono) }));
  }, [snapshot]);
}

/**
 * A Mono's chat across the whole Zen panel (L-230), picked from the Mono
 * buttons in Zen's top bar.
 */
export function ZenMonoChat({
  name,
  chat,
}: {
  name: string;
  /** The Mono's chat, or null while it loads. */
  chat: ReactNode | null;
}): ReactNode {
  return (
    <div
      aria-label={`${name} chat`}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {chat ?? (
        <div
          aria-busy="true"
          aria-label="Loading chat"
          className="flex flex-1 flex-col gap-3 p-4"
        >
          <div className="h-3 w-2/3 animate-pulse rounded bg-content/8" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-content/8" />
        </div>
      )}
    </div>
  );
}
