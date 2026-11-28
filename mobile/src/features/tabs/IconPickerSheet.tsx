import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Icon } from "@/ui/Icon";
import { themedStyles, useColors, useScheme } from "@/ui/theme";
import { firstGrapheme, PLACE_ICON_NAMES, type PlaceIcon } from "./placeIcons";
import { TabSheet } from "./TabSheet";

const TILE = 52;

/**
 * Fork (Hari, L-412): picks a circle's icon on the arc: one of the app's
 * icons, an emoji, or none (the desktop's mascot). Kept on this phone only.
 */
export function IconPickerSheet({
  open,
  name,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  /** The project or Mono, for the title. */
  name: string;
  current: PlaceIcon | undefined;
  /** Undefined clears the icon. */
  onPick: (icon: PlaceIcon | undefined) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const [emoji, setEmoji] = useState("");
  const choose = (icon: PlaceIcon | undefined) => {
    onPick(icon);
    onClose();
  };
  const typed = firstGrapheme(emoji);
  return (
    <TabSheet open={open} title={`Icon for ${name}`} onClose={onClose} onClosed={() => setEmoji("")}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.grid}>
          {PLACE_ICON_NAMES.map((iconName) => {
            const selected = current?.kind === "icon" && current.name === iconName;
            return (
              <Pressable
                key={iconName}
                accessibilityRole="button"
                accessibilityLabel={iconName}
                accessibilityState={{ selected }}
                onPress={() => choose({ kind: "icon", name: iconName })}
                style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}
              >
                <Icon name={iconName} size={24} color={selected ? colors.accent : colors.content} />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.emojiRow}>
          <TextInput
            value={emoji}
            onChangeText={setEmoji}
            placeholder="Or type an emoji"
            placeholderTextColor={colors.muted}
            keyboardAppearance={scheme}
            returnKeyType="done"
            onSubmitEditing={() => typed && choose({ kind: "emoji", text: typed })}
            style={styles.emojiInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use emoji"
            disabled={!typed}
            onPress={() => choose({ kind: "emoji", text: typed })}
            style={({ pressed }) => [styles.button, !typed && styles.disabled, pressed && styles.pressed]}
          >
            <Text style={styles.buttonLabel}>Use</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose(undefined)}
          style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
        >
          <Text style={styles.resetLabel}>Use mascot</Text>
        </Pressable>
      </ScrollView>
    </TabSheet>
  );
}

const useStyles = themedStyles((colors) => ({
  content: { paddingHorizontal: 20, gap: 16, paddingBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  tileSelected: { borderWidth: 2, borderColor: colors.accent },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.85 },
  emojiRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  emojiInput: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    backgroundColor: colors.surfaceRaised,
    color: colors.content,
    fontSize: 17,
  },
  button: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  buttonLabel: { color: colors.inverse, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  reset: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 },
  resetLabel: { color: colors.accent, fontSize: 16, fontWeight: "600" },
}));
