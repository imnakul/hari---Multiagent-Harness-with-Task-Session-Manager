import { createContext } from "react";

/** Reply-level actions shared by every block in an agent reply. */
export const MarkdownTableContext = createContext<{
  onSaveNote?: (text: string) => void | Promise<void>;
  /** Add Task on quotes (fork, L-188); `blockId` is the reply it came from. */
  onAddToTask?: (text: string, blockId?: string) => void | Promise<void>;
  streaming?: boolean;
}>({});
