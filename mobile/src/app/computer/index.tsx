import { useLocalSearchParams } from "expo-router";

import { ComputerHub, hubTabOf } from "@/features/pc/ComputerHub";

// Fork (Hari, L-280, L-288): the Computer hub, on its Control tab unless asked for Share.
export default function ComputerScreen() {
  return <ComputerHub initial={hubTabOf(useLocalSearchParams())} />;
}
