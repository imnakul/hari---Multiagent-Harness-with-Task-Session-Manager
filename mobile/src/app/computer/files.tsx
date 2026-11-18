import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { openNativeFile } from "@/features/liveUpdates/nativeLive";
import { parseFolder, type PcFileEntry, type PcFolder } from "@/features/pc/deviceModel";
import { formatBytes, pcError } from "@/features/pc/pcModel";
import { SettingsPage } from "@/features/settings/SettingsUI";
import { AUTO_DOWNLOAD_BYTES } from "@/features/share/shareModel";
import { useShareHistory } from "@/features/share/shareStore";
import { fetchShareFile } from "@/features/share/shareTransfers";
import { usePlaceSwipes } from "@/features/workspace/PlaceHeader";
import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

/**
 * Fork (Hari, L-297): the computer's files, read-only. Drives first, then
 * folders before files; hidden and system items are left out.
 * L-349: tapping a file saves it straight to Downloads/Hari on this phone,
 * at any size (over 10 MB asks first); its row shows it arrive, then opens
 * it. Share keeps one line for it, as for any file.
 */
export default function ComputerFilesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { command, connected } = useConnection();
  // Fork (Hari, L-347): the folder it was left in, when the side menu rebuilds it.
  const { path: startPath } = useLocalSearchParams<{ path?: string }>();
  const [folder, setFolder] = useState<PcFolder | null>(null);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  // Each file sent from here (its path) to its Share entry.
  const [sent, setSent] = useState<Record<string, string>>({});
  const history = useShareHistory();
  const sentEntry = (path: string) => {
    const id = sent[path];
    return id ? history.find((item) => item.id === id) : undefined;
  };

  const open = useCallback(
    async (next: string, offset = 0): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        const page = parseFolder(await command<unknown>("pc.files.list", { path: next, offset }));
        setFolder((current) =>
          offset > 0 && current && current.path === page.path
            ? { ...page, entries: [...current.entries, ...page.entries] }
            : page,
        );
        setPath(page.path);
        // In the route, where the side menu's memory reads it (L-347).
        router.setParams({ path: page.path });
        return true;
      } catch (reason) {
        setError(pcError(reason));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [command],
  );

  useEffect(() => {
    if (!connected) return;
    // The first read starts after this render, not inside it.
    const timer = setTimeout(
      // A remembered folder that has gone opens the top instead.
      () => void open(startPath ?? "").then((ok) => {
        if (!ok && startPath) void open("");
      }),
      0,
    );
    return () => clearTimeout(timer);
    // Only the first open; later moves come from taps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const save = (entry: PcFileEntry) => {
    setSending(entry.path);
    offerToPhone(command, entry.path)
      .then((answer) => {
        void Haptics.selectionAsync();
        if (typeof answer?.fileId === "string")
          setSent((current) => ({ ...current, [entry.path]: answer.fileId as string }));
      })
      .catch((reason: unknown) => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Couldn't save it", pcError(reason));
      })
      .finally(() => setSending(null));
  };

  const tapFile = (entry: PcFileEntry) => {
    const item = sentEntry(entry.path);
    if (item?.status === "done" && item.uri) {
      if (!openNativeFile(item.uri, item.mimeType ?? "application/octet-stream"))
        Alert.alert("Couldn’t open the file", "It may have been moved or deleted. Look in Download/Hari.");
      return;
    }
    // Waiting (an older computer leaves big files for Download) or stopped: fetch it.
    if (item?.status === "offered" || item?.status === "failed") return fetchShareFile(item.id, command);
    if (item) return;
    if ((entry.size ?? 0) <= AUTO_DOWNLOAD_BYTES) return save(entry);
    Alert.alert(`Save ${entry.name} (${formatBytes(entry.size ?? 0)}) to this phone?`, "It goes to Downloads/Hari.", [
      { text: "Cancel", style: "cancel" },
      { text: "Save", onPress: () => save(entry) },
    ]);
  };

  const parent = folder?.path ? (folder.parent && folder.parent !== folder.path ? folder.parent : "") : null;

  // Fork (Hari, L-348): a swipe right goes up a folder too, and back to the
  // hub from the top.
  usePlaceSwipes(() => (parent === null ? router.back() : void open(parent)));

  // Fork (Hari, L-345): the phone's back goes up a folder, as the arrow does,
  // and leaves the browser only from the top.
  useFocusEffect(
    useCallback(() => {
      if (parent === null) return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        void open(parent);
        return true;
      });
      return () => subscription.remove();
    }, [parent, open]),
  );

  return (
    <SettingsPage onRefresh={() => void open(path)} refreshing={loading && folder !== null}>
      <View style={styles.pathRow}>
        {parent !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Up one folder"
            onPress={() => void open(parent)}
            hitSlop={8}
            style={({ pressed }) => [styles.up, pressed && styles.pressed]}
          >
            <Icon name="arrowLeft" size={18} color={colors.accent} />
          </Pressable>
        ) : null}
        <Text style={styles.path} numberOfLines={2}>
          {folder?.path || "This computer"}
        </Text>
        {loading ? <ActivityIndicator size="small" color={colors.muted} /> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!connected ? <Text style={styles.empty}>Connect to your computer to see its files.</Text> : null}
      {folder ? (
        <View style={styles.card}>
          {folder.entries.length === 0 ? <Text style={styles.empty}>This folder is empty.</Text> : null}
          {folder.entries.map((entry, index) => (
            <View key={entry.path}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={entry.dir ? `Open ${entry.name}` : fileLabel(entry.name, sentEntry(entry.path))}
                disabled={sending !== null}
                onPress={() => (entry.dir ? void open(entry.path) : tapFile(entry))}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Icon name={entry.drive ? "drive" : entry.dir ? "folder" : "file"} size={20} color={entry.dir ? colors.accent : colors.muted} />
                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {entry.drive && entry.free !== undefined && entry.total !== undefined ? (
                    <Text style={styles.meta}>{`${formatBytes(entry.free)} free of ${formatBytes(entry.total)}`}</Text>
                  ) : !entry.dir && entry.size !== undefined ? (
                    <Text style={styles.meta}>
                      {[formatBytes(entry.size), entry.modified ? new Date(entry.modified).toLocaleDateString() : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ) : null}
                </View>
                {sending === entry.path ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : entry.dir ? (
                  <Icon name="chevronRight" size={16} color={colors.muted} />
                ) : (
                  <FileState item={sentEntry(entry.path)} />
                )}
              </Pressable>
            </View>
          ))}
          {folder.more ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void open(folder.path, folder.entries.length)}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <Text style={styles.link}>Show more</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SettingsPage>
  );
}

const useStyles = themedStyles((colors) => ({
  pathRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 8, marginBottom: 12 },
  up: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  path: { flex: 1, color: colors.muted, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: radii.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.content, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, fontVariant: ["tabular-nums"] },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 46, backgroundColor: colors.stroke },
  more: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  link: { color: colors.accent, fontSize: 15, fontWeight: "600" },
  failed: { color: colors.deletions, fontSize: 15, fontWeight: "600" },
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  empty: { color: colors.muted, fontSize: 14, padding: 14 },
  error: { color: colors.deletions, fontSize: 13, marginHorizontal: 16, marginBottom: 8 },
  pressed: { opacity: 0.6 },
}));

/** Asks the computer to send a file, for the phone to save at once (L-349). */
const offerToPhone = (command: ReturnType<typeof useConnection>["command"], path: string) =>
  command<{ fileId?: unknown }>("pc.files.offer", { path, sentAt: Date.now(), auto: true });

type SentItem = ReturnType<typeof useShareHistory>[number] | undefined;

const fileLabel = (name: string, item: SentItem) =>
  item?.status === "done"
    ? `Open ${name}, saved to Downloads/Hari`
    : item?.status === "failed"
      ? `${name} didn't save. Try again`
      : item?.status === "offered"
        ? `Download ${name}`
        : item
          ? `Saving ${name}`
          : `Save ${name} to this phone`;

/** Fork (Hari, L-349): a file's way to the phone, on its row. */
function FileState({ item }: { item: SentItem }) {
  const styles = useStyles();
  const colors = useColors();
  if (!item) return <Icon name="download" size={18} color={colors.muted} />;
  if (item.status === "done") return <Text style={styles.link}>Open</Text>;
  if (item.status === "failed") return <Text style={styles.failed}>Try again</Text>;
  if (item.status === "offered") return <Text style={styles.link}>Download</Text>;
  return (
    <View style={styles.progress}>
      <ActivityIndicator size="small" color={colors.muted} />
      {item.status === "moving" && item.progress !== undefined ? (
        <Text style={styles.meta}>{`${Math.round(item.progress * 100)}%`}</Text>
      ) : null}
    </View>
  );
}
