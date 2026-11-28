import { router } from "expo-router";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/ui/Icon";
import { LiquidView } from "@/ui/LiquidView";
import { useDrawerActions } from "@/ui/ScenePager";
import { themedStyles, useColors } from "@/ui/theme";

type Destination = "/notes" | "/tasks" | "/notifications" | "/settings";

const ITEMS: { label: string; icon: IconName; path: Destination }[] = [
  { label: "Notes", icon: "note", path: "/notes" },
  { label: "Tasks", icon: "tasks", path: "/tasks" },
  { label: "Notifications", icon: "notifications", path: "/notifications" },
  { label: "Settings", icon: "settings", path: "/settings" },
];

/**
 * Fork (Hari, L-412): the side menu of the Tabs layout. Only what the tabs
 * don't hold: Notes, Tasks, Notifications and Settings, each pushed over the
 * tabs as a full screen.
 */
export function TabsSideMenu() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const drawer = useDrawerActions();

  const open = (path: Destination) => {
    // Settings rises as a modal over the open menu; on Android that opens
    // inside the slid-aside scene (L-235), so the menu shuts first, as the
    // drawer does. The rest close the menu, then push.
    if (path === "/settings" && Platform.OS !== "android") router.push(path);
    else drawer.closeThen(() => router.push(path));
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.title}>
          More
        </Text>
        <View style={styles.list}>
          <LiquidView borderRadius={24} row={false} innerStyle={styles.card}>
            {ITEMS.map((item) => (
              <Pressable
                key={item.path}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => open(item.path)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Icon name={item.icon} size={22} color={colors.content} />
                <Text style={styles.label}>{item.label}</Text>
              </Pressable>
            ))}
          </LiquidView>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.page },
  title: {
    color: colors.content,
    fontSize: 22,
    fontWeight: "600",
    // In line with the rows' icons (list inset + row padding).
    marginHorizontal: 32,
    marginBottom: 16,
  },
  list: { marginHorizontal: 16 },
  // LiquidView centres its children; the rows run the card's full width,
  // so their icons and labels line up on the left.
  card: { paddingVertical: 6, paddingHorizontal: 6, alignSelf: "stretch", alignItems: "stretch" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 10,
    borderRadius: 18,
  },
  rowPressed: { backgroundColor: colors.selection },
  label: { color: colors.content, fontSize: 16 },
}));
