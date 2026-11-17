import { Fragment, useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";

import { phoneNotices } from "@/features/liveUpdates/nativeLive";
import { parseActiveNotices, skipRows, type PhoneNotice } from "@/features/phoneNotifications/noticeModel";
import { usePhoneNoticePreferences } from "@/features/phoneNotifications/preferences";
import { SettingsPage, SettingsRow } from "@/features/settings/SettingsUI";
import { AccentSwitch } from "@/ui/AccentSwitch";
import { radii, themedStyles, useColors } from "@/ui/theme";

/**
 * Fork (Hari, L-325): the phone's notifications on the computer. The switch
 * (and Android's Notification access), and which apps send: apps showing
 * notifications now plus the skipped apps that are installed. The rows hold
 * still while the page is open, so a switch never makes its row vanish.
 */
export default function PhoneNotificationsScreen() {
  const colors = useColors();
  const styles = useStyles();
  const [{ enabled, skipped }, setPreferences] = usePhoneNoticePreferences();
  const [allowed, setAllowed] = useState(() => phoneNotices?.allowed() ?? false);
  const [{ items: active, stalled }, setRead] = useState(() =>
    phoneNotices ? parseActiveNotices(phoneNotices.active()) : { listening: false, stalled: false, items: [] as PhoneNotice[] },
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !phoneNotices) return;
      setAllowed(phoneNotices.allowed());
      setRead(parseActiveNotices(phoneNotices.active()));
    });
    return () => subscription.remove();
  }, []);

  // The apps listed: fixed per visit (and per change of what's showing).
  const [skippedAtOpen] = useState(skipped);
  const rows = useMemo(() => {
    const names = phoneNotices?.labels(skippedAtOpen) ?? {};
    return skipRows(active, skippedAtOpen, names);
  }, [active, skippedAtOpen]);

  const turn = (on: boolean) => {
    setPreferences({ enabled: on });
    if (on && !allowed) phoneNotices?.openSettings();
  };
  const setSends = (pkg: string, sends: boolean) => {
    const rest = skipped.filter((name) => name !== pkg);
    setPreferences({ skipped: sends ? rest : [...rest, pkg] });
  };

  return (
    <SettingsPage>
      <View style={styles.card}>
        <SettingsRow
          icon="notifications"
          label="Send to computer"
          onPress={() => turn(!enabled)}
          accessory={
            <AccentSwitch accessibilityLabel="Send notifications to computer" value={enabled} onValueChange={turn} />
          }
        />
      </View>
      {enabled && !allowed ? (
        <Text style={styles.note} onPress={() => void phoneNotices?.openSettings()}>
          Turn on Notification access for Hari to read your notifications.{" "}
          <Text style={{ color: colors.accent }}>Open settings</Text>
        </Text>
      ) : enabled && stalled ? (
        // L-334: access is on but Android hasn't started the reader (often after an update).
        <Text style={styles.note} onPress={() => void phoneNotices?.openSettings()}>
          Android hasn&apos;t started Hari&apos;s notification reader. Hari is restarting it; if notifications
          still don&apos;t reach the computer, turn Notification access off and on.{" "}
          <Text style={{ color: colors.accent }}>Open settings</Text>
        </Text>
      ) : (
        <Text style={styles.note}>
          Your notifications show in the computer&apos;s Share panel while it&apos;s connected. Dismissing one
          there clears it here too. The computer keeps them in memory for 24 hours.
        </Text>
      )}

      <Text style={styles.heading}>Apps</Text>
      {rows.length === 0 ? (
        <Text style={styles.note}>
          Apps appear here once they show a notification. Banking, payment, authenticator and
          password apps start switched off.
        </Text>
      ) : (
        <>
          <View style={styles.card}>
            {rows.map((row, index) => {
              const sends = !skipped.includes(row.package);
              return (
                <Fragment key={row.package}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <SettingsRow
                    label={row.app}
                    onPress={() => setSends(row.package, !sends)}
                    accessory={
                      <AccentSwitch
                        accessibilityLabel={`Send ${row.app} notifications`}
                        value={sends}
                        onValueChange={(on) => setSends(row.package, on)}
                      />
                    }
                  />
                </Fragment>
              );
            })}
          </View>
          <Text style={styles.note}>
            Switched-off apps never leave the phone. Banking, payment, authenticator and password
            apps start switched off.
          </Text>
        </>
      )}
    </SettingsPage>
  );
}

const useStyles = themedStyles((colors) => ({
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 10,
    backgroundColor: colors.stroke,
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 16,
  },
}));
