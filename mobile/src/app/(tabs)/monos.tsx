import { router } from "expo-router";
import { useEffect, useEffectEvent, useMemo } from "react";
import { FlatList, Text, View } from "react-native";

import { useMonoTools } from "@/features/connection/ConnectionProvider";
import { MonoFace } from "@/features/tabs/ArcFaces";
import { PLUS_SIZE, PlusButton } from "@/features/tabs/PlusButton";
import { TabScreen } from "@/features/tabs/TabScreen";
import { onMonoCreated } from "@/features/workspace/newMono";
import { relativeTime } from "@/features/workspace/relativeTime";
import type { Mono } from "@/features/workspace/types";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { LiquidView } from "@/ui/LiquidView";
import { themedStyles } from "@/ui/theme";

const STATUS_LABEL: Partial<Record<Mono["status"], string>> = {
  working: "Working",
  "needs-you": "Needs you",
};

/**
 * Fork (Hari, L-412): the Monos tab: every Mono, latest first; a tap opens
 * its chat. The + makes a new Mono, when the desktop allows it.
 */
export default function MonosTab() {
  const styles = useStyles();
  const { monos } = useWorkspace();
  const canCreate = useMonoTools();

  const open = (monoId: string) => router.push({ pathname: "/mono/[monoId]", params: { monoId } });
  // The new-Mono page hands back the Mono it made.
  const openCreated = useEffectEvent((monoId: string) => open(monoId));
  useEffect(() => onMonoCreated(openCreated), []);

  const sorted = useMemo(
    () => [...monos].sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
    [monos],
  );

  return (
    <TabScreen tab="monos">
      <FlatList
        style={styles.listFrame}
        data={sorted}
        keyExtractor={(mono) => mono.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>No Monos on this phone yet.</Text>}
        renderItem={({ item }) => <MonoRow mono={item} onPress={() => open(item.id)} />}
      />
      {canCreate ? (
        <View style={styles.plus}>
          <PlusButton label="New Mono" onPress={() => router.push("/mono-new")} />
        </View>
      ) : null}
    </TabScreen>
  );
}

function MonoRow({ mono, onPress }: { mono: Mono; onPress: () => void }) {
  const styles = useStyles();
  const status = STATUS_LABEL[mono.status];
  return (
    <LiquidView
      onPress={onPress}
      accessibilityLabel={status ? `${mono.name}, ${status}` : mono.name}
      borderRadius={22}
      pressedScale={0.98}
      innerStyle={styles.row}
    >
      <View style={styles.face}>
        <MonoFace mono={mono} icon={undefined} size={30} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {mono.name}
        </Text>
        {status ? (
          <Text style={styles.status} numberOfLines={1}>
            {status}
          </Text>
        ) : mono.lastMessage ? (
          <Text style={styles.line} numberOfLines={1}>
            {mono.lastMessage}
          </Text>
        ) : null}
      </View>
      {mono.lastActiveAt ? <Text style={styles.time}>{relativeTime(mono.lastActiveAt)}</Text> : null}
    </LiquidView>
  );
}

const useStyles = themedStyles((colors) => ({
  listFrame: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: PLUS_SIZE + 32, gap: 10 },
  plus: { position: "absolute", right: 16, bottom: 16 },
  row: { alignSelf: "stretch", justifyContent: "flex-start", gap: 14, paddingHorizontal: 14, minHeight: 68 },
  face: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  name: { color: colors.content, fontSize: 16, fontWeight: "600" },
  status: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  line: { color: colors.muted, fontSize: 13 },
  time: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: "center", paddingTop: 80 },
}));
