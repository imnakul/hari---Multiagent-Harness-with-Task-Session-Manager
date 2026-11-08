import * as Haptics from "expo-haptics";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { Icon, type IconName } from "@/ui/Icon";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { LinkCards } from "./LinkCard";
import { createTask, newId, saveNote, titleFrom, type Command, type LinkPreviewSettings } from "./tools";

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
  return <Tools value={value}>{children}</Tools>;
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
  const noteTitle = tools.title && tools.title !== "New session" ? tools.title : titleFrom(text);
  return (
    <>
      <ToolButton
        icon="noteAdd"
        label="Add to notes"
        done="Saved to notes"
        run={async () => {
          const saved = await saveNote(tools.command, {
            id: newId(),
            title: noteTitle,
            body: text,
            sourceSessionId: tools.sessionId,
            sourceCwd: tools.cwd,
            baseUpdatedAt: null,
            finalize: true,
          });
          if (saved.conflict) throw new Error("The note couldn’t be saved. Try again.");
        }}
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

/** How long a button shows its tick after saving. */
const DONE_MS = 1800;

function ToolButton({
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
  button: { padding: 4, borderRadius: 6 },
  pressed: { backgroundColor: withAlpha(colors.content, 0.08) },
}));
