import { Stack } from "expo-router";
import { useState } from "react";

import { ComputerControl } from "@/features/pc/ComputerControl";
import { SharePanel } from "@/features/share/SharePanel";
import { Icon } from "@/ui/Icon";
import { SegmentedSwitch } from "@/ui/SegmentedSwitch";

export type ComputerTab = "share" | "control";

const SEGMENTS = [
  { value: "share" as const, label: "Share", icon: <Icon name="share" size={18} /> },
  { value: "control" as const, label: "Control", icon: <Icon name="computer" size={18} /> },
];

/**
 * Fork (Hari, L-288): everything to do with the paired computer in one
 * place: Share (the chat-style timeline) and Control (stats, power, apps,
 * Wake), switched by the header toggle a project's New | Sessions uses.
 * Control asks the computer for nothing while Share shows.
 */
export function ComputerHub({ initial }: { initial: ComputerTab }) {
  const [tab, setTab] = useState<ComputerTab>(initial);
  return (
    <>
      <Stack.Screen
        options={{
          headerTitleAlign: "center",
          headerTitle: () => (
            <SegmentedSwitch<ComputerTab> value={tab} onChange={setTab} segments={SEGMENTS} />
          ),
        }}
      />
      {tab === "share" ? <SharePanel /> : <ComputerControl onOpenShare={() => setTab("share")} />}
    </>
  );
}
