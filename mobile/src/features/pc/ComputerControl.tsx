import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { canWake } from "@/features/liveUpdates/nativeLive";
import { Chip, Control, Meter, Section, Segments } from "@/features/pc/ComputerParts";
import { DeviceControls } from "@/features/pc/DeviceControls";
import {
  formatBytes,
  formatRate,
  formatUptime,
  parsePcApps,
  parsePcShortcuts,
  parsePcStats,
  pcError,
  sortPcApps,
  type AppSort,
  type PcAction,
  type PcApp,
  type PcShortcut,
  type PcStats,
  type PowerAction,
  type ShortcutAction,
} from "@/features/pc/pcModel";
import { wakeComputer } from "@/features/pc/wake";
import { SettingsPage } from "@/features/settings/SettingsUI";
import * as Haptics from "@/ui/haptics";
import { Icon } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

/** Stats refresh this often while the screen is open. */
const STATS_EVERY_MS = 3_000;
/** How long a Monitor off/on press outranks what stats say. */
const MONITOR_SETTLE_MS = 4_000;
/** The running apps list costs more to make: refreshed less often. */
const APPS_EVERY_MS = 9_000;

const SORTS: { value: AppSort; label: string }[] = [
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "RAM" },
  { value: "name", label: "Name" },
];

type Note = { text: string; failed: boolean };
type Answer = { done?: boolean; note?: string };

/** Changing commands carry the send time; the computer refuses stale ones. */
const stamped = (params: object): object => ({ ...params, sentAt: Date.now() });

const answerNote = (raw: unknown): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const note = Reflect.get(raw, "note");
  return typeof note === "string" ? note : undefined;
};

/**
 * Fork (Hari, L-280): the paired computer from the phone. Its stats, power
 * (monitor off, lock, hibernate), a screenshot, the apps chosen on the
 * computer, and its running apps; Wake computer while it can't be reached.
 * Nothing is asked of the computer while this screen is closed.
 * L-288: the Control tab of the Computer hub; Monitor on takes Monitor off's
 * place while the monitor is off from here.
 * L-293: a spinner beside a row while its action runs; Apps and Running apps
 * fold (closed at first); Lock moved off (Hibernate and Monitor off stay);
 * sound, media, camera, Bluetooth, Hibernate when idle and the computer's
 * files below.
 */
export function ComputerControl({ onOpenShare }: { onOpenShare: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { pairing, command } = useConnection();
  const fingerprint = pairing?.desktop.fingerprint ?? null;
  const [stats, setStats] = useState<PcStats | null>(null);
  const [apps, setApps] = useState<PcApp[] | null>(null);
  const [shortcuts, setShortcuts] = useState<PcShortcut[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sort, setSort] = useState<AppSort>("cpu");
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [openShortcut, setOpenShortcut] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appsOpen, setAppsOpen] = useState(false);
  const [runningOpen, setRunningOpen] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The monitor as last switched from here, trusted over stats for a moment:
  // the computer acts half a second after it answers.
  const monitorPress = useRef<{ off: boolean; at: number } | null>(null);

  const say = useCallback((text: string, failed = false) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote({ text, failed });
    noteTimer.current = setTimeout(() => setNote(null), failed ? 6_000 : 3_000);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const next = parsePcStats(await command<unknown>("pc.stats"));
      const press = monitorPress.current;
      if (press && Date.now() - press.at < MONITOR_SETTLE_MS) next.monitorOff = press.off;
      setStats(next);
      setReachable(true);
      setFailure(null);
    } catch (reason) {
      setReachable(false);
      setFailure(pcError(reason));
    }
  }, [command]);

  const loadLists = useCallback(async () => {
    try {
      const [running, chosen] = await Promise.all([
        command<unknown>("pc.apps"),
        command<unknown>("pc.shortcuts"),
      ]);
      setApps(parsePcApps(running));
      setShortcuts(parsePcShortcuts(chosen));
    } catch {
      // loadStats reports the computer being out of reach.
    }
  }, [command]);

  useFocusEffect(
    useCallback(() => {
      if (!fingerprint) return;
      let statsTimer: ReturnType<typeof setInterval> | null = null;
      let appsTimer: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (statsTimer) return;
        void loadStats();
        void loadLists();
        statsTimer = setInterval(() => void loadStats(), STATS_EVERY_MS);
        appsTimer = setInterval(() => void loadLists(), APPS_EVERY_MS);
      };
      const stop = () => {
        if (statsTimer) clearInterval(statsTimer);
        if (appsTimer) clearInterval(appsTimer);
        statsTimer = null;
        appsTimer = null;
      };
      start();
      const appState = AppState.addEventListener("change", (state) =>
        state === "active" ? start() : stop(),
      );
      return () => {
        stop();
        appState.remove();
      };
    }, [fingerprint, loadStats, loadLists]),
  );

  if (!pairing)
    return (
      <SettingsPage>
        <Notice title="Pair with your computer first" text="Computer shows your computer’s stats and lets you control it from here." />
      </SettingsPage>
    );

  const run = async (key: string, method: string, params: object, done: string): Promise<boolean> => {
    setBusy(key);
    try {
      const answer = await command<Answer>(method, stamped(params));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      say(answerNote(answer) ?? done);
      void loadLists();
      return true;
    } catch (reason) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      say(pcError(reason), true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const power = (action: PowerAction, done: string) => run(`power.${action}`, "pc.power", { action }, done);

  const monitor = async (off: boolean) => {
    if (!(await power(off ? "monitorOff" : "monitorOn", off ? "Monitor off" : "Monitor on"))) return;
    monitorPress.current = { off, at: Date.now() };
    setStats((current) => (current ? { ...current, monitorOff: off } : current));
  };

  const hibernate = () =>
    Alert.alert("Hibernate the computer?", "Open work stays as it is. Wake it with the power button or Wake computer here.", [
      { text: "Cancel", style: "cancel" },
      { text: "Hibernate", style: "destructive", onPress: () => void power("hibernate", "Hibernating") },
    ]);

  const screenshot = async () => {
    setBusy("screenshot");
    try {
      await command<unknown>("pc.screenshot", {});
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      say("Screenshot on its way to Share");
    } catch (reason) {
      say(pcError(reason), true);
    } finally {
      setBusy(null);
    }
  };

  const appAction = (app: PcApp, action: PcAction, done: string) =>
    run(`app.${app.pid}`, "pc.app", { action, pid: app.pid, identity: app.identity }, done);

  const endApp = (app: PcApp) =>
    Alert.alert(`End ${app.title || app.name}?`, "It stops at once, with anything unsaved. Close asks it to save first.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End",
        style: "destructive",
        onPress: () => {
          setOpenApp(null);
          void appAction(app, "end", "Ended");
        },
      },
    ]);

  const shortcutAction = (shortcut: PcShortcut, action: ShortcutAction, done: string) =>
    run(`shortcut.${shortcut.id}`, "pc.shortcut", { id: shortcut.id, action }, done);

  const wake = async () => {
    if (!fingerprint) return;
    setBusy("wake");
    try {
      if (await wakeComputer(fingerprint)) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        say("Wake sent. It can take a minute to start.");
      }
    } catch (reason) {
      say(pcError(reason), true);
    } finally {
      setBusy(null);
    }
  };

  const memory = stats?.memory;
  const sortedApps = apps ? sortPcApps(apps, sort) : null;

  return (
    <SettingsPage>
      {note ? (
        <View
          style={[styles.note, note.failed && styles.noteFailed]}
          accessibilityRole={note.failed ? "alert" : "text"}
          accessibilityLiveRegion="polite"
        >
          <Icon name={note.failed ? "info" : "check"} size={16} color={note.failed ? colors.deletions : colors.additions} />
          <Text style={[styles.noteText, note.failed && styles.noteTextFailed]}>{note.text}</Text>
        </View>
      ) : null}

      {reachable === false ? (
        <View style={styles.offline}>
          <Icon name="computerOff" size={28} color={colors.faint} />
          <Text style={styles.offlineTitle}>Your computer isn’t reachable</Text>
          <Text style={styles.offlineText}>{failure ?? "It may be asleep, off or on another network."}</Text>
          {canWake ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy === "wake", busy: busy === "wake" }}
              disabled={busy === "wake"}
              onPress={() => void wake()}
              style={({ pressed }) => [styles.wake, busy === "wake" && styles.disabled, pressed && styles.pressedScale]}
            >
              <Icon name="power" size={18} color={colors.onAccent} />
              <Text style={styles.wakeLabel}>Wake computer</Text>
            </Pressable>
          ) : null}
          {canWake ? <Text style={styles.offlineHint}>Works on the same Wi-Fi as the computer.</Text> : null}
        </View>
      ) : null}

      {reachable !== false ? (
        <Section title="Stats" right={stats?.uptime !== undefined ? <Text style={styles.aside}>Up {formatUptime(stats.uptime)}</Text> : null}>
          {stats ? (
            <View style={styles.stats}>
              <View style={styles.meters}>
                <Meter label="CPU" percent={stats.cpu} />
                <Meter label="GPU" percent={stats.gpu} />
              </View>
              <View style={styles.meters}>
                <Meter
                  label="Memory"
                  percent={memory ? (memory.used / memory.total) * 100 : undefined}
                  detail={memory ? `${formatBytes(memory.used)} of ${formatBytes(memory.total)}` : undefined}
                />
                <View style={styles.network} accessible accessibilityLabel={`Network down ${formatRate(stats.network?.down)}, up ${formatRate(stats.network?.up)}`}>
                  <Text style={styles.networkLabel}>Network</Text>
                  <Text style={styles.networkValue} numberOfLines={1}>
                    ↓ {formatRate(stats.network?.down)}   ↑ {formatRate(stats.network?.up)}
                  </Text>
                </View>
              </View>
              {stats.disks.length ? (
                <View style={styles.disks}>
                  {stats.disks.map((disk) => (
                    <Meter
                      key={disk.name}
                      label={`Drive ${disk.name}`}
                      percent={((disk.total - disk.free) / disk.total) * 100}
                      detail={`${formatBytes(disk.free)} free of ${formatBytes(disk.total)}`}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.skeleton} accessibilityLabel="Loading stats" />
          )}
        </Section>
      ) : null}

      <View style={styles.controls}>
        {stats?.monitorOff ? (
          <Control icon="monitor" label="Monitor on" busy={busy === "power.monitorOn"} disabled={reachable === false} onPress={() => void monitor(false)} />
        ) : (
          <Control icon="computerOff" label="Monitor off" busy={busy === "power.monitorOff"} disabled={reachable === false} onPress={() => void monitor(true)} />
        )}
        <Control icon="moon" label="Hibernate" busy={busy === "power.hibernate"} disabled={reachable === false} onPress={hibernate} />
        <Control icon="image" label="Screenshot" busy={busy === "screenshot"} disabled={reachable === false} onPress={() => void screenshot()} />
      </View>
      {busy === null && note?.text === "Screenshot on its way to Share" ? (
        <Pressable accessibilityRole="link" onPress={onOpenShare} hitSlop={8} style={styles.shareLink}>
          <Text style={styles.link}>Open Share</Text>
        </Pressable>
      ) : null}

      {reachable !== false && shortcuts?.length ? (
        <Section title="Apps" fold={{ open: appsOpen, onToggle: () => setAppsOpen(!appsOpen), count: shortcuts.length }}>
          {shortcuts.map((shortcut, index) => {
            const expanded = openShortcut === shortcut.id;
            const working = busy === `shortcut.${shortcut.id}`;
            return (
              <View key={shortcut.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${shortcut.name}, ${shortcut.running ? "running" : shortcut.found ? "not running" : "not found on the computer"}`}
                  onPress={() => setOpenShortcut(expanded ? null : shortcut.id)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={[styles.dot, shortcut.running && styles.dotOn]} />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {shortcut.name}
                  </Text>
                  <Text style={styles.rowMeta}>{shortcut.running ? "Running" : shortcut.found ? "" : "Not found"}</Text>
                  {working ? <ActivityIndicator size="small" color={colors.muted} accessibilityLabel="Working" /> : null}
                </Pressable>
                {expanded ? (
                  <View style={styles.chips}>
                    {shortcut.running ? (
                      <>
                        <Chip label="Show" disabled={working} onPress={() => void shortcutAction(shortcut, "open", "Shown")} />
                        <Chip label="Minimize" disabled={working} onPress={() => void shortcutAction(shortcut, "minimize", "Minimized")} />
                        <Chip label="Maximize" disabled={working} onPress={() => void shortcutAction(shortcut, "maximize", "Maximized")} />
                        <Chip label="Restart" disabled={working} onPress={() => void shortcutAction(shortcut, "restart", "Restarting")} />
                        {shortcut.self ? null : (
                          <Chip label="Close" danger disabled={working} onPress={() => void shortcutAction(shortcut, "close", "Closed")} />
                        )}
                      </>
                    ) : (
                      <Chip label="Open" disabled={working || !shortcut.found} onPress={() => void shortcutAction(shortcut, "open", "Opening")} />
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Section>
      ) : null}

      {reachable !== false ? (
        <Section
          title="Running apps"
          fold={{ open: runningOpen, onToggle: () => setRunningOpen(!runningOpen), count: sortedApps?.length }}
          right={<Segments label="Sort running apps" value={sort} options={SORTS} onChange={setSort} />}
        >
          {sortedApps === null ? (
            <View style={styles.skeleton} accessibilityLabel="Loading running apps" />
          ) : sortedApps.length === 0 ? (
            <Text style={styles.empty}>No apps with a window open.</Text>
          ) : (
            sortedApps.map((app, index) => {
              const key = `${app.pid}`;
              const expanded = openApp === app.identity;
              const working = busy === `app.${key}`;
              const meta = [app.name, app.cpu === undefined ? null : `${Math.round(app.cpu)}% CPU`, formatBytes(app.memory)]
                .filter(Boolean)
                .join(" · ");
              return (
                <View key={app.identity}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${app.title || app.name}. ${meta}`}
                    onPress={() => setOpenApp(expanded ? null : app.identity)}
                    style={({ pressed }) => [styles.appRow, pressed && styles.pressed]}
                  >
                    <View style={styles.appText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {app.title || app.name}
                      </Text>
                      <Text style={styles.appMeta} numberOfLines={1}>
                        {meta}
                      </Text>
                    </View>
                    {working ? <ActivityIndicator size="small" color={colors.muted} accessibilityLabel="Working" /> : null}
                  </Pressable>
                  {expanded ? (
                    <View style={styles.chips}>
                      <Chip label="Minimize" disabled={working} onPress={() => void appAction(app, "minimize", "Minimized")} />
                      <Chip label="Maximize" disabled={working} onPress={() => void appAction(app, "maximize", "Maximized")} />
                      {app.self ? null : (
                        <Chip label="Close" disabled={working} onPress={() => void appAction(app, "close", "Asked to close")} />
                      )}
                      {app.self || app.protected ? null : (
                        <Chip label="End" danger disabled={working} onPress={() => endApp(app)} />
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </Section>
      ) : null}

      <DeviceControls say={say} reachable={reachable} />

      {reachable !== false ? (
        <Section title="Files">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/computer/files")}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Icon name="drive" size={20} color={colors.accent} />
            <Text style={styles.rowTitle}>Browse the computer’s files</Text>
            <View style={styles.rowEnd}>
              <Icon name="chevronRight" size={16} color={colors.muted} />
            </View>
          </Pressable>
        </Section>
      ) : null}
    </SettingsPage>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.offline}>
      <Icon name="computer" size={28} color={colors.faint} />
      <Text style={styles.offlineTitle}>{title}</Text>
      <Text style={styles.offlineText}>{text}</Text>
    </View>
  );
}

const useStyles = themedStyles((colors) => ({
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  noteFailed: {},
  noteText: { flex: 1, color: colors.content, fontSize: 14, lineHeight: 19 },
  noteTextFailed: { color: colors.deletions },
  offline: { alignItems: "center", gap: 8, marginTop: 32, marginBottom: 8, paddingHorizontal: 24 },
  offlineTitle: { color: colors.content, fontSize: 17, fontWeight: "600", textAlign: "center" },
  offlineText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  offlineHint: { color: colors.muted, fontSize: 13, textAlign: "center" },
  wake: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    marginTop: 12,
    paddingHorizontal: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  wakeLabel: { color: colors.onAccent, fontSize: 16, fontWeight: "600" },
  aside: { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
  stats: { padding: 14, gap: 18 },
  meters: { flexDirection: "row", gap: 18 },
  network: { flex: 1, minWidth: 0, gap: 2 },
  networkLabel: { color: colors.muted, fontSize: 13, marginBottom: 2 },
  networkValue: { color: colors.content, fontSize: 14, fontVariant: ["tabular-nums"] },
  disks: { gap: 14 },
  skeleton: { height: 120, backgroundColor: colors.surface, opacity: 0.6 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  shareLink: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center", paddingHorizontal: 4 },
  link: { color: colors.accent, fontSize: 15, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 14, backgroundColor: colors.stroke },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14 },
  appRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  appText: { flex: 1, minWidth: 0, gap: 2 },
  rowEnd: { marginLeft: "auto" },
  rowTitle: { flexShrink: 1, color: colors.content, fontSize: 15 },
  rowMeta: { marginLeft: "auto", color: colors.muted, fontSize: 13 },
  appMeta: { color: colors.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
  dotOn: { backgroundColor: colors.additions },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  empty: { color: colors.muted, fontSize: 14, padding: 14 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.96 }], opacity: 0.85 },
}));
