import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { parseFolder, type PcFileEntry, type PcFolder } from "@/features/pc/deviceModel";
import { formatBytes, pcError } from "@/features/pc/pcModel";
import { SettingsPage } from "@/features/settings/SettingsUI";
import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

/**
 * Fork (Hari, L-297): the computer's files, read-only. Drives first, then
 * folders before files; hidden and system items are left out. Tapping a
 * file sends it to Share on this phone (files over 10 MB wait there for a
 * Download tap, like any file from the computer).
 */
export default function ComputerFilesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { command, connected } = useConnection();
  const [folder, setFolder] = useState<PcFolder | null>(null);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const open = useCallback(
    async (next: string, offset = 0) => {
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
      } catch (reason) {
        setError(pcError(reason));
      } finally {
        setLoading(false);
      }
    },
    [command],
  );

  useEffect(() => {
    if (!connected) return;
    // The first read starts after this render, not inside it.
    const timer = setTimeout(() => void open(""), 0);
    return () => clearTimeout(timer);
    // Only the first open; later moves come from taps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const send = (entry: PcFileEntry) => {
    const size = entry.size === undefined ? "" : ` (${formatBytes(entry.size)})`;
    Alert.alert(`Send ${entry.name}${size} to this phone?`, "It arrives in Share.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: () => {
          setSending(entry.path);
          command<unknown>("pc.files.offer", { path: entry.path, sentAt: Date.now() })
            .then(() => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Sent to Share", `${entry.name} is in Share on this phone.`, [
                { text: "OK", style: "cancel" },
                { text: "Open Share", onPress: () => router.replace("/computer?tab=share") },
              ]);
            })
            .catch((reason: unknown) => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Couldn't send", pcError(reason));
            })
            .finally(() => setSending(null));
        },
      },
    ]);
  };

  const parent = folder?.path ? (folder.parent && folder.parent !== folder.path ? folder.parent : "") : null;

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
                accessibilityLabel={entry.dir ? `Open ${entry.name}` : `Send ${entry.name} to this phone`}
                disabled={sending !== null}
                onPress={() => (entry.dir ? void open(entry.path) : send(entry))}
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
                  <Icon name="download" size={18} color={colors.muted} />
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
  empty: { color: colors.muted, fontSize: 14, padding: 14 },
  error: { color: colors.deletions, fontSize: 13, marginHorizontal: 16, marginBottom: 8 },
  pressed: { opacity: 0.6 },
}));
