import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC, IS_WINDOWS } from "../../platform/tauri/platform";
import { installNativeContextMenuGuard } from "../../shared/lib/nativeContextMenu";
import {
  applyAccentColor,
  applyThemeDarkLightness,
  applyThemeLightLightness,
  applyThemePreference,
  applyThemeTint,
  applyUiFont,
  applyUiFontSize,
  applyWindowGlassStrength,
  applyWorkspaceTheme,
  loadAccentColor,
  loadThemeDarkLightness,
  loadThemeLightLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  loadUiFont,
  loadUiFontSize,
  loadWindowGlassStrength,
  loadWorkspaceTheme,
} from "../settings/model/appearance";
import { QuickGitPopup } from "./ui/QuickGitPopup";
import { QuickComposer } from "./ui/QuickComposer";
import "../../styles/index.css";

/**
 * The theme, workspace theme and UI font, not the workspace's glass,
 * backgrounds, or scale: the panel draws its own card on a clear window with a
 * fixed native width. Re-applied on every show because these may have changed
 * in a workspace window since.
 */
function applyAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  // macOS vibrancy and Windows Acrylic blur the desktop behind the panel, so
  // the card can use the same light glass tint as the workspace window.
  document.documentElement.classList.toggle(
    "composer-native-glass",
    IS_MAC || IS_WINDOWS,
  );
  applyWindowGlassStrength(loadWindowGlassStrength());
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemeLightLightness(loadThemeLightLightness());
  applyWorkspaceTheme(loadWorkspaceTheme());
  applyUiFont(loadUiFont());
  applyUiFontSize(loadUiFontSize());
  const scheme = applyThemePreference(loadThemePreference());
  // The native blur follows the window's appearance, not the page's, so
  // match it to the app theme rather than the system one.
  void getCurrentWindow()
    .setTheme(scheme)
    .catch(() => undefined);
}

applyAppearance();
installNativeContextMenuGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("popup") === "git" ? (
      <QuickGitPopup onShown={applyAppearance} />
    ) : (
      <QuickComposer onShown={applyAppearance} />
    )}
  </React.StrictMode>,
);
