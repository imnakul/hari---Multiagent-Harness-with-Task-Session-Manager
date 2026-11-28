import { useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";

import { relativeTime } from "@/features/workspace/relativeTime";
import type { Project } from "@/features/workspace/types";
import { Icon } from "@/ui/Icon";
import { themedStyles, useColors, useScheme } from "@/ui/theme";
import { ProjectFace } from "./ArcFaces";
import type { PlaceIcons } from "./placeIcons";
import { TabSheet } from "./TabSheet";

/**
 * Fork (Hari, L-412): the Sessions tab's + : every project, the selected one
 * first and then by latest activity, narrowed by a search. Picking one closes
 * the sheet and, once it has gone, hands the project to `onPick`.
 */
export function NewSessionSheet({
  open,
  projects,
  selectedId,
  lastActive,
  icons,
  onPick,
  onClose,
}: {
  open: boolean;
  projects: readonly Project[];
  selectedId: string | undefined;
  /** Latest session activity per project id, in ms. */
  lastActive: ReadonlyMap<string, number>;
  icons: PlaceIcons;
  onPick: (projectId: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const [query, setQuery] = useState("");
  const picked = useRef<string | null>(null);
  const needle = query.trim().toLowerCase();
  const rows = [...projects]
    .filter((project) => !needle || project.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return (lastActive.get(b.id) ?? 0) - (lastActive.get(a.id) ?? 0);
    });
  return (
    <TabSheet
      open={open}
      title="New session"
      onClose={onClose}
      onClosed={() => {
        setQuery("");
        const projectId = picked.current;
        picked.current = null;
        if (projectId) onPick(projectId);
      }}
    >
      <View style={styles.search}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search projects"
          placeholderTextColor={colors.muted}
          keyboardAppearance={scheme}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.searchInput}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(project) => project.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No matching projects.</Text>}
        renderItem={({ item }) => {
          const active = lastActive.get(item.id);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`New session in ${item.name}`}
              onPress={() => {
                picked.current = item.id;
                onClose();
              }}
              android_ripple={{ color: colors.selection }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.face}>
                <ProjectFace project={item} icon={icons[item.id]} size={26} />
              </View>
              <Text numberOfLines={1} style={styles.name}>
                {item.name}
              </Text>
              {active ? <Text style={styles.time}>{relativeTime(active)}</Text> : null}
            </Pressable>
          );
        }}
      />
    </TabSheet>
  );
}

const useStyles = themedStyles((colors) => ({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceRaised,
  },
  searchInput: { flex: 1, height: 48, color: colors.content, fontSize: 17 },
  list: { paddingHorizontal: 16, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 8,
    borderRadius: 16,
  },
  pressed: { opacity: 0.7 },
  face: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  name: { flex: 1, color: colors.content, fontSize: 16, fontWeight: "600" },
  time: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: "center", paddingVertical: 32 },
}));
