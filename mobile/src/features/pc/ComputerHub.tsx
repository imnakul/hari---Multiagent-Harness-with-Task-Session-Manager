import { router, type NativeStackNavigationOptions } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";

import { HeaderButton } from "@/features/files/codeScreen";
import { ComputerControl } from "@/features/pc/ComputerControl";
import { SharePanel } from "@/features/share/SharePanel";
import { Icon } from "@/ui/Icon";
import { SegmentedSwitch } from "@/ui/SegmentedSwitch";

export type ComputerTab = "share" | "control";

const SEGMENTS = [
  {
    value: "share" as const,
    label: "Share",
    icon: <Icon name="share" size={18} />,
  },
  {
    value: "control" as const,
    label: "Control",
    icon: <Icon name="computer" size={18} />,
  },
];

// Fork (Hari, L-290): the open tab lives here, not in the screen, so the
// header's toggle is set once in the layout and never changed after the
// screen opens. Changing a transparent Android header after it opened left it
// blank, with the screen behind's buttons showing through. Unset, the hub
// shows the tab it was opened on.
let current: ComputerTab | undefined;
const listeners = new Set<() => void>();
const setTab = (tab: ComputerTab | undefined) => {
  if (tab === current) return;
  current = tab;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const useTab = (initial: ComputerTab) =>
  useSyncExternalStore(subscribe, () => current ?? initial);

function ComputerSwitch({ initial }: { initial: ComputerTab }) {
  const tab = useTab(initial);
  return (
    <SegmentedSwitch<ComputerTab>
      value={tab}
      onChange={setTab}
      segments={SEGMENTS}
    />
  );
}

/** Which tab the hub opens on: Control, unless the link asks for Share. */
export const hubTabOf = (params: object | undefined): ComputerTab =>
  (params as { tab?: unknown } | undefined)?.tab === "share"
    ? "share"
    : "control";

/** The hub's header, for the Computer and Share layouts: Close, and the toggle. */
export const computerHubOptions = (
  initial: ComputerTab,
): NativeStackNavigationOptions => ({
  title: "Computer",
  headerTitleAlign: "center",
  headerTitle: () => <ComputerSwitch initial={initial} />,
  headerLeft: () => (
    <HeaderButton icon="close" label="Close" onPress={() => router.back()} />
  ),
});

/**
 * Fork (Hari, L-288): everything to do with the paired computer in one
 * place: Share (the chat-style timeline) and Control (stats, power, apps,
 * Wake), switched by the header toggle a project's New | Sessions uses.
 * Control asks the computer for nothing while Share shows.
 */
export function ComputerHub({ initial }: { initial: ComputerTab }) {
  const tab = useTab(initial);
  // Closing forgets the tab, so the next visit opens where its link says.
  useEffect(() => () => setTab(undefined), []);
  return tab === "share" ? (
    <SharePanel />
  ) : (
    <ComputerControl onOpenShare={() => setTab("share")} />
  );
}
