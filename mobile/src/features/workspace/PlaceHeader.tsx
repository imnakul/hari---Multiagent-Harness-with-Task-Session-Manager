import { router, useNavigation } from "expo-router";

import { HeaderButton } from "@/features/files/codeScreen";
import { useBackSwipe, useDrawerActions, useDrawerSwipe, useHasDrawer } from "@/ui/ScenePager";

/**
 * Fork (Hari, L-346): whether this place was opened over another screen
 * (from Settings, or in the Monos-only layout, which has no side menu)
 * rather than switched to from the side menu; then it closes back there.
 */
export function usePlaceOpenedOver() {
  const navigation = useNavigation();
  const hasDrawer = useHasDrawer();
  const root = navigation.getParent()?.getState();
  return !hasDrawer || (root?.index ?? 0) > 0;
}

/**
 * Fork (Hari, L-348): a swipe left opens the side menu and a swipe right goes
 * back a step: `back` inside a place (a note to the list, a folder up), or
 * closing a place opened over another screen. A place switched to from the
 * side menu has nothing to go back to.
 */
export function usePlaceSwipes(back?: () => void) {
  const over = usePlaceOpenedOver();
  useDrawerSwipe(!over);
  useBackSwipe(back ?? (() => router.back()), back !== undefined || over);
}

/** The side menu's button in a place's own header, on the right where the menu opens. */
export function SidebarButton() {
  const drawer = useDrawerActions();
  const hasDrawer = useHasDrawer();
  if (!hasDrawer) return null;
  return <HeaderButton icon="sidebar" label="Projects and monos" onPress={drawer.open} />;
}

/** Close, for a place opened over another screen; nothing otherwise. */
export function PlaceCloseButton() {
  if (!usePlaceOpenedOver()) return null;
  return <HeaderButton icon="close" label="Close" onPress={() => router.back()} />;
}
