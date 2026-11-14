import * as Clipboard from "expo-clipboard";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { canSaveToDownloads, openNativeFile } from "@/features/liveUpdates/nativeLive";
import { Markdown } from "@/features/sessions/Markdown";
import { SettingsPage } from "@/features/settings/SettingsUI";
import {
  formatShareSize,
  kindForText,
  MAX_SHARE_FILES,
  MAX_SHARE_TEXT,
  shareCaption,
  shareDay,
  shareRows,
  shareThumbnail,
  type PhoneShareEntry,
  type ShareRow,
} from "@/features/share/shareModel";
import { removeShares, useShareHistory } from "@/features/share/shareStore";
import {
  clearAllShares,
  fetchShareFile,
  openOnComputer,
  pinShares,
  retryShare,
  saveShares,
  sendShareGroup,
  sendShareText,
  shareStorage,
  type ShareFile,
} from "@/features/share/shareTransfers";
import { LinkCard } from "@/features/tools/LinkCard";
import type { Command } from "@/features/tools/tools";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, useScheme, withAlpha } from "@/ui/theme";

/** How far a bubble slides before letting go removes it. */
const SWIPE_DISTANCE = 96;
/** A picture keeps its shape inside this box. */
const PICTURE_MAX_WIDTH = 240;
const PICTURE_MAX_HEIGHT = 320;
/** Pictures sent together: a two-column grid of squares. */
const GRID_CELL = 118;

const KIND_ICON: Record<PhoneShareEntry["kind"], IconName> = {
  text: "note",
  link: "openLink",
  clipboard: "clipboard",
  file: "attachment",
};

const why = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const isPicture = (entry: PhoneShareEntry) => shareThumbnail(entry) !== null;

/**
 * Fork (Hari, L-279): text, links, the clipboard and files between this phone
 * and the paired computer. L-288: a chat with the computer, by day.
 * L-290: WhatsApp-style: pictures keep their shape, files sent together are
 * one message, text reads as Markdown, links show cards, messages can be
 * pinned (bar at the top) and saved (never roll off), big files from the
 * computer wait for Download, and Delete all frees this phone's space.
 */
export function SharePanel() {
  const styles = useStyles();
  const { pairing, command, catalog } = useConnection();
  const history = useShareHistory();
  const [savedOnly, setSavedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinIndex, setPinIndex] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const rowsAt = useRef(new Map<string, number>());

  const rows = useMemo(() => {
    const all = shareRows(history);
    return savedOnly ? all.filter((row) => row.items.some((item) => item.saved)) : all;
  }, [history, savedOnly]);
  const pinned = useMemo(
    () => shareRows(history).filter((row) => row.items.some((item) => item.pinned)),
    [history],
  );

  if (!pairing)
    return (
      <SettingsPage>
        <Notice
          title="Pair with your computer first"
          text="Share sends text, links and files between this phone and MonoCode on your computer."
        />
      </SettingsPage>
    );

  const cards = catalog.phoneTools ? (command as Command) : null;

  const copy = (id: string, text: string) =>
    void Clipboard.setStringAsync(text).then(() => {
      void Haptics.selectionAsync();
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    });

  const open = (entry: PhoneShareEntry) => {
    if (selected) {
      setSelected(null);
      return;
    }
    if (entry.status === "failed") {
      retryShare(entry, command);
      return;
    }
    if (entry.kind === "file") {
      if (entry.status === "offered") {
        fetchShareFile(entry.id, command);
        return;
      }
      const mine = entry.direction === "out" || entry.status === "done";
      if (mine && entry.uri) {
        if (!openNativeFile(entry.uri, entry.mimeType ?? "application/octet-stream"))
          Alert.alert("Couldn’t open the file", "It may have been moved or deleted. Look in Download/Hari.");
      }
      return;
    }
    if (entry.text === undefined) return;
    if (entry.kind === "link") {
      void Linking.openURL(entry.text).catch(() => Alert.alert("Couldn’t open the link", entry.text));
      return;
    }
    copy(entry.id, entry.text);
  };

  const remove = (row: ShareRow) => {
    void Haptics.selectionAsync();
    setSelected(null);
    removeShares(row.items.map((item) => item.id));
  };

  const clearAll = () => {
    const storage = shareStorage();
    const kept = history.filter((entry) => entry.pinned || entry.saved).length;
    Alert.alert(
      "Delete all?",
      `Deletes the messages on this phone and your computer${
        storage.files ? `, and ${storage.files} received file${storage.files === 1 ? "" : "s"} (${formatShareSize(storage.filesBytes)})` : ""
      }.${kept ? ` ${kept} pinned or saved stay.` : ""}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => {
            clearAllShares();
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  };

  const jumpToPin = () => {
    if (!pinned.length) return;
    const row = pinned[pinIndex % pinned.length];
    if (savedOnly) setSavedOnly(false);
    const y = rowsAt.current.get(row.key);
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    setSelected(row.key);
    setPinIndex((index) => (index + 1) % pinned.length);
  };

  const storage = shareStorage();
  const pinRow = pinned.length ? pinned[pinIndex % pinned.length] : null;

  return (
    <SettingsPage
      scrollRef={scroll}
      header={
        pinRow ? (
          <PinBar row={pinRow} count={pinned.length} index={pinIndex % pinned.length} onPress={jumpToPin} />
        ) : undefined
      }
    >
      <ShareComposer command={command} />
      <Text style={styles.hint}>
        {canSaveToDownloads
          ? "Files from your computer save to Download/Hari; big ones wait for Download. Keep Hari open while files move."
          : "Texts wait until your computer is on. Update Hari to save files to Downloads."}
      </Text>

      {history.length ? (
        <View style={styles.toolbar}>
          <Chip label="All" active={!savedOnly} onPress={() => setSavedOnly(false)} />
          <Chip label="Saved" icon="bookmark" active={savedOnly} onPress={() => setSavedOnly(true)} />
          <View style={styles.spacer} />
          <Text style={styles.storage} numberOfLines={1}>
            {formatShareSize(storage.historyBytes + storage.filesBytes)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete all"
            onPress={clearAll}
            hitSlop={8}
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
          >
            <Text style={styles.clearLabel}>Delete all</Text>
          </Pressable>
        </View>
      ) : (
        <Notice
          title="Nothing shared yet"
          text="Send something from here, from any app’s share menu, or with the “Send clipboard” Quick Settings tile."
        />
      )}
      {savedOnly && !rows.length ? (
        <Text style={styles.empty}>Long-press a message and tap Save to keep it here.</Text>
      ) : null}

      {rows.map((row, index) => {
        const head = row.items[row.items.length - 1];
        const day = shareDay(head.at);
        const previous = rows[index - 1];
        const newDay = !previous || shareDay(previous.items[previous.items.length - 1].at) !== day;
        return (
          <Animated.View
            key={row.key}
            exiting={FadeOut.duration(160)}
            layout={LinearTransition.duration(200)}
            onLayout={({ nativeEvent }) => rowsAt.current.set(row.key, nativeEvent.layout.y)}
          >
            {newDay ? (
              <Text style={styles.day} accessibilityRole="header">
                {day}
              </Text>
            ) : null}
            <ShareBubble
              row={row}
              copiedId={copiedId}
              selected={selected === row.key}
              cards={cards}
              cardStyle={catalog.linkPreviews?.cardStyle ?? "compact"}
              onOpen={open}
              onSelect={() => {
                void Haptics.selectionAsync();
                setSelected((current) => (current === row.key ? null : row.key));
              }}
              onRemove={() => remove(row)}
              onCopy={copy}
            />
          </Animated.View>
        );
      })}
    </SettingsPage>
  );
}

/**
 * The composer. The field is uncontrolled (as the session composer), so
 * typing never re-renders the timeline; only "empty or not" is state.
 * Files wait above it until Send, then go as one message with the text as
 * their caption.
 */
function ShareComposer({ command }: { command: ReturnType<typeof useConnection>["command"] }) {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const input = useRef<TextInput>(null);
  const draft = useRef("");
  const [hasText, setHasText] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [files, setFiles] = useState<ShareFile[]>([]);

  const onChange = (text: string) => {
    draft.current = text;
    const filled = !!text.trim();
    if (filled !== hasText) setHasText(filled);
    const link = filled && kindForText(text.trim()) === "link";
    if (link !== isLink) setIsLink(link);
  };

  const reset = () => {
    input.current?.clear();
    draft.current = "";
    setHasText(false);
    setIsLink(false);
    setFiles([]);
  };

  const send = () => {
    if (!hasText && !files.length) return;
    if (files.length) sendShareGroup(files, draft.current, command);
    else sendShareText(draft.current, false);
    reset();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const sendAndOpen = () => {
    try {
      openOnComputer(draft.current);
      reset();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (reason) {
      Alert.alert("Couldn’t open it there", why(reason));
    }
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
      const chosen = picked.result.map((file) => ({
        uri: file.uri,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      }));
      setFiles((current) => {
        const next = [...current, ...chosen];
        if (next.length > MAX_SHARE_FILES)
          Alert.alert(`Up to ${MAX_SHARE_FILES} files`, `Up to ${MAX_SHARE_FILES} files go at a time.`);
        return next.slice(0, MAX_SHARE_FILES);
      });
    } catch (reason) {
      Alert.alert("Couldn’t pick the files", why(reason));
    }
  };

  const canSend = hasText || files.length > 0;
  return (
    <View style={styles.composer}>
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pending}>
          {files.map((file, index) => (
            <Animated.View key={`${file.uri}-${index}`} entering={FadeIn.duration(150)} style={styles.pendingItem}>
              {file.mimeType.startsWith("image/") ? (
                <Image source={{ uri: file.uri }} style={styles.pendingThumb} contentFit="cover" />
              ) : (
                <View style={[styles.pendingThumb, styles.pendingFile]}>
                  <Icon name="file" size={20} color={colors.muted} />
                  <Text style={styles.pendingName} numberOfLines={2}>
                    {file.name}
                  </Text>
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                hitSlop={6}
                onPress={() => setFiles((current) => current.filter((_, at) => at !== index))}
                style={styles.pendingRemove}
              >
                <Icon name="close" size={12} color={colors.onAccent} />
              </Pressable>
            </Animated.View>
          ))}
        </ScrollView>
      ) : null}
      <TextInput
        ref={input}
        defaultValue=""
        onChangeText={onChange}
        placeholder={files.length ? "Add a caption" : "Text or a link for your computer"}
        placeholderTextColor={colors.muted}
        keyboardAppearance={scheme}
        multiline
        maxLength={MAX_SHARE_TEXT}
        accessibilityLabel="Text to send to your computer"
        style={styles.input}
      />
      <View style={styles.composerActions}>
        <ActionButton icon="clipboard" label="Clipboard" onPress={() => void sendClipboard()} />
        <ActionButton icon="attachment" label="Files" onPress={() => void pickFiles()} />
        <View style={styles.spacer} />
        {isLink && !files.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send and open on the computer"
            onPress={sendAndOpen}
            style={({ pressed }) => [styles.openThere, pressed && styles.pressedScale]}
          >
            <Icon name="openLink" size={18} color={colors.accent} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={files.length > 1 ? `Send ${files.length} files` : "Send"}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => [styles.sendButton, !canSend && styles.disabled, pressed && styles.pressedScale]}
        >
          <Icon name="send" size={18} color={colors.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

function PinBar({
  row,
  count,
  index,
  onPress,
}: {
  row: ShareRow;
  count: number;
  index: number;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const head = row.items.find((item) => item.text !== undefined) ?? row.items[0];
  const label = head.kind === "file" ? (head.name ?? "File") : (head.text ?? "").replace(/\s+/g, " ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pinned ${index + 1} of ${count}: ${label}`}
      accessibilityHint="Shows the pinned message"
      onPress={onPress}
      style={({ pressed }) => [styles.pinBar, pressed && styles.pressed]}
    >
      <View style={styles.pinTicks}>
        {Array.from({ length: Math.min(count, 4) }, (_, at) => (
          <View
            key={at}
            style={[styles.pinTick, { backgroundColor: at === index % 4 ? colors.accent : withAlpha(colors.accent, 0.3) }]}
          />
        ))}
      </View>
      <Icon name="pin" size={16} color={colors.accent} />
      <Text style={styles.pinText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ShareBubble({
  row,
  copiedId,
  selected,
  cards,
  cardStyle,
  onOpen,
  onSelect,
  onRemove,
  onCopy,
}: {
  row: ShareRow;
  copiedId: string | null;
  selected: boolean;
  cards: Command | null;
  cardStyle: NonNullable<ReturnType<typeof useConnection>["catalog"]["linkPreviews"]>["cardStyle"];
  onOpen: (entry: PhoneShareEntry) => void;
  onSelect: () => void;
  onRemove: () => void;
  onCopy: (id: string, text: string) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const head = row.items[row.items.length - 1];
  const mine = head.direction === "out";
  const pinned = row.items.some((item) => item.pinned);
  const saved = row.items.some((item) => item.saved);
  const failed = row.items.some((item) => item.status === "failed");
  const pictures = row.items.filter(isPicture);
  const files = row.items.filter((item) => item.kind === "file" && !isPicture(item));
  const texts = row.items.filter((item) => item.kind !== "file");
  const ids = row.items.map((item) => item.id);
  const copyText = texts.map((item) => item.text ?? "").join("\n\n");
  const meta = `${shareCaption(head)} · ${timeOf(head.at)}`;
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
      onSwipeableOpen={onRemove}
    >
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            pictures.length > 0 && styles.bubblePicture,
            failed && styles.bubbleFailed,
            selected && styles.bubbleSelected,
          ]}
        >
          {pictures.length === 1 ? (
            <Picture entry={pictures[0]} onOpen={onOpen} onLongPress={onSelect} />
          ) : pictures.length > 1 ? (
            <View style={styles.grid}>
              {pictures.map((entry) => (
                <Picture key={entry.id} entry={entry} square onOpen={onOpen} onLongPress={onSelect} />
              ))}
            </View>
          ) : null}
          {files.map((entry) => (
            <FileLine key={entry.id} entry={entry} onOpen={onOpen} onLongPress={onSelect} />
          ))}
          {texts.map((entry) => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityHint={entry.kind === "link" ? "Opens the link" : "Copies the text"}
              onPress={() => onOpen(entry)}
              onLongPress={onSelect}
              style={({ pressed }) => [styles.textBlock, pictures.length > 0 && styles.caption, pressed && styles.pressed]}
            >
              {entry.kind === "link" ? (
                <>
                  <View style={styles.bubbleHead}>
                    <Icon name="openLink" size={16} color={mine ? colors.muted : colors.accent} />
                    <Text style={[styles.title, styles.link]} numberOfLines={3}>
                      {entry.text}
                    </Text>
                  </View>
                  {cards && entry.text ? <LinkCard url={entry.text} style={cardStyle} command={cards} /> : null}
                </>
              ) : entry.kind === "clipboard" ? (
                <View style={styles.bubbleHead}>
                  <Icon name={copiedId === entry.id ? "check" : KIND_ICON.clipboard} size={16} color={colors.muted} />
                  <Text style={styles.title} numberOfLines={8}>
                    {entry.text}
                  </Text>
                </View>
              ) : (
                <View pointerEvents="none">
                  <Markdown text={(entry.text ?? "").slice(0, 4000)} />
                </View>
              )}
            </Pressable>
          ))}
          <View style={[styles.footer, pictures.length > 0 && !texts.length && styles.pictureMeta]}>
            {pinned ? <Icon name="pin" size={11} color={colors.muted} /> : null}
            {saved ? <Icon name="bookmark" size={11} color={colors.muted} /> : null}
            <Text style={[styles.meta, failed && styles.metaFailed]} numberOfLines={1}>
              {copiedId && ids.includes(copiedId) ? "Copied" : meta}
            </Text>
          </View>
          {row.items.map((entry) =>
            entry.status === "failed" && entry.error ? (
              <Pressable key={entry.id} onPress={() => onOpen(entry)} accessibilityRole="button">
                <Text style={styles.error} numberOfLines={2}>
                  {entry.error} · Tap to try again
                </Text>
              </Pressable>
            ) : null,
          )}
        </View>
      </View>
      {selected ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(120)}
          style={[styles.actions, mine && styles.actionsMine]}
        >
          <BubbleAction icon="pin" label={pinned ? "Unpin" : "Pin"} onPress={() => pinShares(ids, !pinned)} />
          <BubbleAction icon="bookmark" label={saved ? "Unsave" : "Save"} onPress={() => saveShares(ids, !saved)} />
          {copyText ? <BubbleAction icon="copy" label="Copy" onPress={() => onCopy(head.id, copyText)} /> : null}
          <BubbleAction icon="trash" label="Delete" destructive onPress={onRemove} />
        </Animated.View>
      ) : null}
    </ReanimatedSwipeable>
  );
}

/** A picture at its own shape (or a square in a group), tap to open. */
function Picture({
  entry,
  square = false,
  onOpen,
  onLongPress,
}: {
  entry: PhoneShareEntry;
  square?: boolean;
  onOpen: (entry: PhoneShareEntry) => void;
  onLongPress: () => void;
}) {
  const styles = useStyles();
  const [aspect, setAspect] = useState(4 / 3);
  const [broken, setBroken] = useState(false);
  const uri = shareThumbnail(entry);
  const width = square ? GRID_CELL : Math.min(PICTURE_MAX_WIDTH, PICTURE_MAX_HEIGHT * aspect);
  const height = square ? GRID_CELL : width / aspect;
  if (!uri || broken) return <FileLine entry={entry} onOpen={onOpen} onLongPress={onLongPress} />;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={`${entry.name ?? "Picture"}. Opens the picture`}
      onPress={() => onOpen(entry)}
      onLongPress={onLongPress}
    >
      <Image
        source={{ uri }}
        style={[styles.picture, { width, height }]}
        contentFit="cover"
        recyclingKey={entry.id}
        transition={120}
        accessibilityIgnoresInvertColors
        onLoad={({ source }) => {
          if (source.width > 0 && source.height > 0) setAspect(source.width / source.height);
        }}
        onError={() => setBroken(true)}
      />
      {entry.status === "moving" ? <Progress value={entry.progress ?? 0} overlay /> : null}
    </Pressable>
  );
}

/** A file: icon, name and size; Download while it waits on the computer. */
function FileLine({
  entry,
  onOpen,
  onLongPress,
}: {
  entry: PhoneShareEntry;
  onOpen: (entry: PhoneShareEntry) => void;
  onLongPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const offered = entry.status === "offered";
  const moving = entry.status === "moving" || (entry.status === "queued" && entry.kind === "file");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.name ?? "File"}${entry.size !== undefined ? `, ${formatShareSize(entry.size)}` : ""}`}
      accessibilityHint={offered ? "Downloads the file" : "Opens the file"}
      onPress={() => onOpen(entry)}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.fileLine, pressed && styles.pressed]}
    >
      <View style={styles.fileIcon}>
        {moving ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Icon name={offered ? "download" : "file"} size={18} color={offered ? colors.accent : colors.muted} />
        )}
      </View>
      <View style={styles.fileText}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.name ?? "File"}
        </Text>
        <Text style={styles.meta}>
          {entry.size !== undefined ? formatShareSize(entry.size) : ""}
          {offered ? " · Tap to download" : ""}
        </Text>
        {entry.status === "moving" ? <Progress value={entry.progress ?? 0} /> : null}
      </View>
    </Pressable>
  );
}

function Progress({ value, overlay = false }: { value: number; overlay?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.track, overlay && styles.trackOverlay]}>
      <View style={[styles.bar, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

function BubbleAction({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const tint = destructive ? colors.deletions : colors.content;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.bubbleAction, pressed && styles.pressedScale]}
    >
      <Icon name={icon} size={15} color={tint} />
      <Text style={[styles.bubbleActionLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: IconName;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressedScale]}
    >
      {icon ? <Icon name={icon} size={14} color={active ? colors.accent : colors.muted} /> : null}
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
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
    minHeight: 56,
    maxHeight: 180,
    color: colors.content,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
    padding: 0,
  },
  pending: { gap: 8 },
  pendingItem: { position: "relative" },
  pendingThumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.stroke },
  pendingFile: { alignItems: "center", justifyContent: "center", padding: 4, gap: 2 },
  pendingName: { color: colors.muted, fontSize: 10, textAlign: "center" },
  pendingRemove: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.content, 0.7),
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
  openThere: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
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
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, paddingHorizontal: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: withAlpha(colors.accent, 0.14) },
  chipLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipLabelActive: { color: colors.accent },
  storage: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  toolbarButton: { minHeight: 40, justifyContent: "center", paddingLeft: 4 },
  clearLabel: { color: colors.deletions, fontSize: 14, fontWeight: "600" },
  empty: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 32 },
  pinBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  pinTicks: { gap: 2, justifyContent: "center" },
  pinTick: { width: 3, height: 6, borderRadius: 1.5 },
  pinText: { flex: 1, color: colors.content, fontSize: 14 },
  day: {
    alignSelf: "center",
    marginTop: 16,
    marginBottom: 8,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-start", paddingVertical: 3 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "86%",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.content, 0.08),
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  bubbleMine: { backgroundColor: withAlpha(colors.accent, 0.16), borderBottomRightRadius: 6 },
  bubblePicture: { padding: 4, overflow: "hidden" },
  bubbleFailed: { borderWidth: 1, borderColor: withAlpha(colors.deletions, 0.5) },
  bubbleSelected: { borderWidth: 1.5, borderColor: colors.accent },
  bubbleHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  textBlock: { gap: 6 },
  caption: { paddingHorizontal: 8, paddingTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, maxWidth: GRID_CELL * 2 + 4 },
  picture: { borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.stroke },
  fileLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 2 },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  fileText: { flexShrink: 1, gap: 2 },
  footer: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4 },
  pictureMeta: { paddingHorizontal: 8, paddingBottom: 2 },
  pressed: { opacity: 0.6 },
  title: { flexShrink: 1, color: colors.content, fontSize: 15, lineHeight: 20 },
  link: { color: colors.accent },
  meta: { color: colors.muted, fontSize: 11, fontVariant: ["tabular-nums"] },
  metaFailed: { color: colors.deletions },
  error: { color: colors.deletions, fontSize: 13, lineHeight: 18 },
  track: {
    height: 3,
    marginTop: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: withAlpha(colors.accent, 0.16),
  },
  trackOverlay: { position: "absolute", left: 8, right: 8, bottom: 8 },
  bar: { height: 3, backgroundColor: colors.accent },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingVertical: 4 },
  actionsMine: { justifyContent: "flex-end" },
  bubbleAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  bubbleActionLabel: { fontSize: 13, fontWeight: "600" },
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
