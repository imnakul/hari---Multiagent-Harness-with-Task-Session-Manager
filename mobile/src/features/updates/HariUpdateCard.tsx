// Fork (Hari, L-235): the Settings card for checking and installing updates.
import { ActivityIndicator } from "react-native";

import { SettingsRow } from "@/features/settings/SettingsUI";
import { Icon } from "@/ui/Icon";
import { useColors } from "@/ui/theme";

import {
  checkForHariUpdate,
  installed,
  installHariUpdate,
  openHariReleases,
  updatesSupported,
  useHariUpdate,
} from "./useHariUpdate";

/** The rows of the Updates card; nothing outside Android builds of Hari. */
export function HariUpdateRows({ divider }: { divider: React.ReactNode }) {
  const update = useHariUpdate();
  const colors = useColors();
  if (!updatesSupported || !installed) return null;
  const status =
    update.status === "checking"
      ? "Checking…"
      : update.status === "current"
        ? "Up to date"
        : update.status === "downloading"
          ? `Downloading ${Math.round(update.progress * 100)}%`
          : update.status === "error"
            ? "Couldn't check"
            : undefined;
  const release =
    update.status === "available" || update.status === "downloading" || update.status === "error"
      ? update.release
      : undefined;
  return (
    <>
      <SettingsRow
        icon="refresh"
        label="Check for updates"
        value={status ?? installed.version}
        showChevron={false}
        accessory={
          update.status === "checking" ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : update.status === "current" ? (
            <Icon name="check" size={16} color={colors.additions} />
          ) : undefined
        }
        onPress={() => void checkForHariUpdate()}
      />
      {release ? (
        <>
          {divider}
          <SettingsRow
            icon="sparkle"
            label={`Update to ${release.version}`}
            value={update.status === "error" ? "Try again" : undefined}
            showChevron={false}
            onPress={() => void installHariUpdate(release)}
          />
        </>
      ) : null}
      {update.status === "error" ? (
        <>
          {divider}
          <SettingsRow
            icon="info"
            label="Open the release page"
            value={update.message.slice(0, 40)}
            onPress={openHariReleases}
          />
        </>
      ) : null}
    </>
  );
}
