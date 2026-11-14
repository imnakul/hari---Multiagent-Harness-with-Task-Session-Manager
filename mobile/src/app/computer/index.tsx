import { useLocalSearchParams } from "expo-router";

import { ComputerHub } from "@/features/pc/ComputerHub";

// Fork (Hari, L-280, L-288): the Computer hub, on its Control tab unless asked for Share.
export default function ComputerScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  return <ComputerHub initial={tab === "share" ? "share" : "control"} />;
}
