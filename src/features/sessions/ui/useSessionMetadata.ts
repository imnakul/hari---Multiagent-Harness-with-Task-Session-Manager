import { useSyncExternalStore } from "react";
import {
  loadSessionLabels,
  loadSessionMetadataHover,
  subscribeSessionLabels,
  subscribeSessionMetadataHover,
} from "../../settings/model/settings";
import {
  hasSessionMetadata,
  sessionMetadataSnapshot,
  subscribeSessionMetadata,
  type SessionMetadata,
} from "../model/sessionMetadata";

const EMPTY_METADATA: ReadonlyMap<string, SessionMetadata> = new Map();

/** Every chat's label and notes in this window, live (L-181). */
export function useSessionMetadataMap(): ReadonlyMap<string, SessionMetadata> {
  return useSyncExternalStore(
    subscribeSessionMetadata,
    sessionMetadataSnapshot,
    () => EMPTY_METADATA,
  );
}

/** One chat's label and notes, or null when it has none. */
export function useSessionMetadata(
  sessionId: string | null | undefined,
): SessionMetadata | null {
  const byId = useSessionMetadataMap();
  return sessionId ? (byId.get(sessionId) ?? null) : null;
}

export function useShowSessionLabels(): boolean {
  return useSyncExternalStore(
    subscribeSessionLabels,
    loadSessionLabels,
    () => true,
  );
}

export function useShowSessionMetadataHover(): boolean {
  return useSyncExternalStore(
    subscribeSessionMetadataHover,
    loadSessionMetadataHover,
    () => true,
  );
}

/**
 * The label to show in place of the chat title, or null to keep the title:
 * when "Show label where available" is off or the chat has no label.
 */
export function useSessionLabel(
  sessionId: string | null | undefined,
): string | null {
  const metadata = useSessionMetadata(sessionId);
  const show = useShowSessionLabels();
  return show && metadata?.label ? metadata.label : null;
}

/**
 * What a hover over this chat's card or tab shows instead of the usual
 * details: its metadata when "Show metadata on hover" is on and it has some,
 * otherwise null (keep the usual hover).
 */
export function useSessionHoverMetadata(
  sessionId: string | null | undefined,
): SessionMetadata | null {
  const metadata = useSessionMetadata(sessionId);
  const show = useShowSessionMetadataHover();
  return show && hasSessionMetadata(metadata) ? metadata : null;
}
