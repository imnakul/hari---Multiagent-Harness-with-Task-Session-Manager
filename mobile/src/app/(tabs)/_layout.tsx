import { Tabs } from "expo-router";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { MONOS_ENABLED } from "@/features/connection/selection";
import { HariTabBar } from "@/features/tabs/HariTabBar";
import { readTabsMemory, tabRoute } from "@/features/tabs/tabsMemory";

/**
 * Fork (Hari, L-412): the Tabs layout's five tabs, Sessions in the middle;
 * each loads on first visit and freezes when left. The scenes are clear, so
 * the wallpaper the root stack draws behind them shows through. The
 * navigator's own animation stays off, or no tab ever freezes: TabScreen
 * slides each tab in itself (see tabTransition.ts).
 */
export default function TabsLayout() {
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  return (
    <Tabs
      initialRouteName={tabRoute(readTabsMemory(fingerprint).tab)}
      tabBar={(props) => <HariTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        freezeOnBlur: true,
        animation: "none",
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      <Tabs.Screen name="share-tab" />
      <Tabs.Screen name="computer-tab" />
      <Tabs.Screen name="sessions" />
      <Tabs.Screen name="monos" options={MONOS_ENABLED ? undefined : { href: null }} />
      <Tabs.Screen name="running" />
    </Tabs>
  );
}
