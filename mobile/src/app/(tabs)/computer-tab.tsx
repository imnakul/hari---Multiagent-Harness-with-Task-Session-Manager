import { useIsFocused, useNavigation } from "expo-router";

import { ComputerControl } from "@/features/pc/ComputerControl";
import { TabScreen } from "@/features/tabs/TabScreen";

export default function ComputerTab() {
  const focused = useIsFocused();
  const navigation = useNavigation();
  return (
    <TabScreen tab="computer">
      <ComputerControl active={focused} onOpenShare={() => navigation.navigate("share-tab" as never)} />
    </TabScreen>
  );
}
