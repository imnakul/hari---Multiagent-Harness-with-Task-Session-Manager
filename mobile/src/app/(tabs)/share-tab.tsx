import { useBottomTabBarHeight } from "expo-router/js-tabs";

import { SharePanel } from "@/features/share/SharePanel";
import { TabScreen } from "@/features/tabs/TabScreen";

export default function ShareTab() {
  const tabBarHeight = useBottomTabBarHeight();
  return (
    <TabScreen tab="share">
      <SharePanel tabBarHeight={tabBarHeight} />
    </TabScreen>
  );
}
