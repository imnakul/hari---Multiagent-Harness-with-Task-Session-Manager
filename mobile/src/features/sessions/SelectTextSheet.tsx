import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ToolButton, useBookmarks, useSelectionTools } from "@/features/tools/ReplyTools";
import { Icon } from "@/ui/Icon";
import { themedStyles, useColors, withAlpha } from "@/ui/theme";

import { selectableRuns } from "./selectableText";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * Fork (Hari, L-351): a reply as one page whose text selects across every
 * paragraph, list and code block, which the transcript's separate blocks
 * can't. Plain text, code in monospace. A selection shows Hari's own bar:
 * Copy, Bookmark, Add to notes, Add task, as the desktop's selection menu.
 *
 * The page is a text field that never takes typing (no keyboard): React
 * Native's Text gives no selection range to act on.
 *
 * L-366: Android keeps its own selection menu. Hiding it makes Android drop
 * the selection the moment the finger lifts (a menu that refuses to open
 * clears the selection), which took Hari's bar with it. Its Cut or Paste
 * can't change the reply: the page is put back as it was.
 */
export function SelectTextSheet({
  visible,
  onClose,
  text,
  blockId,
}: {
  visible: boolean;
  onClose: () => void;
  /** The reply's Markdown. */
  text: string;
  /** The reply's first block, which a bookmarked quote points at. */
  blockId: string;
}) {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const runs = useMemo(() => selectableRuns(text), [text]);
  const whole = useMemo(() => runs.map((run) => run.text).join(""), [runs]);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [restored, setRestored] = useState(0);
  const selected = whole.slice(range.start, range.end).trim();
  const bookmarks = useBookmarks();
  const tools = useSelectionTools();
  const close = () => {
    setRange({ start: 0, end: 0 });
    onClose();
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={[styles.page, { paddingTop: Platform.OS === "ios" ? 12 : insets.top + 8 }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Select text
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={close}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
        <Text style={styles.hint}>Press and hold, then drag the handles.</Text>
        <TextInput
          key={restored}
          multiline
          editable
          showSoftInputOnFocus={false}
          contextMenuHidden={Platform.OS === "ios"}
          onChangeText={() => {
            setRange({ start: 0, end: 0 });
            setRestored((value) => value + 1);
          }}
          caretHidden
          scrollEnabled
          textAlignVertical="top"
          selectionColor={withAlpha(colors.accent, 0.35)}
          onSelectionChange={(event) => setRange(event.nativeEvent.selection)}
          style={styles.body}
        >
          {runs.map((run, index) => (
            <Text key={index} style={run.code ? styles.code : null}>
              {run.text}
            </Text>
          ))}
        </TextInput>
        {selected ? (
          <View style={[styles.bar, { marginBottom: insets.bottom + 12 }]}>
            <ToolButton
              icon="copy"
              label="Copy"
              done="Copied"
              run={() => Clipboard.setStringAsync(selected)}
            />
            {bookmarks ? (
              <ToolButton
                icon="bookmark"
                label="Bookmark"
                done="Bookmarked"
                run={() => bookmarks.quote(blockId, selected)}
              />
            ) : null}
            {tools.note ? (
              <ToolButton
                icon="noteAdd"
                label="Add to notes"
                done="Saved to notes"
                run={() => tools.note!(selected)}
              />
            ) : null}
            {tools.task ? (
              <ToolButton
                icon="taskAdd"
                label="Add task"
                done="Task added"
                run={() => tools.task!(selected)}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ height: insets.bottom + 12 }} />
        )}
      </View>
    </Modal>
  );
}

const useStyles = themedStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.sheet, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 40 },
  title: { color: colors.content, fontSize: 17, fontWeight: "600" },
  close: { padding: 6, borderRadius: 16 },
  pressed: { backgroundColor: withAlpha(colors.content, 0.08) },
  hint: { color: colors.muted, fontSize: 13, marginBottom: 12 },
  body: { flex: 1, color: colors.content, fontSize: 16, lineHeight: 24, padding: 0 },
  code: { fontFamily: MONO, fontSize: 14 },
  bar: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderCurve: "continuous",
    backgroundColor: colors.surfaceRaised,
    marginTop: 8,
  },
}));
