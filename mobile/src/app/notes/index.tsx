import { router, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { HeaderButton } from "@/features/files/codeScreen";
import { SettingsPage } from "@/features/settings/SettingsUI";
import {
  excerptOf,
  listNotes,
  newId,
  onToolsChanged,
  projectLabel,
  type Command,
  type NoteItem,
} from "@/features/tools/tools";
import { chatTime } from "@/features/workspace/relativeTime";
import { radii, themedStyles, useColors } from "@/ui/theme";

// Fork (Hari, L-236): the desktop's Notes on the phone, newest first, narrowed
// by the search in the header. A note opens to read and edit; + starts one.
export default function NotesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { command, catalog } = useConnection();
  const run = command as Command;
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setNotes(await listNotes(run));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [run]);
  useEffect(() => {
    let live = true;
    const fetch = () =>
      listNotes(run).then(
        (items) => {
          if (!live) return;
          setNotes(items);
          setError(null);
        },
        (reason) => live && setError(reason instanceof Error ? reason.message : String(reason)),
      );
    void fetch();
    const stop = onToolsChanged((changed) => changed === "notes" && void fetch());
    return () => {
      live = false;
      stop();
    };
  }, [run]);

  const needle = query.trim().toLowerCase();
  const shown = (notes ?? []).filter(
    (note) =>
      !needle ||
      note.title.toLowerCase().includes(needle) ||
      note.excerpt.toLowerCase().includes(needle) ||
      note.tags.some((tag) => tag.includes(needle.replace(/^#/, ""))),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Search notes",
            hideWhenScrolling: false,
            onChangeText: (event) => setQuery(event.nativeEvent.text),
          },
          headerRight: () => (
            <HeaderButton
              icon="compose"
              label="New note"
              onPress={() =>
                router.push({ pathname: "/notes/[noteId]", params: { noteId: newId(), fresh: "1" } })
              }
            />
          ),
        }}
      />
      <SettingsPage
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
      >
        {notes === null && !error ? (
          <ActivityIndicator style={styles.loading} color={colors.muted} />
        ) : null}
        {error ? <Text style={styles.empty}>{error}</Text> : null}
        {notes !== null && !shown.length ? (
          <Text style={styles.empty}>{needle ? "No notes match." : "No notes yet."}</Text>
        ) : null}
        {shown.length ? (
          <View style={styles.card}>
            {shown.map((note, index) => {
              const project = projectLabel(note.sourceCwd, catalog.projects);
              const excerpt = excerptOf(note);
              return (
                <View key={note.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({ pathname: "/notes/[noteId]", params: { noteId: note.id } })
                    }
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text style={styles.title} numberOfLines={1}>
                      {note.title || "Untitled"}
                    </Text>
                    {excerpt ? (
                      <Text style={styles.excerpt} numberOfLines={2}>
                        {excerpt}
                      </Text>
                    ) : null}
                    <Text style={styles.meta} numberOfLines={1}>
                      {[chatTime(note.updatedAt), project, ...note.tags.map((tag) => `#${tag}`)]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
      </SettingsPage>
    </>
  );
}

const useStyles = themedStyles((colors) => ({
  loading: { marginTop: 32 },
  empty: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: 32 },
  card: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: colors.stroke },
  row: { paddingHorizontal: 10, paddingVertical: 11, gap: 3, borderRadius: radii.row },
  pressed: { backgroundColor: colors.selection },
  title: { color: colors.content, fontSize: 16, fontWeight: "600" },
  excerpt: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  meta: { color: colors.faint, fontSize: 12, marginTop: 2 },
}));
