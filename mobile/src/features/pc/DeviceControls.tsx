import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { Chip, Section } from "@/features/pc/ComputerParts";
import {
  parseAudio,
  parseBluetooth,
  parseMedia,
  type PcAudio,
  type PcBluetooth,
  type PcMedia,
} from "@/features/pc/deviceModel";
import { pcError } from "@/features/pc/pcModel";
import { AccentSwitch } from "@/ui/AccentSwitch";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { themedStyles, useColors } from "@/ui/theme";

/** Sound and media change on the computer too: read again this often. */
const DEVICES_EVERY_MS = 6_000;
/** Bluetooth's paired list costs more: read less often. */
const BLUETOOTH_EVERY_MS = 20_000;
const VOLUME_STEP = 0.1;

const stamped = (params: object): object => ({ ...params, sentAt: Date.now() });

/**
 * Fork (Hari, L-292, L-294, L-295): the computer's microphone, sound, what's
 * playing, camera, Bluetooth and Hibernate when idle, on the Control tab.
 * Each row shows a spinner while its change is on the way.
 */
export function DeviceControls({ say, reachable }: { say: (text: string, failed?: boolean) => void; reachable: boolean | null }) {
  const styles = useStyles();
  const colors = useColors();
  const { command } = useConnection();
  const [audio, setAudio] = useState<PcAudio | null>(null);
  const [media, setMedia] = useState<PcMedia | null>(null);
  const [camera, setCamera] = useState<boolean | null>(null);
  const [bluetooth, setBluetooth] = useState<PcBluetooth | null>(null);
  const [idle, setIdle] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const read = useCallback(async () => {
    const [nextAudio, nextMedia, nextCamera, nextIdle] = await Promise.allSettled([
      command<unknown>("pc.audio", {}),
      command<unknown>("pc.media", {}),
      command<{ allowed?: boolean }>("pc.camera", {}),
      command<{ armed?: boolean }>("pc.idleHibernate", {}),
    ]);
    if (nextAudio.status === "rejected" && /Unsupported mobile operation/i.test(String(nextAudio.reason))) {
      setUnsupported(true);
      return;
    }
    setUnsupported(false);
    if (nextAudio.status === "fulfilled") setAudio(parseAudio(nextAudio.value));
    if (nextMedia.status === "fulfilled") setMedia(parseMedia(nextMedia.value));
    if (nextCamera.status === "fulfilled") setCamera(nextCamera.value?.allowed ?? null);
    if (nextIdle.status === "fulfilled") setIdle(nextIdle.value?.armed === true);
  }, [command]);

  const readBluetooth = useCallback(async () => {
    try {
      setBluetooth(parseBluetooth(await command<unknown>("pc.bluetooth", {})));
    } catch {
      // Shown as unavailable.
    }
  }, [command]);

  useFocusEffect(
    useCallback(() => {
      let timers: ReturnType<typeof setInterval>[] = [];
      const start = () => {
        if (timers.length) return;
        void read();
        void readBluetooth();
        timers = [
          setInterval(() => void read(), DEVICES_EVERY_MS),
          setInterval(() => void readBluetooth(), BLUETOOTH_EVERY_MS),
        ];
      };
      const stop = () => {
        timers.forEach(clearInterval);
        timers = [];
      };
      start();
      const appState = AppState.addEventListener("change", (state) => (state === "active" ? start() : stop()));
      return () => {
        stop();
        appState.remove();
      };
    }, [read, readBluetooth]),
  );

  /** Sends one change; the answer is the new state. */
  const change = async <T,>(key: string, method: string, params: object, apply: (answer: T) => void, done?: string) => {
    setBusy(key);
    try {
      apply(await command<T>(method, stamped(params)));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (done) say(done);
    } catch (reason) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      say(pcError(reason), true);
    } finally {
      setBusy(null);
    }
  };

  if (reachable === false) return null;
  if (unsupported)
    return (
      <Section title="Devices">
        <Text style={styles.empty}>Update MonoCode on your computer for sound, media, camera and Bluetooth.</Text>
      </Section>
    );

  const setAudioFrom = (answer: unknown) => setAudio(parseAudio(answer));
  const volume = audio ? Math.round(audio.volume * 100) : null;
  const nudge = (step: number) => {
    if (!audio) return;
    const next = Math.min(1, Math.max(0, Math.round((audio.volume + step) * 10) / 10));
    void change("volume", "pc.audio", { volume: next }, setAudioFrom);
  };
  const current = audio?.outputs.find((output) => output.default);

  return (
    <>
      <Section title="Sound">
        {audio ? (
          <>
            <ToggleRow
              icon={audio.micMuted ? "micOff" : "micOn"}
              label="Microphone"
              detail={audio.micMuted === undefined ? "No microphone" : audio.micMuted ? "Muted" : "On"}
              value={audio.micMuted === undefined ? false : !audio.micMuted}
              disabled={audio.micMuted === undefined}
              busy={busy === "mic"}
              onChange={(on) => void change("mic", "pc.audio", { micMuted: !on }, setAudioFrom, on ? "Microphone on" : "Microphone muted")}
            />
            <View style={styles.divider} />
            <View style={styles.row}>
              <Icon name={audio.speakerMuted ? "volumeOff" : "volume"} size={20} color={colors.accent} />
              <Text style={styles.rowTitle}>Volume</Text>
              {busy === "volume" || busy === "speaker" ? <ActivityIndicator size="small" color={colors.muted} /> : null}
              <View style={styles.stepper}>
                <StepButton label="Lower volume" glyph="−" disabled={busy !== null || volume === 0} onPress={() => nudge(-VOLUME_STEP)} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={audio.speakerMuted ? "Unmute sound" : "Mute sound"}
                  disabled={busy !== null}
                  onPress={() => void change("speaker", "pc.audio", { speakerMuted: !audio.speakerMuted }, setAudioFrom)}
                  hitSlop={6}
                >
                  <Text style={[styles.volume, audio.speakerMuted && styles.muted]}>{audio.speakerMuted ? "Muted" : `${volume}%`}</Text>
                </Pressable>
                <StepButton label="Raise volume" glyph="+" disabled={busy !== null || volume === 100} onPress={() => nudge(VOLUME_STEP)} />
              </View>
            </View>
            {audio.outputs.length > 1 ? (
              <>
                <View style={styles.divider} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: outputsOpen }}
                  onPress={() => setOutputsOpen(!outputsOpen)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Icon name="headphones" size={20} color={colors.accent} />
                  <Text style={styles.rowTitle}>Output</Text>
                  {busy?.startsWith("output.") ? <ActivityIndicator size="small" color={colors.muted} /> : null}
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {current?.name ?? "Choose"}
                  </Text>
                  <Icon name={outputsOpen ? "chevronDown" : "chevronRight"} size={16} color={colors.muted} />
                </Pressable>
                {outputsOpen ? (
                  <View style={styles.chips}>
                    {audio.outputs.map((output) => (
                      <Chip
                        key={output.id}
                        label={output.default ? `✓ ${output.name}` : output.name}
                        disabled={busy !== null || output.default}
                        onPress={() =>
                          void change(`output.${output.id}`, "pc.audio", { output: output.id }, setAudioFrom, `Sound now plays on ${output.name}`)
                        }
                      />
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <Loading />
        )}
      </Section>

      <Section title="Now playing">
        {media === null ? (
          <Loading />
        ) : media.title ? (
          <View style={styles.media}>
            <View style={styles.mediaText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {media.title}
              </Text>
              <Text style={styles.rowMetaLeft} numberOfLines={1}>
                {[media.artist, media.app].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View style={styles.mediaButtons}>
              <MediaButton icon="previous" label="Previous" busy={busy === "media.previous"} disabled={busy !== null} onPress={() => void change("media.previous", "pc.media", { action: "previous" }, (a: unknown) => setMedia(parseMedia(a)))} />
              <MediaButton
                icon={media.playing ? "pause" : "play"}
                label={media.playing ? "Pause" : "Play"}
                big
                busy={busy === "media.playPause"}
                disabled={busy !== null}
                onPress={() => void change("media.playPause", "pc.media", { action: "playPause" }, (a: unknown) => setMedia(parseMedia(a)))}
              />
              <MediaButton icon="next" label="Next" busy={busy === "media.next"} disabled={busy !== null} onPress={() => void change("media.next", "pc.media", { action: "next" }, (a: unknown) => setMedia(parseMedia(a)))} />
            </View>
          </View>
        ) : (
          <View style={styles.row}>
            <Icon name="music" size={20} color={colors.faint} />
            <Text style={styles.rowMetaLeft}>Nothing is playing</Text>
          </View>
        )}
      </Section>

      <Section title="Privacy and devices">
        <ToggleRow
          icon={camera === false ? "cameraOff" : "cameraOn"}
          label="Camera"
          detail={camera === null ? "Unavailable" : camera ? "Apps may use it" : "Blocked for all apps"}
          value={camera === true}
          disabled={camera === null}
          busy={busy === "camera"}
          onChange={(on) =>
            void change<{ allowed?: boolean }>("camera", "pc.camera", { allowed: on }, (a) => setCamera(a?.allowed ?? on), on ? "Camera allowed" : "Camera blocked")
          }
        />
        <View style={styles.divider} />
        <ToggleRow
          icon="bluetooth"
          label="Bluetooth"
          detail={
            bluetooth === null
              ? "Checking…"
              : !bluetooth.available
                ? "Not on this computer"
                : bluetooth.on
                  ? `${bluetooth.devices.filter((d) => d.connected).length} connected`
                  : "Off"
          }
          value={bluetooth?.on === true}
          disabled={!bluetooth?.available}
          busy={busy === "bluetooth"}
          onChange={(on) =>
            void change("bluetooth", "pc.bluetooth", { on }, (a: unknown) => setBluetooth(parseBluetooth(a)), on ? "Bluetooth on" : "Bluetooth off")
          }
        />
        {bluetooth?.available && bluetooth.on && bluetooth.devices.length ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: devicesOpen }}
              onPress={() => setDevicesOpen(!devicesOpen)}
              style={({ pressed }) => [styles.subRow, pressed && styles.pressed]}
            >
              <Text style={styles.link}>{devicesOpen ? "Hide paired devices" : `Paired devices (${bluetooth.devices.length})`}</Text>
            </Pressable>
            {devicesOpen
              ? bluetooth.devices.map((device) => (
                  <View key={device.name} style={styles.deviceRow}>
                    <View style={[styles.dot, device.connected && styles.dotOn]} />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {device.name}
                    </Text>
                    <Text style={styles.rowMeta}>{device.connected ? "Connected" : ""}</Text>
                  </View>
                ))
              : null}
          </>
        ) : null}
        <View style={styles.divider} />
        <ToggleRow
          icon="sleep"
          label="Hibernate when idle"
          detail="Once no chat has worked for 2 minutes, after a 30-second notice"
          value={idle === true}
          disabled={idle === null}
          busy={busy === "idle"}
          onChange={(on) =>
            void change<{ armed?: boolean }>("idle", "pc.idleHibernate", { armed: on }, (a) => setIdle(a?.armed === true), on ? "Hibernates once idle" : "Hibernate when idle is off")
          }
        />
      </Section>
    </>
  );
}

function ToggleRow({
  icon,
  label,
  detail,
  value,
  disabled,
  busy,
  onChange,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  value: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (value: boolean) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Icon name={icon} size={20} color={disabled ? colors.faint : colors.accent} />
      <View style={styles.toggleText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {detail ? <Text style={styles.rowMetaLeft}>{detail}</Text> : null}
      </View>
      {busy ? <ActivityIndicator size="small" color={colors.muted} /> : null}
      <AccentSwitch accessibilityLabel={label} value={value} disabled={disabled || busy} onValueChange={onChange} />
    </View>
  );
}

function StepButton({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled?: boolean; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.step, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.stepGlyph}>{glyph}</Text>
    </Pressable>
  );
}

function MediaButton({
  icon,
  label,
  big,
  busy,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  big?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.mediaButton, big && styles.mediaButtonBig, disabled && !busy && styles.disabled, pressed && styles.pressed]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={big ? colors.onAccent : colors.muted} />
      ) : (
        <Icon name={icon} size={big ? 22 : 20} color={big ? colors.onAccent : colors.content} />
      )}
    </Pressable>
  );
}

function Loading() {
  const styles = useStyles();
  return <View style={styles.skeleton} />;
}

const useStyles = themedStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  subRow: { minHeight: 40, justifyContent: "center", paddingHorizontal: 46 },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40, paddingLeft: 46, paddingRight: 14 },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { flexShrink: 1, color: colors.content, fontSize: 15 },
  rowMeta: { marginLeft: "auto", flexShrink: 1, color: colors.muted, fontSize: 13 },
  rowMetaLeft: { color: colors.muted, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 46, backgroundColor: colors.stroke },
  stepper: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  stepGlyph: { color: colors.content, fontSize: 20, lineHeight: 22 },
  volume: { minWidth: 52, textAlign: "center", color: colors.content, fontSize: 15, fontVariant: ["tabular-nums"] },
  muted: { color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, paddingBottom: 12 },
  media: { padding: 14, gap: 12 },
  mediaText: { gap: 2 },
  mediaButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  mediaButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  mediaButtonBig: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent },
  link: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
  dotOn: { backgroundColor: colors.additions },
  empty: { color: colors.muted, fontSize: 14, padding: 14 },
  skeleton: { height: 64, backgroundColor: colors.surface, opacity: 0.6 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
}));
