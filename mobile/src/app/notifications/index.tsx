import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";

import { useConnection } from "@/features/connection/ConnectionProvider";
import {
  clearFeed,
  dismissFeed,
  readFeed,
  refreshFeed,
  shownFeedItems,
  useFeed,
  type FeedItem,
  type FeedKind,
} from "@/features/notifications/notificationFeed";
import { useFeedPreferences } from "@/features/settings/notificationFeed";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { chatTime } from "@/features/workspace/relativeTime";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

const KIND: Record<FeedKind, { label: string; icon: IconName }> = {
  finished: { label: "Finished", icon: "check" },
  approval: { label: "Needs approval", icon: "shield" },
  question: { label: "Question", icon: "info" },
  automationSucceeded: { label: "Automation", icon: "automation" },
  automationFailed: { label: "Automation failed", icon: "automation" },
};
/** How far a row slides before letting go removes it. */
const SWIPE_DISTANCE = 96;

const why = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/**
 * Fork (Hari, L-275): the desktop bell's history, newest first. A swipe
 * either way removes one; a tap marks it read and opens its chat. Mark all
 * read and Clear change the bell on the computer too.
 */
export default function NotificationsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const feed = useFeed();
  const { catalog } = useConnection();
  const [{ seenOnDesktop }] = useFeedPreferences();
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);

  const items = feed.phase === "ready" ? shownFeedItems(feed.items, seenOnDesktop) : [];
  const unread = items.filter((item) => !item.read).length;

  const act = async (title: string, action: () => Promise<void>) => {
    setWorking(true);
    try {
      await action();
    } catch (reason) {
      Alert.alert(title, why(reason));
    } finally {
      setWorking(false);
    }
  };

  const open = (item: FeedItem) => {
    if (!item.read)
      void readFeed([item.id]).catch((reason: unknown) =>
        console.warn("Could not mark the notification read", reason),
      );
    if (!item.sessionId || !item.projectId) return;
    if (!catalog.projects.some((project) => project.id === item.projectId)) {
      Alert.alert(
        "Chat isn’t on this phone",
        `Add ${item.projectName ?? "its project"} in Settings → Workspace to open its chats here.`,
      );
      return;
    }
    const { projectId, sessionId } = item;
    router.back();
    router.push({
      pathname: "/project/[projectId]/session/[sessionId]",
      params: { projectId, sessionId },
    });
  };

  const remove = (item: FeedItem) => {
    void Haptics.selectionAsync();
    void dismissFeed([item.id]).catch((reason: unknown) =>
      Alert.alert("Couldn’t remove the notification", why(reason)),
    );
  };

  const clearAll = () =>
    Alert.alert("Clear all notifications?", "They go from the bell on your computer too.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: () => void act("Couldn’t clear the notifications", clearFeed),
      },
    ]);

  return (
    <SettingsPage
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void refreshFeed().finally(() => setRefreshing(false));
      }}
    >
      {feed.phase === "ready" && items.length ? (
        <View style={styles.toolbar}>
          <Text style={styles.count} accessibilityRole="header">
            {unread ? `${unread} unread` : "All read"}
          </Text>
          <ToolbarButton
            label="Mark all read"
            disabled={!unread || working}
            onPress={() => void act("Couldn’t mark them read", () => readFeed())}
          />
          <ToolbarButton label="Clear all" disabled={working} onPress={clearAll} destructive />
        </View>
      ) : null}

      {feed.phase === "loading" ? (
        feed.error ? (
          <Notice
            title="Couldn’t reach your computer"
            text={feed.error}
            action={{ label: "Try again", onPress: () => void refreshFeed() }}
          />
        ) : (
          <ActivityIndicator style={styles.loading} color={colors.muted} />
        )
      ) : null}
      {feed.phase === "unsupported" ? (
        <Notice
          title="Update MonoCode on your computer"
          text="This version can’t send its notifications to Hari yet."
        />
      ) : null}
      {feed.phase === "waiting" ? (
        <Notice
          title="Waiting for MonoCode"
          text="Open a MonoCode window on your computer, and its notifications show here."
        />
      ) : null}
      {feed.phase === "ready" && !items.length ? (
        <Notice
          title="No notifications"
          text="When an agent finishes, or needs your approval or an answer, it shows here."
        />
      ) : null}
      {feed.phase === "ready" && feed.error && items.length ? (
        <Text style={styles.stale} accessibilityRole="alert">
          Couldn’t refresh: {feed.error}
        </Text>
      ) : null}

      {items.length ? (
        <View style={styles.card}>
          {items.map((item, index) => (
            <Animated.View
              key={item.id}
              exiting={FadeOut.duration(160)}
              layout={LinearTransition.duration(200)}
            >
              {index > 0 ? <View style={styles.divider} /> : null}
              <NotificationRow item={item} onOpen={open} onRemove={remove} />
            </Animated.View>
          ))}
        </View>
      ) : null}
    </SettingsPage>
  );
}

function NotificationRow({
  item,
  onOpen,
  onRemove,
}: {
  item: FeedItem;
  onOpen: (item: FeedItem) => void;
  onRemove: (item: FeedItem) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const kind = KIND[item.kind];
  const tint =
    item.kind === "automationFailed"
      ? colors.deletions
      : item.kind === "approval" || item.kind === "question"
        ? colors.caution
        : colors.muted;
  const removeAction = () => (
    <View style={styles.removeAction}>
      <Icon name="trash" size={20} color={colors.deletions} />
    </View>
  );
  const meta = [kind.label, item.projectName, chatTime(item.at)].filter(Boolean).join(" · ");
  return (
    <ReanimatedSwipeable
      friction={1.5}
      leftThreshold={SWIPE_DISTANCE}
      rightThreshold={SWIPE_DISTANCE}
      renderLeftActions={removeAction}
      renderRightActions={removeAction}
      onSwipeableOpen={() => onRemove(item)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.read ? "" : "Unread. "}${item.title}. ${item.body}. ${meta}`}
        accessibilityHint={item.sessionId ? "Opens the chat" : undefined}
        accessibilityActions={[{ name: "remove", label: "Remove" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "remove") onRemove(item);
        }}
        onPress={() => onOpen(item)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.mark}>
          <Icon name={kind.icon} size={18} color={tint} />
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.title, item.read && styles.titleRead]} numberOfLines={1}>
            {item.title || "MonoCode"}
          </Text>
          {item.body ? (
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {item.read ? null : <View style={styles.dot} />}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function ToolbarButton({
  label,
  disabled,
  onPress,
  destructive = false,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  destructive?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.toolbarButton, pressed && styles.pressed]}
    >
      <Text
        style={[
          styles.toolbarLabel,
          { color: destructive ? colors.deletions : colors.accent },
          disabled && styles.disabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Notice({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.notice}>
      <Icon name="notifications" size={28} color={colors.faint} />
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeText}>{text}</Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.noticeButton, pressed && styles.pressed]}
        >
          <Text style={styles.noticeButtonLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  loading: { marginTop: 32 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  count: { flex: 1, color: colors.muted, fontSize: 15, fontVariant: ["tabular-nums"] },
  toolbarButton: { minHeight: 40, justifyContent: "center" },
  toolbarLabel: { fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  stale: { color: colors.caution, fontSize: 13, marginBottom: 8, paddingHorizontal: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 50, backgroundColor: colors.stroke },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 14,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  mark: { width: 34, paddingTop: 2 },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.content, fontSize: 16, lineHeight: 21, fontWeight: "600" },
  titleRead: { fontWeight: "400" },
  body: { color: colors.content, fontSize: 14, lineHeight: 19, opacity: 0.85 },
  meta: { color: colors.muted, fontSize: 13 },
  dot: {
    width: 8,
    height: 8,
    marginTop: 7,
    marginLeft: 6,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  removeAction: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: withAlpha(colors.deletions, 0.14),
  },
  notice: { alignItems: "center", gap: 8, marginTop: 48, paddingHorizontal: 24 },
  noticeTitle: { color: colors.content, fontSize: 17, fontWeight: "600", textAlign: "center" },
  noticeText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  noticeButton: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accent, 0.14),
  },
  noticeButtonLabel: { color: colors.accent, fontSize: 15, fontWeight: "600" },
}));
