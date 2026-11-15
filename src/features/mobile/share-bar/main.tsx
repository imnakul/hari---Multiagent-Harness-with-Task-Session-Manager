import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installNativeContextMenuGuard } from "../../../shared/lib/nativeContextMenu";
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
  loadThemeHue,
  loadThemeLightLightness,
  loadThemePreference,
  loadThemeSaturation,
  loadUiFont,
  loadUiFontSize,
  loadWindowGlassStrength,
  loadWorkspaceTheme,
} from "../../settings/model/appearance";
import { ShareBar } from "./ShareBar";
import "../../../styles/index.css";

/**
 * Fork (L-320): the app's theme, accent and font, as the quick composer
 * applies them. Windows Acrylic blurs the desktop behind the window, so the
 * card uses the workspace's glass tint. Re-applied on every show, since a
 * workspace window may have changed them.
 */
function applyAppearance(): void {
  document.documentElement.classList.add("composer-native-glass");
  applyWindowGlassStrength(loadWindowGlassStrength());
  applyAccentColor(loadAccentColor());
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeDarkLightness(loadThemeDarkLightness());
  applyThemeLightLightness(loadThemeLightLightness());
  applyWorkspaceTheme(loadWorkspaceTheme());
  applyUiFont(loadUiFont());
  applyUiFontSize(loadUiFontSize());
  const scheme = applyThemePreference(loadThemePreference());
  void getCurrentWindow()
    .setTheme(scheme)
    .catch(() => undefined);
}

applyAppearance();
installNativeContextMenuGuard();

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ShareBar onShown={applyAppearance} />
    </React.StrictMode>,
  );
}
