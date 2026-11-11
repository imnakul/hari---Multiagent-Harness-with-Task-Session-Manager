import * as Notifications from "expo-notifications";
import { router, useLocalSearchParams, useNavigationContainerRef } from "expo-router";
import { Fragment, useState } from "react";
import { Alert, Linking, StyleSheet, Switch, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { MONOS_ENABLED } from "@/features/connection/selection";
import { useNotificationsBlocked } from "@/features/notifications/SessionNotifications";
import { useAppearancePreference } from "@/features/settings/appearance";
import { accessMode } from "@/features/models/access";
import {
  useDefaultModel,
  useDefaultRuntimeMode,
} from "@/features/settings/defaultModel";
import {
  NOTIFICATION_CATEGORIES,
  useNotificationPreferences,
  type NotificationCategory,
} from "@/features/settings/notifications";
import { useOpenSessionAfterStarting } from "@/features/settings/newSessions";
import { useLivePreferences } from "@/features/settings/liveUpdates";
import {
  liveAvailable,
  livePromotable,
  openBatterySettings,
  openPromotedSettings,
  usePromotedAllowed,
} from "@/features/liveUpdates/nativeLive";
import { useChangeLayout, useMonoOnlyLayout } from "@/features/settings/monoOnly";
import { SettingsPage, SettingsRow } from "@/features/settings/SettingsUI";
import { HariUpdateRows } from "@/features/updates/HariUpdateCard";
import { updatesSupported } from "@/features/updates/useHariUpdate";
import { projectForRoute } from "@/features/workspace/routing";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon, type IconName } from "@/ui/Icon";
import { lookLabel, radii, themedStyles, useColors, useLook } from "@/ui/theme";

const CATEGORY_ICONS: Record<NotificationCategory, IconName> = {
  agentInput: "lock",
  agentFinished: "check",
  monoMessages: "chat",
};

export default function SettingsScreen() {
  const colors = useColors();
  const styles = useStyles();
  // The project open under settings, whose chat background it sets.
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const project = projectForRoute(useWorkspace().projects, projectId);
  const [appearance] = useAppearancePreference();
  const theme = lookLabel(useLook());
  const defaultModel = useDefaultModel();
  const defaultAccess = useDefaultRuntimeMode();
  const notifications = useNotificationPreferences();
  const [openAfterStarting, setOpenAfterStarting] = useOpenSessionAfterStarting();
  const blocked = useNotificationsBlocked();
  const [monoOnly] = useMonoOnlyLayout();
  const navigation = useNavigationContainerRef();
  const switchLayout = useChangeLayout();
  // The layouts go about the app differently, so settings closes, and the
  // app starts again from the top in the new one under the loading cover:
  // the list of Monos, or back where the user last was.
  // The switch shows the pick at once, as the sheet slides away with it.
  const [picked, setPicked] = useState<boolean | null>(null);
  const changeLayout = (next: boolean) => {
    setPicked(next);
    switchLayout(next, {
      close: () => router.back(),
      reset: () => navigation.reset({ index: 0, routes: [{ name: "index" }] }),
    });
  };
  // Both pages act on the project open under settings.
  const params = project ? { projectId: project.id } : {};
  const connection = useConnection();
  const selected = connection.selection;
  const disconnect = () =>
    Alert.alert(
      "Disconnect desktop?",
      "You can pair again by scanning a new code. Your workspace choices will be remembered.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void connection
              .disconnect()
              .then(() => router.replace("/"))
              .catch((reason) =>
                Alert.alert("Could not disconnect", String(reason)),
              );
          },
        },
      ],
    );
  return (
    <SettingsPage>
      <View style={styles.desktop}>
        <Icon
          name={connection.connected ? "computer" : "computerOff"}
          size={22}
          color={connection.connected ? colors.content : colors.muted}
        />
        <View style={styles.desktopText}>
          <Text style={styles.desktopName} numberOfLines={1}>
            {connection.pairing?.desktop.name}
          </Text>
          <Text style={styles.desktopStatus}>
            {connection.connected
              ? "Connected to desktop"
              : "Desktop unavailable. Your saved workspace stays here."}
          </Text>
        </View>
      </View>

      <Text style={styles.heading}>Notifications</Text>
      <View style={styles.card}>
        {NOTIFICATION_CATEGORIES.map((category, index) => (
          <Fragment key={category.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <SettingsRow
              icon={CATEGORY_ICONS[category.id]}
              label={category.label}
              onPress={() =>
                notifications.setEnabled(
                  category.id,
                  !notifications.enabled(category.id),
                )
              }
              accessory={
                <Switch
                  value={notifications.enabled(category.id)}
                  onValueChange={(on) =>
                    notifications.setEnabled(category.id, on)
                  }
                  trackColor={{ true: colors.accent }}
                />
              }
            />
          </Fragment>
        ))}
      </View>
      {blocked ? (
        <Text style={styles.note} onPress={() => void Linking.openSettings()}>
          Notifications are off for this app in system settings.{" "}
          <Text style={{ color: colors.accent }}>Open Settings</Text>
        </Text>
      ) : null}

      {liveAvailable ? <LiveUpdateSettings /> : null}

      <Text style={styles.heading}>Preferences</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="appearance"
          label="Appearance"
          value={appearance === "system" ? theme : `${theme}, ${appearance}`}
          onPress={() =>
            router.push({ pathname: "/settings/appearance", params })
          }
        />
        <View style={styles.divider} />
        <SettingsRow
          icon="robot"
          label="Providers"
          value={defaultModel?.name ?? "Desktop default"}
          onPress={() =>
            router.push({ pathname: "/settings/providers", params })
          }
        />
        <View style={styles.divider} />
        <SettingsRow
          icon="lock"
          label="Permissions"
          value={
            defaultAccess ? accessMode(defaultAccess).label : "Desktop default"
          }
          onPress={() =>
            router.push({ pathname: "/settings/permissions", params })
          }
        />
      </View>

      <Text style={styles.heading}>New sessions</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="chat"
          label="Open after starting"
          onPress={() => setOpenAfterStarting(!openAfterStarting)}
          accessory={
            <Switch
              accessibilityLabel="Open sessions after starting"
              value={openAfterStarting}
              onValueChange={setOpenAfterStarting}
              trackColor={{ true: colors.accent }}
            />
          }
        />
      </View>
      <Text style={styles.note}>
        Turn off to stay on the new session screen and start more sessions.
      </Text>

      {MONOS_ENABLED ? (
        <>
          <Text style={styles.heading}>Layout</Text>
          <View style={styles.card}>
            <SettingsRow
              icon="chat"
              label="Monos only"
              onPress={() => changeLayout(!(picked ?? monoOnly))}
              accessory={
                <Switch
                  accessibilityLabel="Monos only"
                  value={picked ?? monoOnly}
                  onValueChange={changeLayout}
                  trackColor={{ true: colors.accent }}
                />
              }
            />
          </View>
          <Text style={styles.note}>
            A list of your Monos and their chats, with no sidebar or projects.
          </Text>
        </>
      ) : null}

      <Text style={styles.heading}>Workspace</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="folder"
          label={MONOS_ENABLED ? "Projects and monos" : "Projects"}
          value={String(
            (selected?.projectIds.length ?? 0) +
              (MONOS_ENABLED ? (selected?.monoIds.length ?? 0) : 0),
          )}
          onPress={() => router.push("/settings/workspace")}
        />
        <View style={styles.divider} />
        <SettingsRow
          icon="computer"
          label="Reconnect"
          showChevron={false}
          onPress={() => void connection.refresh()}
        />
      </View>

      {updatesSupported ? (
        <>
          <Text style={styles.heading}>Updates</Text>
          <View style={styles.card}>
            <HariUpdateRows divider={<View style={styles.divider} />} />
          </View>
        </>
      ) : null}

      <View style={[styles.card, styles.lastCard]}>
        <SettingsRow
          icon="computerOff"
          label="Disconnect desktop"
          showChevron={false}
          destructive
          onPress={disconnect}
        />
      </View>

      {connection.error ? (
        <Text style={styles.error}>{connection.error}</Text>
      ) : null}
    </SettingsPage>
  );
}

/**
 * Fork (Hari, L-239): running sessions in the status bar, the Super Island
 * and on the lock screen. Off until turned on.
 */
function LiveUpdateSettings() {
  const colors = useColors();
  const styles = useStyles();
  const [{ enabled, mode }, setLive] = useLivePreferences();
  const allowed = usePromotedAllowed();
  const each = mode === "each";
  // The cards are notifications: ask for them as the switch turns on.
  const turn = (on: boolean) => {
    setLive({ enabled: on });
    if (on) void Notifications.requestPermissionsAsync().catch(() => {});
  };
  return (
    <>
      <Text style={styles.heading}>Live Updates</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="automation"
          label="Show running sessions"
          onPress={() => turn(!enabled)}
          accessory={
            <Switch
              accessibilityLabel="Show running sessions as a Live Update"
              value={enabled}
              onValueChange={turn}
              trackColor={{ true: colors.accent }}
            />
          }
        />
        {enabled ? (
          <>
            <View style={styles.divider} />
            <SettingsRow
              icon="layers"
              label="One card per session"
              onPress={() => setLive({ mode: each ? "combined" : "each" })}
              accessory={
                <Switch
                  accessibilityLabel="One card per session"
                  value={each}
                  onValueChange={(on) => setLive({ mode: on ? "each" : "combined" })}
                  trackColor={{ true: colors.accent }}
                />
              }
            />
          </>
        ) : null}
      </View>
      <Text style={styles.note}>
        {livePromotable
          ? "Your sessions in the status bar, the island and on the lock screen while they run. Stop, Approve and Deny ask you to unlock first."
          : "Your sessions as a pinned notification while they run. Stop, Approve and Deny ask you to unlock first."}
        {enabled && !each ? " Several sessions share one card; turn on One card per session for a Stop button on each." : ""}
      </Text>
      {enabled && livePromotable && !allowed ? (
        <Text style={styles.note} onPress={() => void openPromotedSettings()}>
          Live Updates are off for Hari in Android settings.{" "}
          <Text style={{ color: colors.accent }}>Turn on</Text>
        </Text>
      ) : null}
      {enabled ? (
        <Text style={styles.note} onPress={() => void openBatterySettings()}>
          To keep them current with the phone locked, set Battery to No
          restrictions and turn on Autostart.{" "}
          <Text style={{ color: colors.accent }}>Open app settings</Text>
        </Text>
      ) : null}
    </>
  );
}

const useStyles = themedStyles((colors) => ({
  desktop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
    backgroundColor: colors.surface,
  },
  desktopText: {
    flex: 1,
    gap: 2,
  },
  desktopName: {
    color: colors.content,
    fontSize: 17,
    fontWeight: "600",
  },
  desktopStatus: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  // Grouped as iOS settings are: a muted heading over a rounded card.
  heading: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  // Inset to the rows' labels, past their icons.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 40,
    backgroundColor: colors.stroke,
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 16,
  },
  lastCard: {
    marginTop: 24,
  },
  error: {
    color: colors.deletions,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 16,
  },
}));
