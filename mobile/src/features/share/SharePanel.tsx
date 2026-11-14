import * as Clipboard from "expo-clipboard";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useState } from "react";
import { Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { canSaveToDownloads, openNativeFile } from "@/features/liveUpdates/nativeLive";
import { SettingsPage } from "@/features/settings/SettingsUI";
import {
  formatShareSize,
  MAX_SHARE_FILES,
  MAX_SHARE_TEXT,
  shareCaption,
  shareDay,
  shareThumbnail,
  type PhoneShareEntry,
} from "@/features/share/shareModel";
import { removeShares, useShareHistory } from "@/features/share/shareStore";
import { retryShare, sendShareFile, sendShareText } from "@/features/share/shareTransfers";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, useScheme, withAlpha } from "@/ui/theme";

/** How far a bubble slides before letting go removes it. */
const SWIPE_DISTANCE = 96;
/** A picture's thumbnail in the timeline. */
const THUMB_WIDTH = 220;
const THUMB_HEIGHT = 160;

const KIND_ICON: Record<PhoneShareEntry["kind"], IconName> = {
  text: "note",
  link: "openLink",
  clipboard: "clipboard",
  file: "attachment",
};

const why = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * Fork (Hari, L-279): text, links, the clipboard and files between this phone
 * and the paired computer, with the last 100 both ways. Texts wait in the
 * link's outbox until the computer takes them; files move while connected.
 * L-288: the Share tab of the Computer hub, as a chat with the computer: from
 * it on the left, to it on the right, pictures as thumbnails, by day.
 */
export function SharePanel() {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const { pairing, command } = useConnection();
  const history = useShareHistory();
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!pairing)
    return (
      <SettingsPage>
        <Notice
          title="Pair with your computer first"
          text="Share sends text, links and files between this phone and MonoCode on your computer."
        />
      </SettingsPage>
    );

  const send = () => {
    if (!draft.trim()) return;
    sendShareText(draft, false);
    setDraft("");
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const sendClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text.trim()) {
      Alert.alert("The clipboard is empty", "Copy some text first, then send it.");
      return;
    }
    sendShareText(text, true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const pickFiles = async () => {
    try {
      const picked = await File.pickFileAsync({ multipleFiles: true });
      if (picked.canceled) return;
      const files = picked.result;
      if (files.length > MAX_SHARE_FILES)
        Alert.alert(
          `Sending the first ${MAX_SHARE_FILES}`,
          `Up to ${MAX_SHARE_FILES} files go at a time.`,
        );
      for (const file of files.slice(0, MAX_SHARE_FILES))
        sendShareFile(
          {
            uri: file.uri,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          },
          command,
        );
    } catch (reason) {
      Alert.alert("Couldn’t pick the files", why(reason));
    }
  };

  const open = (entry: PhoneShareEntry) => {
    if (entry.status === "failed") {
      retryShare(entry, command);
      return;
    }
    if (entry.kind === "file") {
      const mine = entry.direction === "out" || entry.status === "done";
      if (mine && entry.uri) {
        if (!openNativeFile(entry.uri, entry.mimeType ?? "application/octet-stream"))
          Alert.alert("Couldn’t open the file", "It may have been moved or deleted. Look in Download/Hari.");
      }
      return;
    }
    if (entry.text === undefined) return;
    if (entry.kind === "link") {
      void Linking.openURL(entry.text).catch(() =>
        Alert.alert("Couldn’t open the link", entry.text),
      );
      return;
    }
    void Clipboard.setStringAsync(entry.text).then(() => {
      void Haptics.selectionAsync();
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500);
    });
  };

  const remove = (entry: PhoneShareEntry) => {
    void Haptics.selectionAsync();
    removeShares([entry.id]);
  };

  const clearAll = () =>
    Alert.alert("Clear the history?", "Saved files stay in Download/Hari.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => removeShares() },
    ]);

  return (
    <SettingsPage>
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Text or a link for your computer"
          placeholderTextColor={colors.muted}
          keyboardAppearance={scheme}
          multiline
          maxLength={MAX_SHARE_TEXT}
          accessibilityLabel="Text to send to your computer"
          style={styles.input}
        />
        <View style={styles.composerActions}>
          <ActionButton icon="clipboard" label="Send clipboard" onPress={() => void sendClipboard()} />
          <ActionButton icon="attachment" label="Files" onPress={() => void pickFiles()} />
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() }}
            disabled={!draft.trim()}
            onPress={send}
            style={({ pressed }) => [
              styles.sendButton,
              !draft.trim() && styles.disabled,
              pressed && styles.pressedScale,
            ]}
          >
            <Icon name="send" size={18} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>
      <Text style={styles.hint}>
        {canSaveToDownloads
          ? "Files from your computer save to Download/Hari. Texts wait until your computer is on."
          : "Texts wait until your computer is on. Update Hari to save files to Downloads."}
      </Text>

      {history.length ? (
        <View style={styles.toolbar}>
          <Text style={styles.count} accessibilityRole="header">
            History
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={clearAll}
            hitSlop={8}
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearLabel}>Clear all</Text>
          </Pressable>
        </View>
      ) : (
        <Notice
          title="Nothing shared yet"
          text="Send something from here, from any app’s share menu, or with the “Send clipboard” Quick Settings tile."
        />
      )}

      {history.map((entry, index) => {
        const day = shareDay(entry.at);
        const newDay = index === 0 || shareDay(history[index - 1].at) !== day;
        return (
          <Animated.View
            key={entry.id}
            exiting={FadeOut.duration(160)}
            layout={LinearTransition.duration(200)}
          >
            {newDay ? (
              <Text style={styles.day} accessibilityRole="header">
                {day}
              </Text>
            ) : null}
            <ShareBubble
              entry={entry}
              copied={copiedId === entry.id}
              onOpen={open}
              onRemove={remove}
            />
          </Animated.View>
        );
      })}
    </SettingsPage>
  );
}

function ShareBubble({
  entry,
  copied,
  onOpen,
  onRemove,
}: {
  entry: PhoneShareEntry;
  copied: boolean;
  onOpen: (entry: PhoneShareEntry) => void;
  onRemove: (entry: PhoneShareEntry) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const failed = entry.status === "failed";
  const mine = entry.direction === "out";
  const thumbnail = shareThumbnail(entry);
  const [broken, setBroken] = useState(false);
  const title =
    entry.kind === "file"
      ? `${entry.name ?? "File"}${entry.size !== undefined ? ` · ${formatShareSize(entry.size)}` : ""}`
      : (entry.text ?? "");
  const meta = `${shareCaption(entry)} · ${timeOf(entry.at)}`;
  const hint = failed
    ? "Tries again"
    : entry.kind === "link"
      ? "Opens the link"
      : entry.kind === "file"
        ? mine || entry.status === "done"
          ? "Opens the file"
          : undefined
        : "Copies the text";
  const removeAction = () => (
    <View style={styles.removeAction}>
      <Icon name="trash" size={20} color={colors.deletions} />
    </View>
  );
  return (
    <ReanimatedSwipeable
      friction={1.5}
      leftThreshold={SWIPE_DISTANCE}
      rightThreshold={SWIPE_DISTANCE}
      renderLeftActions={removeAction}
      renderRightActions={removeAction}
      onSwipeableOpen={() => onRemove(entry)}
    >
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${meta}${entry.error ? `. ${entry.error}` : ""}`}
          accessibilityHint={hint}
          accessibilityActions={[{ name: "remove", label: "Remove" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "remove") onRemove(entry);
          }}
          onPress={() => onOpen(entry)}
          style={({ pressed }) => [
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            thumbnail && !broken && styles.bubblePicture,
            failed && styles.bubbleFailed,
            pressed && styles.pressed,
          ]}
        >
          {thumbnail && !broken ? (
            <Image
              source={{ uri: thumbnail }}
              style={styles.thumbnail}
              contentFit="cover"
              recyclingKey={entry.id}
              transition={120}
              accessibilityIgnoresInvertColors
              onError={() => setBroken(true)}
            />
          ) : (
            <View style={styles.bubbleHead}>
              <Icon
                name={copied ? "check" : KIND_ICON[entry.kind]}
                size={16}
                color={failed ? colors.deletions : mine ? colors.muted : colors.accent}
              />
              <Text
                style={[styles.title, entry.kind === "link" && styles.link]}
                numberOfLines={entry.kind === "file" ? 2 : 6}
              >
                {title}
              </Text>
            </View>
          )}
          <View style={thumbnail && !broken ? styles.pictureMeta : undefined}>
            <Text style={[styles.meta, failed && styles.metaFailed]} numberOfLines={1}>
              {copied ? "Copied" : meta}
            </Text>
            {entry.status === "moving" ? (
              <View style={styles.track}>
                <View style={[styles.bar, { width: `${Math.round((entry.progress ?? 0) * 100)}%` }]} />
              </View>
            ) : null}
            {failed && entry.error ? (
              <Text style={styles.error} numberOfLines={2}>
                {entry.error} · Tap to try again
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>
    </ReanimatedSwipeable>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressedScale]}
    >
      <Icon name={icon} size={16} color={colors.accent} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.notice}>
      <Icon name="share" size={28} color={colors.faint} />
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  composer: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    padding: 12,
    gap: 10,
  },
  input: {
    minHeight: 72,
    maxHeight: 180,
    color: colors.content,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
    padding: 0,
  },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  spacer: { flex: 1 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  actionLabel: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  pressedScale: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  disabled: { opacity: 0.4 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8, paddingHorizontal: 4 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 24,
    paddingHorizontal: 4,
  },
  count: { flex: 1, color: colors.muted, fontSize: 15 },
  toolbarButton: { minHeight: 40, justifyContent: "center" },
  clearLabel: { color: colors.deletions, fontSize: 15, fontWeight: "600" },
  day: {
    alignSelf: "center",
    marginTop: 16,
    marginBottom: 8,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-start", paddingVertical: 4 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "84%",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    borderCurve: "continuous",
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  bubbleMine: { backgroundColor: withAlpha(colors.accent, 0.16), borderBottomRightRadius: 6 },
  bubblePicture: { padding: 4, overflow: "hidden" },
  bubbleFailed: { borderWidth: 1, borderColor: withAlpha(colors.deletions, 0.5) },
  bubbleHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  thumbnail: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 14,
    borderCurve: "continuous",
    backgroundColor: colors.stroke,
  },
  pictureMeta: { paddingHorizontal: 8, paddingBottom: 4 },
  pressed: { opacity: 0.6 },
  title: { flexShrink: 1, color: colors.content, fontSize: 15, lineHeight: 20 },
  link: { color: colors.accent },
  meta: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  metaFailed: { color: colors.deletions },
  error: { color: colors.deletions, fontSize: 13, lineHeight: 18 },
  track: {
    height: 3,
    marginTop: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: withAlpha(colors.accent, 0.16),
  },
  bar: { height: 3, backgroundColor: colors.accent },
  removeAction: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    borderRadius: 18,
    backgroundColor: withAlpha(colors.deletions, 0.14),
  },
  notice: { alignItems: "center", gap: 8, marginTop: 48, paddingHorizontal: 24 },
  noticeTitle: { color: colors.content, fontSize: 17, fontWeight: "600", textAlign: "center" },
  noticeText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
}));
