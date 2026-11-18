import * as Clipboard from "expo-clipboard";
import * as Haptics from "@/ui/haptics";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { Icon, type IconName } from "@/ui/Icon";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { LinkCards } from "./LinkCard";
import { createTask, newId, saveNote, titleFrom, type Command, type LinkPreviewSettings } from "./tools";

export { bookmarkLine } from "./tools";

// Fork (Hari, L-236): what a chat's replies can do with the desktop's Tasks and
// Notes, and how they show links. Set by the chat screen when the desktop
// answers these; elsewhere replies show neither.

type ReplyTools = {
  command: Command;
  /** The chat the reply came from, kept on the note or task as on the desktop. */
  sessionId?: string;
  /** Its project's folder. */
  cwd?: string;
  /** The chat's title, which a saved note takes as the desktop's does. */
  title?: string;
  links?: LinkPreviewSettings;
};

const Tools = createContext<ReplyTools | null>(null);

/**
 * Fork (Hari, L-354): bookmarks in the desktop's session Bookmarks list. Only
 * in a desktop chat whose desktop answers them; not in Mono chats.
 */
type Bookmarks = {
  /** Replies (by their first block's id) bookmarked whole. */
  marked: ReadonlySet<string>;
  toggle: (blockId: string, line: string) => Promise<void>;
  quote: (blockId: string, quote: string) => Promise<void>;
};

const BookmarkTools = createContext<Bookmarks | null>(null);

function BookmarksProvider({ sessionId, children }: { sessionId?: string; children: ReactNode }) {
  const { catalog, command } = useConnection();
  const on = !!catalog.bookmarks && !!sessionId;
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!on) return;
    let live = true;
    (command as Command)<{ blockIds?: string[] }>("bookmarks.list", { sessionId })
      .then((reply) => {
        if (live) setMarked(new Set(reply.blockIds ?? []));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [on, command, sessionId]);
  const toggle = useCallback(
    async (blockId: string, line: string) => {
      const reply = await (command as Command)<{ blockIds?: string[] }>("bookmarks.toggle", {
        sessionId,
        blockId,
        text: line,
      });
      setMarked(new Set(reply.blockIds ?? []));
    },
    [command, sessionId],
  );
  const quote = useCallback(
    async (blockId: string, text: string) => {
      await (command as Command)("bookmarks.quote", { sessionId, blockId, quote: text });
    },
    [command, sessionId],
  );
  const value = useMemo(() => (on ? { marked, toggle, quote } : null), [on, marked, toggle, quote]);
  return <BookmarkTools value={value}>{children}</BookmarkTools>;
}

export function useBookmarks(): Bookmarks | null {
  return use(BookmarkTools);
}

export function ReplyToolsProvider({
  sessionId,
  cwd,
  title,
  children,
}: {
  sessionId?: string;
  cwd?: string;
  title?: string;
  children: ReactNode;
}) {
  const { catalog, command } = useConnection();
  const on = !!catalog.phoneTools;
  const links = catalog.linkPreviews;
  const value = useMemo(
    () => (on ? { command: command as Command, sessionId, cwd, title, links } : null),
    [on, command, sessionId, cwd, title, links],
  );
  return (
    <Tools value={value}>
      <BookmarksProvider sessionId={sessionId}>{children}</BookmarksProvider>
    </Tools>
  );
}

/** Link cards for a reply once it has finished, when the desktop shows them always. */
export function ReplyLinkCards({ streaming, children }: { streaming: boolean; children: ReactNode }) {
  const tools = use(Tools);
  const links = tools?.links;
  const cards = useMemo(
    () =>
      tools && links?.mode === "always" ? { style: links.cardStyle, command: tools.command } : null,
    [tools, links],
  );
  return <LinkCards value={streaming ? null : cards}>{children}</LinkCards>;
}

/** "Add to notes" and "Add task" in a finished reply's footer. */
export function ReplyToolButtons({ text }: { text: string }) {
  const tools = use(Tools);
  if (!tools) return null;
  return (
    <>
      <ToolButton
        icon="noteAdd"
        label="Add to notes"
        done="Saved to notes"
        run={() => saveToNotes(tools, text)}
      />
      <ToolButton
        icon="taskAdd"
        label="Add task"
        done="Task added"
        run={() =>
          createTask(tools.command, {
            body: text,
            projectCwd: tools.cwd,
            sourceSessionId: tools.sessionId,
          })
        }
      />
    </>
  );
}

/**
 * Fork (Hari, L-352): the desktop's block actions on a code block, table or
 * quote, in its order: Add task, Add to notes, Copy. Add Draft stays on the
 * desktop. `before` comes first, set apart (the code block's wrap button).
 */
export function BlockToolButtons({
  label,
  text,
  before,
}: {
  /** "code", "table" or "quote", for labels. */
  label: string;
  text: string;
  before?: ReactNode;
}) {
  const tools = use(Tools);
  const styles = useStyles();
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <View style={styles.row}>
      {before}
      {before ? <View style={styles.rowGap} /> : null}
      {tools ? (
        <ToolButton
          icon="taskAdd"
          label="Add task"
          done={`Task added from ${label}`}
          run={() =>
            createTask(tools.command, {
              body: text,
              projectCwd: tools.cwd,
              sourceSessionId: tools.sessionId,
            })
          }
        />
      ) : null}
      {tools ? (
        <ToolButton
          icon="noteAdd"
          label="Add to notes"
          done={`${title} saved to notes`}
          run={() => saveToNotes(tools, text)}
        />
      ) : null}
      <ToolButton
        icon="copy"
        label={`Copy ${label}`}
        done={`${title} copied`}
        run={() => Clipboard.setStringAsync(text)}
      />
    </View>
  );
}

/** Saves `text` as a note named for the chat, as "Add to notes" does. */
async function saveToNotes(tools: ReplyTools, text: string): Promise<void> {
  const title = tools.title && tools.title !== "New session" ? tools.title : titleFrom(text);
  const saved = await saveNote(tools.command, {
    id: newId(),
    title,
    body: text,
    sourceSessionId: tools.sessionId,
    sourceCwd: tools.cwd,
    baseUpdatedAt: null,
    finalize: true,
  });
  if (saved.conflict) throw new Error("The note couldn’t be saved. Try again.");
}

/** Selected text's actions (L-351): what a selection can go to, if anything. */
export function useSelectionTools(): {
  note: ((text: string) => Promise<void>) | null;
  task: ((text: string) => Promise<unknown>) | null;
} {
  const tools = use(Tools);
  return useMemo(
    () =>
      tools
        ? {
            note: (text: string) => saveToNotes(tools, text),
            task: (text: string) =>
              createTask(tools.command, {
                body: text,
                projectCwd: tools.cwd,
                sourceSessionId: tools.sessionId,
              }),
          }
        : { note: null, task: null },
    [tools],
  );
}

/** How long a button shows its tick after saving. */
const DONE_MS = 1800;

/** Fork (Hari, L-301): a reply's tool button (Share's footer used it until L-330). */
export function ToolButton({
  icon,
  label,
  done,
  run,
}: {
  icon: IconName;
  label: string;
  done: string;
  run: () => Promise<unknown>;
}) {
  const colors = useColors();
  const styles = useStyles();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const tint = withAlpha(colors.content, 0.4);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state === "done" ? done : label}
      hitSlop={6}
      disabled={state === "busy"}
      onPress={async () => {
        setState("busy");
        try {
          await run();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setState("done");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), DONE_MS);
        } catch (reason) {
          setState("idle");
          Alert.alert(
            `Couldn’t ${label.toLowerCase()}`,
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {state === "busy" ? (
        <ActivityIndicator size={16} color={tint} />
      ) : (
        <Icon name={state === "done" ? "check" : icon} size={16} color={state === "done" ? colors.accent : tint} />
      )}
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  rowGap: { width: StyleSheet.hairlineWidth, height: 14, marginHorizontal: 4, backgroundColor: withAlpha(colors.content, 0.15) },
  button: { padding: 4, borderRadius: 6 },
  pressed: { backgroundColor: withAlpha(colors.content, 0.08) },
}));
