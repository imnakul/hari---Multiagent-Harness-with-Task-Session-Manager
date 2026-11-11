import { requireOptionalNativeModule } from "expo";
import { useEffect } from "react";
import { Platform } from "react-native";

import type { Scheme } from "./theme";

// Fork (Hari, L-245): Android's navigation bar is clear (no contrast scrim;
// plugins/with-system-bars.js), so its buttons must follow the app's scheme,
// which Settings can set apart from the phone's.
type HariSystemBarsModule = { setNavigationButtonsDark(dark: boolean): void };

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<HariSystemBarsModule>("HariSystemBars")
    : null;

/** Keeps the navigation bar's buttons readable over the app in this scheme. */
export function useNavigationButtons(scheme: Scheme): void {
  useEffect(() => {
    native?.setNavigationButtonsDark(scheme === "light");
  }, [scheme]);
}
