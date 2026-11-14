import { createContext } from "react";

/**
 * Fork (Hari, L-268): the desktop conversation a transcript shows, so a sent
 * image can be fetched from it. Kept apart from the attachment views so
 * screens can name it without loading the image renderer.
 */
export const TranscriptConversation = createContext<string | undefined>(undefined);
