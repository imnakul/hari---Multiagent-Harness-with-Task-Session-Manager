import * as Clipboard from "expo-clipboard";
import Storage from "expo-sqlite/kv-store";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useNavigation } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { KeyboardEvents } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, LinearTransition, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { canSaveToDownloads, openNativeFile, pickedFileName } from "@/features/liveUpdates/nativeLive";
import { withLiftHeld } from "@/features/sessions/liftHold";
import { Markdown } from "@/features/sessions/Markdown";
import { fillsWidth } from "@/features/sessions/markdownParser";
import { QuickChatScrollView } from "@/features/sessions/QuickChatScrollView";
import { useKeyboardLift } from "@/features/sessions/SessionScreen";
import { SettingsPage } from "@/features/settings/SettingsUI";
import {
  formatShareSize,
  kindForText,
  MAX_SHARE_FILES,
  MAX_SHARE_TEXT,
  matchesShareSearch,
  shareCaption,
  shareCounted,
  shareStamp,
  shareState,
  shareRows,
  SHARE_PAGE,
  nextShareWindow,
  shareWindowFor,
  shareThumbnail,
  type PhoneShareEntry,
  type ShareRow,
  isLongShareText,
  nextShareFollow,
  sharePinsOnResize,
  sharePinsToEnd,
  type ShareFollow,
  type ShareScrollEvent,
} from "@/features/share/shareModel";
import { readShareDraft, writeShareFiles, writeShareText } from "@/features/share/shareDraft";
import { useShareHistory, useShareLimit } from "@/features/share/shareStore";
import {
  fetchShareFile,
  openOnComputer,
  pinShares,
  removeSharesEverywhere,
  retryShare,
  saveShares,
  sendShareGroup,
  sendShareText,
  shareStorage,
  useShareHistoryFilling,
  type ShareFile,
} from "@/features/share/shareTransfers";
import { LinkCard } from "@/features/tools/LinkCard";
import { ShareBackdrop } from "@/features/wallpaper/Backdrop";
import { createTask, newId, saveNote, titleFrom } from "@/features/tools/tools";
import type { Command } from "@/features/tools/tools";
import { ChoiceSheet, type MenuAction } from "@/ui/ChoiceMenu";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, useScheme, withAlpha } from "@/ui/theme";

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

const isPicture = (entry: PhoneShareEntry) => shareThumbnail(entry) !== null;

/** Fork (Hari, L-316): the composer's gap above the keyboard, as in a session. */
const KEYBOARD_GAP = 8;
// Fork (Hari, L-412): the space between the composer and the tab bar.
const TABS_COMPOSER_GAP = 10;
/** Fork (Hari, L-323): how long after opening the list may still fill in. */
const SETTLE_MS = 1500;
const REMOVE_GLIDE_MS = 200;
/** Fork (Hari, L-326): the note saying which side is which, shown until closed once. */
const DIRECTIONS_SEEN_KEY = "hari.shareDirectionsSeen";

function readDirectionsSeen(): boolean {
  try {
    return Storage.getItemSync(DIRECTIONS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** A message's words: its text, else its files by name. */
const messageText = (row: ShareRow): string =>
  row.items
    .filter((item) => item.kind !== "file")
    .map((item) => item.text ?? "")
    .join("\n\n");
const messageBody = (row: ShareRow): string =>
  messageText(row) ||
  row.items
    .filter((item) => item.kind === "file")
    .map((item) => item.name ?? "File")
    .join(", ");

/** Runs a menu action that talks to the computer, as the footer's buttons did. */
function runTool(label: string, run: () => Promise<unknown>) {
  run().then(
    () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    (reason: unknown) => Alert.alert(`Couldn’t ${label.toLowerCase()}`, why(reason)),
  );
}

/**
 * Fork (Hari, L-326): what a hold on a message offers, above Delete. L-330:
 * Add to notes, Add task and Pin live here only, so the row under a message
 * keeps just Copy and Save.
 */
function messageMenu(row: ShareRow, cards: Command | null): MenuAction[] {
  const ids = row.items.map((item) => item.id);
  const pinned = row.items.some((item) => item.pinned);
  const saved = row.items.some((item) => item.saved);
  const body = messageBody(row);
  return [
    ...(cards && body
      ? [
          {
            label: "Add to notes",
            icon: "noteAdd" as const,
            onPress: () =>
              runTool("Add to notes", async () => {
                const note = await saveNote(cards, {
                  id: newId(),
                  title: titleFrom(body),
                  body,
                  baseUpdatedAt: null,
                  finalize: true,
                });
                if (note.conflict) throw new Error("The note couldn’t be saved. Try again.");
              }),
          },
          {
            label: "Add task",
            icon: "taskAdd" as const,
            onPress: () => runTool("Add task", () => createTask(cards, { body })),
          },
        ]
      : []),
    { label: pinned ? "Unpin" : "Pin", icon: "pin", onPress: () => pinShares(ids, !pinned) },
    { label: saved ? "Unsave" : "Save", icon: "bookmark", onPress: () => saveShares(ids, !saved) },
  ];
}

/**
 * Fork (Hari, L-279): text, links, the clipboard and files between this phone
 * and the paired computer. L-288: a chat with the computer, by day.
 * L-290: WhatsApp-style: pictures keep their shape, files sent together are
 * one message, text reads as Markdown, links show cards, messages can be
 * pinned (bar at the top) and saved (never roll off), big files from the
 * computer wait for Download, and Delete all frees this phone's space.
 * L-316: laid out as a session's chat: oldest at the top, newest at the
 * bottom, and the composer at the bottom, riding on the keyboard.
 */
/**
 * `tabBarHeight`: set in the Tabs layout (L-412), where the composer sits on
 * the tab bar rather than the screen's bottom edge, so the keyboard covers
 * the bar as well and the lift subtracts it.
 */
export function SharePanel({ tabBarHeight }: { tabBarHeight?: number } = {}) {
  const styles = useStyles();
  const { pairing, command, catalog } = useConnection();
  const history = useShareHistory();
  const filling = useShareHistoryFilling();
  const colors = useColors();
  const [savedOnly, setSavedOnly] = useState(false);
  // Fork (Hari, L-357): search, from the magnifier in the toolbar. Null while closed.
  const [query, setQuery] = useState<string | null>(null);
  const limit = useShareLimit();
  const scheme = useScheme();
  const [selected, setSelected] = useState<string | null>(null);
  // Fork (Hari, L-326): the message a hold opened the menu for.
  const [menuRow, setMenuRow] = useState<ShareRow | null>(null);
  const [directionsSeen, setDirectionsSeen] = useState(readDirectionsSeen);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pinIndex, setPinIndex] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const rowsAt = useRef(new Map<string, number>());
  // Fork (Hari, L-414): only the newest messages are drawn, more as you
  // scroll back; a pinned one further back is drawn, then scrolled to.
  const [shown, setShown] = useState(SHARE_PAGE);
  const pendingJump = useRef<string | null>(null);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const inTabs = tabBarHeight !== undefined;
  const composerBottom = inTabs ? TABS_COMPOSER_GAP : Math.max(insets.bottom, 12);
  const keyboardOffset = composerBottom + (tabBarHeight ?? 0) - KEYBOARD_GAP;
  const keyboardLift = useKeyboardLift(keyboardOffset);
  // Fork (Hari, L-414): out of view (another tab, or a page over it), the
  // list ignores the keyboard. It stays loaded, and re-laid out every frame
  // of a keyboard raised elsewhere, it slowed that keyboard's rise. A shared
  // value, set from navigation events, as a frozen screen doesn't render.
  const navigation = useNavigation();
  const away = useSharedValue(!navigation.isFocused());
  useEffect(() => {
    const offFocus = navigation.addListener("focus", () => away.set(false));
    const offBlur = navigation.addListener("blur", () => away.set(true));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation, away]);
  // Opens at its end and follows new messages there; not when scrolled back.
  // Fork (Hari, L-409): a drag stops the following until the list rests.
  const follow = useRef<ShareFollow>({ following: true, dragging: false });
  const onFollow = (event: ShareScrollEvent) => {
    follow.current = nextShareFollow(follow.current, event);
  };
  const placed = useRef(false);
  // Fork (Hari, L-323): for a moment after opening, link cards and pictures
  // still fill in; the end is held in place without an animated scroll, so
  // the bottom does not seem to load twice.
  const openedAt = useRef(0);
  // Rows glide into place only while one is being removed; at other times a
  // row growing (a card loading) moved the rest under it, overlapping text.
  const [removing, setRemoving] = useState(false);
  const removingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Fork (Hari, L-411): until when a size change still moves to the end.
  const holdUntil = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
    holdUntil.current = openedAt.current + SETTLE_MS;
    return () => clearTimeout(removingTimer.current);
  }, []);
  const composerHeight = useRef(0);

  // Oldest first, as a chat reads (the history is newest first).
  const rows = useMemo(() => {
    const all = shareRows(history).reverse();
    return all.filter(
      (row) => (!savedOnly || row.items.some((item) => item.saved)) && matchesShareSearch(row.items, query ?? ""),
    );
  }, [history, savedOnly, query]);
  const counted = useMemo(() => shareCounted(history), [history]);
  const drawn = rows.length > shown ? rows.slice(rows.length - shown) : rows;
  const allDrawn = drawn.length === rows.length;
  // A new message holds the end a moment, while its card or picture fills in.
  const rowCount = useRef(rows.length);
  useLayoutEffect(() => {
    if (rows.length > rowCount.current) holdUntil.current = Date.now() + SETTLE_MS;
    rowCount.current = rows.length;
  }, [rows.length]);
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
    setRemoving(true);
    clearTimeout(removingTimer.current);
    removingTimer.current = setTimeout(() => setRemoving(false), REMOVE_GLIDE_MS + 120);
    // Fork (Hari, L-317): gone from the computer's history too.
    removeSharesEverywhere(row.items.map((item) => item.id));
  };

  const jumpToPin = () => {
    if (!pinned.length) return;
    const row = pinned[pinIndex % pinned.length];
    if (savedOnly) setSavedOnly(false);
    if (query) setQuery(null);
    const all = shareRows(history);
    const index = all.length - 1 - all.findIndex((other) => other.key === row.key);
    const y = rowsAt.current.get(row.key);
    if (y !== undefined && !savedOnly && !query) scroll.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    else {
      pendingJump.current = row.key;
      setShown((current) => shareWindowFor(index, all.length, current));
    }
    setSelected(row.key);
    setPinIndex((index) => (index + 1) % pinned.length);
  };

  const storage = shareStorage();
  const pinRow = pinned.length ? pinned[pinIndex % pinned.length] : null;

  const toEnd = (animated: boolean) => scroll.current?.scrollToEnd({ animated });
  const belowOf = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement, contentInset } = nativeEvent;
    return contentSize.height + (contentInset?.bottom ?? 0) - contentOffset.y - layoutMeasurement.height;
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onFollow({ type: "scroll", below: belowOf(event) });
    const fromTop = event.nativeEvent.contentOffset.y;
    if (!allDrawn) setShown((current) => nextShareWindow(current, rows.length, fromTop));
  };
  const onDragStart = () => onFollow({ type: "drag" });
  const onRest = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    onFollow({ type: "settle", below: belowOf(event) });
  const onContentSizeChange = () => {
    if (!placed.current) {
      placed.current = true;
      toEnd(false);
      return;
    }
    if (sharePinsOnResize(follow.current, Date.now(), holdUntil.current))
      toEnd(Date.now() - openedAt.current > SETTLE_MS);
  };
  // A composer growing past a line (or a file waiting in it) keeps the end in view.
  const onComposerLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const height = Math.round(nativeEvent.layout.height);
    if (height === composerHeight.current) return;
    composerHeight.current = height;
    if (sharePinsToEnd(follow.current)) requestAnimationFrame(() => toEnd(false));
  };

  return (
    <View style={[styles.chat, { paddingTop: headerHeight + 8 }]}>
      {/* Fork (Hari, L-328): Share's own background, if set in Appearance. */}
      <ShareBackdrop />
      <View style={[styles.top, inTabs && styles.topInTabs]}>
        {history.length ? (
          <View style={styles.toolbar}>
            <Chip label="All" active={!savedOnly} onPress={() => setSavedOnly(false)} />
            <Chip label="Saved" icon="bookmark" active={savedOnly} onPress={() => setSavedOnly(true)} />
            <View style={styles.spacer} />
            <Text
              style={styles.storage}
              numberOfLines={1}
              accessibilityLabel={`${counted} of ${limit} kept, ${formatShareSize(storage.historyBytes + storage.filesBytes)}`}
            >
              {counted}/{limit} · {formatShareSize(storage.historyBytes + storage.filesBytes)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search"
              accessibilityState={{ selected: query !== null }}
              onPress={() => setQuery(query === null ? "" : null)}
              hitSlop={8}
              style={({ pressed }) => [styles.messageAction, pressed && styles.messageActionPressed]}
            >
              <Icon name="search" size={18} color={query !== null ? colors.accent : colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {query !== null ? (
          <View style={styles.searchRow}>
            <Icon name="search" size={16} color={colors.muted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search text, links and file names"
              placeholderTextColor={colors.muted}
              keyboardAppearance={scheme}
              returnKeyType="search"
              accessibilityLabel="Search Share"
              style={styles.searchInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close search"
              hitSlop={8}
              onPress={() => setQuery(null)}
              style={({ pressed }) => [styles.messageAction, pressed && styles.messageActionPressed]}
            >
              <Icon name="close" size={16} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {pinRow ? (
          <PinBar row={pinRow} count={pinned.length} index={pinIndex % pinned.length} onPress={jumpToPin} />
        ) : null}
      </View>

      <QuickChatScrollView
        ref={scroll}
        style={styles.list}
        contentContainerStyle={[styles.listContent, inTabs && styles.listContentInTabs]}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyboardLiftBehavior="whenAtEnd"
        freeze={away}
        offset={keyboardOffset}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={onScroll}
        onScrollBeginDrag={onDragStart}
        onScrollEndDrag={onRest}
        onMomentumScrollBegin={onDragStart}
        onMomentumScrollEnd={onRest}
        onContentSizeChange={onContentSizeChange}
        // Earlier messages drawn above keep the one in view where it is.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      >
        {/* The notes sit above the oldest message, so only once it's drawn. */}
        {allDrawn && !directionsSeen && history.length ? (
          <View style={styles.directions}>
            <Icon name="share" size={16} color={colors.muted} />
            <Text style={styles.directionsText}>
              Yours are on the right and go to your computer. Your computer&apos;s are on the left.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Got it, hide this note"
              hitSlop={8}
              onPress={() => {
                setDirectionsSeen(true);
                void Storage.setItem(DIRECTIONS_SEEN_KEY, "1").catch(() => {});
              }}
              style={({ pressed }) => [styles.messageAction, pressed && styles.messageActionPressed]}
            >
              <Icon name="close" size={14} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
        {allDrawn ? (
        <Text style={styles.hint}>
          {canSaveToDownloads
            ? "Files from your computer save to Download/Hari; big ones wait for Download. Keep Hari open while files move."
            : "Texts wait until your computer is on. Update Hari to save files to Downloads."}
        </Text>
        ) : null}

        {/* Fork (Hari, L-317): the one-time fill-in after a reinstall. */}
        {!history.length && filling ? (
          <View style={styles.filling}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.fillingText}>Loading history from your computer…</Text>
          </View>
        ) : history.length ? null : (
          <Notice
            title="Nothing shared yet"
            text="Send something from here, from any app’s share menu, or with the “Send to computer” Quick Settings tile."
          />
        )}
        {query?.trim() && history.length && !rows.length ? (
          <Text style={styles.empty}>No matches.</Text>
        ) : savedOnly && !rows.length ? (
          <Text style={styles.empty}>Long-press a message and tap Save to keep it here.</Text>
        ) : null}

        {drawn.map((row) => {
          return (
            <Animated.View
              key={row.key}
              exiting={FadeOut.duration(160)}
              layout={removing ? LinearTransition.duration(REMOVE_GLIDE_MS) : undefined}
              onLayout={({ nativeEvent }) => {
                rowsAt.current.set(row.key, nativeEvent.layout.y);
                if (pendingJump.current === row.key) {
                  pendingJump.current = null;
                  scroll.current?.scrollTo({ y: Math.max(0, nativeEvent.layout.y - 80), animated: true });
                }
              }}
            >
              <ShareBubble
                row={row}
                copiedId={copiedId}
                selected={selected === row.key}
                cards={cards}
                cardStyle={catalog.linkPreviews?.cardStyle ?? "compact"}
                onOpen={open}
                onSelect={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSelected(row.key);
                  setMenuRow(row);
                }}
                onCopy={copy}
              />
            </Animated.View>
          );
        })}
      </QuickChatScrollView>

      <ChoiceSheet
        open={menuRow !== null}
        title="Message"
        sections={
          menuRow
            ? [
                messageMenu(menuRow, cards),
                [{ label: "Delete", icon: "trash", destructive: true, onPress: () => remove(menuRow) }],
              ]
            : []
        }
        onClose={() => {
          setMenuRow(null);
          setSelected(null);
        }}
      />

      <Animated.View style={[keyboardLift, { paddingBottom: composerBottom }]} onLayout={onComposerLayout}>
        <ShareComposer
          roomy={inTabs}
          command={command}
          onSent={() => {
            onFollow({ type: "sent" });
            requestAnimationFrame(() => toEnd(true));
          }}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The composer. The field is uncontrolled (as the session composer), so
 * typing never re-renders the timeline; only "empty or not" is state.
 * Files wait above it until Send, then go as one message with the text as
 * their caption.
 */
function ShareComposer({
  command,
  onSent,
  roomy = false,
}: {
  /** A wider margin, matching the chat in the Tabs layout. */
  roomy?: boolean;
  command: ReturnType<typeof useConnection>["command"];
  /** The chat goes to its end, to show what was sent. */
  onSent: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const input = useRef<TextInput>(null);
  // Fork (Hari, L-301): what was being written comes back after leaving.
  const [initial] = useState(readShareDraft);
  const draft = useRef(initial.text);
  const [hasText, setHasText] = useState(!!initial.text.trim());
  const [isLink, setIsLink] = useState(!!initial.text.trim() && kindForText(initial.text.trim()) === "link");
  const [files, setFilesState] = useState<ShareFile[]>(initial.files);
  const setFiles = (update: (current: ShareFile[]) => ShareFile[]) =>
    setFilesState((current) => {
      const next = update(current);
      writeShareFiles(next);
      return next;
    });

  const onChange = (text: string) => {
    draft.current = text;
    writeShareText(text);
    const filled = !!text.trim();
    if (filled !== hasText) setHasText(filled);
    const link = filled && kindForText(text.trim()) === "link";
    if (link !== isLink) setIsLink(link);
  };

  const reset = () => {
    input.current?.clear();
    draft.current = "";
    writeShareText("");
    setHasText(false);
    setIsLink(false);
    setFiles(() => []);
  };

  const send = () => {
    if (!hasText && !files.length) return;
    if (files.length) sendShareGroup(files, draft.current, command);
    else sendShareText(draft.current, false);
    reset();
    onSent();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const sendAndOpen = () => {
    try {
      openOnComputer(draft.current);
      reset();
      onSent();
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
    onSent();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const pickFiles = async () => {
    try {
      // Fork (Hari, L-316): on the keyboard now, so it stays put as the picker opens (L-309).
      const picked = await withLiftHeld(() => File.pickFileAsync({ multipleFiles: true }));
      if (picked.canceled) return;
      const chosen = picked.result.map((file) => ({
        uri: file.uri,
        name: pickedFileName(file.uri, file.name),
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

  // Fork (Hari, L-414): one line at rest, as the session chat's field; it
  // opens into the card while focused or holding a draft.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    // Android hides the keyboard without blurring the field; let it close.
    // L-417: as the keyboard starts down, not when Android's ~1 s slide ends,
    // so the box folds to one line with it.
    const off = KeyboardEvents.addListener("keyboardWillHide", () => input.current?.blur());
    return () => off.remove();
  }, []);
  const canSend = hasText || files.length > 0;
  const expanded = focused || canSend;
  return (
    <View style={[styles.composer, roomy && styles.composerRoomy, !expanded && styles.composerPill]}>
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
      {expanded ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Files"
          onPress={() => void pickFiles()}
          style={({ pressed }) => [styles.openThere, pressed && styles.pressedScale]}
        >
          <Icon name="attachment" size={18} color={colors.accent} />
        </Pressable>
      )}
      <TextInput
        ref={input}
        defaultValue={initial.text}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        placeholder={files.length ? "Add a caption" : "Text or a link for your computer"}
        placeholderTextColor={colors.muted}
        keyboardAppearance={scheme}
        multiline
        maxLength={MAX_SHARE_TEXT}
        accessibilityLabel="Text to send to your computer"
        style={[styles.input, !expanded && styles.inputPill]}
      />
      {expanded ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send the clipboard"
          onPress={() => void sendClipboard()}
          style={({ pressed }) => [styles.openThere, pressed && styles.pressedScale]}
        >
          <Icon name="clipboard" size={18} color={colors.accent} />
        </Pressable>
      )}
      {expanded ? (
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
      ) : null}
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

/**
 * Fork (Hari, L-366): a text message in Share. Its tables and code scroll
 * sideways (a tap still copies, a hold still opens the menu: the words don't
 * select here), and a long one folds behind Show more, as on the computer.
 */
function ShareText({ text }: { text: string }) {
  const styles = useStyles();
  const long = isLongShareText(text);
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={long && !open ? styles.textFolded : null}>
        <Markdown text={text} selectable={false} />
      </View>
      {long ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen((value) => !value)}>
          <Text style={styles.showMore}>{open ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
    </View>
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
  onCopy,
}: {
  row: ShareRow;
  copiedId: string | null;
  selected: boolean;
  cards: Command | null;
  cardStyle: NonNullable<ReturnType<typeof useConnection>["catalog"]["linkPreviews"]>["cardStyle"];
  onOpen: (entry: PhoneShareEntry) => void;
  onSelect: () => void;
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
  const copied = !!copiedId && ids.includes(copiedId);
  const state = copied ? "Copied" : shareState(head);
  // Fork (Hari, L-301): no swipe to delete; a swipe here moves between
  // Computer and Share. L-326: a hold anywhere on the bubble opens its menu
  // (Pin, Save, Delete); before, only a hold on its text did.
  return (
    <View>
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <Pressable
          accessibilityLabel={shareCaption(head)}
          accessibilityActions={[{ name: "longpress", label: "Pin, save or delete" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "longpress") onSelect();
          }}
          onLongPress={onSelect}
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            pictures.length > 0 && styles.bubblePicture,
            // Fork (Hari, L-317): a link's card at full width, as on the computer.
            // L-333: Markdown lists, code, tables, quotes and rules stretch, so they take the full bubble too.
            texts.some((item) => item.kind === "link" || (item.kind === "text" && fillsWidth((item.text ?? "").slice(0, 4000)))) &&
              styles.bubbleLink,
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
                  {cards && entry.text ? (
                    <LinkCard url={entry.text} style={cardStyle} command={cards} onLongPress={onSelect} />
                  ) : null}
                </>
              ) : entry.kind === "clipboard" ? (
                <View style={styles.bubbleHead}>
                  <Icon name={copiedId === entry.id ? "check" : KIND_ICON.clipboard} size={16} color={colors.muted} />
                  <Text style={styles.title} numberOfLines={8}>
                    {entry.text}
                  </Text>
                </View>
              ) : (
                <ShareText text={(entry.text ?? "").slice(0, 4000)} />
              )}
            </Pressable>
          ))}
          {/* L-330: no bookmark here; Save under the message already shows it. */}
          {pinned || state ? (
            <View style={[styles.footer, pictures.length > 0 && !texts.length && styles.pictureMeta]}>
              {pinned ? <Icon name="pin" size={11} color={colors.muted} /> : null}
              {state ? (
                <Text style={[styles.meta, failed && styles.metaFailed]} numberOfLines={1}>
                  {state}
                </Text>
              ) : null}
            </View>
          ) : null}
          {row.items.map((entry) =>
            entry.status === "failed" && entry.error ? (
              <Pressable key={entry.id} onPress={() => onOpen(entry)} accessibilityRole="button">
                <Text style={styles.error} numberOfLines={2}>
                  {entry.error} · Tap to try again
                </Text>
              </Pressable>
            ) : null,
          )}
        </Pressable>
      </View>
      <MessageActions
        row={row}
        mine={mine}
        saved={saved}
        copyText={copyText}
        copied={copied}
        stamp={shareStamp(head.at)}
        onCopy={() => onCopy(head.id, copyText)}
      />
    </View>
  );
}

/**
 * Fork (Hari, L-301): under every message, as under a chat reply. L-330: Copy
 * and Save only (Add to notes, Add task and Pin are in the hold menu), with
 * the day and time beside them, on the message's own side.
 */
function MessageActions({
  row,
  mine,
  saved,
  copyText,
  copied,
  stamp,
  onCopy,
}: {
  row: ShareRow;
  mine: boolean;
  saved: boolean;
  copyText: string;
  copied: boolean;
  stamp: string;
  onCopy: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ids = row.items.map((item) => item.id);
  const tint = withAlpha(colors.content, 0.4);
  const copyAll = async () => {
    if (copyText) {
      onCopy();
      return;
    }
    // A picture copies as a picture; other files by name.
    const picture = row.items.find((item) => isPicture(item) && item.uri);
    try {
      if (picture?.uri) {
        await Clipboard.setImageAsync(await new File(picture.uri).base64());
      } else {
        await Clipboard.setStringAsync(messageBody(row));
      }
      void Haptics.selectionAsync();
    } catch (reason) {
      Alert.alert("Couldn’t copy it", why(reason));
    }
  };
  const time = (
    <Text style={styles.meta} numberOfLines={1}>
      {stamp}
    </Text>
  );
  return (
    <View style={[styles.messageActions, mine && styles.messageActionsMine]}>
      {mine ? time : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy"}
        hitSlop={6}
        onPress={() => void copyAll()}
        style={({ pressed }) => [styles.messageAction, pressed && styles.messageActionPressed]}
      >
        <Icon name={copied ? "check" : "copy"} size={16} color={tint} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? "Unsave" : "Save"}
        accessibilityState={{ selected: saved }}
        hitSlop={6}
        onPress={() => {
          void Haptics.selectionAsync();
          saveShares(ids, !saved);
        }}
        style={({ pressed }) => [styles.messageAction, pressed && styles.messageActionPressed]}
      >
        <Icon name="bookmark" size={16} color={saved ? colors.accent : tint} />
      </Pressable>
      {mine ? null : time}
    </View>
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
    marginHorizontal: 12,
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
  chat: { flex: 1 },
  top: { paddingHorizontal: 20, gap: 8 },
  topInTabs: { paddingHorizontal: 24 },
  listContentInTabs: { paddingHorizontal: 24 },
  composerRoomy: { marginHorizontal: 18 },
  composerPill: { flexDirection: "row", alignItems: "center", padding: 6, gap: 8, borderRadius: radii.pill },
  inputPill: { flex: 1, minHeight: 22, maxHeight: 44, textAlignVertical: "center" },
  list: { flex: 1 },
  listContent: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 8, paddingHorizontal: 4 },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.content, fontSize: 15, paddingVertical: 8 },
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
  bubbleLink: { width: "86%" },
  filling: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 24 },
  fillingText: { color: colors.muted, fontSize: 14 },
  // L-310: a thin frame, as the desktop's 4 px reads on a computer screen.
  bubblePicture: { padding: 2, overflow: "hidden" },
  bubbleFailed: { borderWidth: 1, borderColor: withAlpha(colors.deletions, 0.5) },
  bubbleSelected: { borderWidth: 1.5, borderColor: colors.accent },
  bubbleHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  textBlock: { gap: 6 },
  caption: { paddingHorizontal: 8, paddingTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 4, maxWidth: GRID_CELL * 2 + 4 },
  picture: { borderRadius: 16, borderCurve: "continuous", backgroundColor: colors.stroke },
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
  textFolded: { maxHeight: 224, overflow: "hidden" },
  showMore: { marginTop: 4, color: withAlpha(colors.content, 0.6), fontSize: 13 },
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
  messageActions: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 6 },
  messageAction: { padding: 4, borderRadius: 6 },
  // Fork (Hari, L-330): under the message, on its side.
  messageActionsMine: { justifyContent: "flex-end" },
  directions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: withAlpha(colors.content, 0.06),
  },
  directionsText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
  messageActionPressed: { backgroundColor: withAlpha(colors.content, 0.08) },
  notice: { alignItems: "center", gap: 8, marginTop: 48, paddingHorizontal: 24 },
  noticeTitle: { color: colors.content, fontSize: 17, fontWeight: "600", textAlign: "center" },
  noticeText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
}));
