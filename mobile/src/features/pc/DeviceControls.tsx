import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Pressable, Text, View } from "react-native";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { Section, Tile, TileRow, TileSlider } from "@/features/pc/ComputerParts";
import {
  parseAudio,
  parseBluetooth,
  parseMedia,
  type PcAudio,
  type PcBluetooth,
  type PcMedia,
} from "@/features/pc/deviceModel";
import { pcError } from "@/features/pc/pcModel";
import { ChoiceMenu } from "@/ui/ChoiceMenu";
import * as Haptics from "@/ui/haptics";
import { Icon, type IconName } from "@/ui/Icon";
import { radii, themedStyles, useColors } from "@/ui/theme";

/** Sound and media change on the computer too: read again this often. */
const DEVICES_EVERY_MS = 6_000;
/** Bluetooth's paired list costs more: read less often. */
const BLUETOOTH_EVERY_MS = 20_000;
/** The extra dimming leaves at least this much of the monitor's brightness. */
const DIMMEST = 20;

const stamped = (params: object): object => ({ ...params, sentAt: Date.now() });

/**
 * Fork (Hari, L-292, L-294, L-295): the computer's microphone, sound, what's
 * playing, camera, Bluetooth and Hibernate when idle, on the Control tab.
 * L-307: laid out like a phone's control centre: tiles that fill with the
 * accent while on (`power` is the first row, `files` ends the last),
 * sliders for volume and brightness (extra dimming, `pc.dim`), the sound
 * output as a menu, and a media box. Reads nothing while not `active`.
 */
export function DeviceControls({
  say,
  active,
  power,
  system,
  files,
  after,
}: {
  say: (text: string, failed?: boolean) => void;
  active: boolean;
  /** The first row's three tiles. */
  power: ReactNode;
  /** Fork (L-318, L-319): the second row: Minimal mode, Restart, Shut down. */
  system?: ReactNode;
  /** The last row's last tile. */
  files: ReactNode;
  /** Under the tiles (Open Share after a screenshot). */
  after?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { command } = useConnection();
  const [audio, setAudio] = useState<PcAudio | null>(null);
  const [media, setMedia] = useState<PcMedia | null>(null);
  const [camera, setCamera] = useState<boolean | null>(null);
  const [bluetooth, setBluetooth] = useState<PcBluetooth | null>(null);
  const [idle, setIdle] = useState<boolean | null>(null);
  // Undefined until read; null when the computer can't dim.
  const [dim, setDim] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const read = useCallback(async () => {
    const [nextAudio, nextMedia, nextCamera, nextIdle, nextDim] = await Promise.allSettled([
      command<unknown>("pc.audio", {}),
      command<unknown>("pc.media", {}),
      command<{ allowed?: boolean }>("pc.camera", {}),
      command<{ armed?: boolean }>("pc.idleHibernate", {}),
      command<{ level?: unknown }>("pc.dim", {}),
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
    if (nextDim.status === "fulfilled") {
      const level = nextDim.value?.level;
      setDim(typeof level === "number" ? level : null);
    } else if (/Unsupported mobile operation|Only on Windows/i.test(String(nextDim.reason))) setDim(null);
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
      if (!active) return;
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
    }, [active, read, readBluetooth]),
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

  /**
   * A slider's value on its way: only the answer to the last one (`final`)
   * is shown, so an older answer arriving late can't move the slider back.
   */
  const slide = <T,>(method: string, params: object, final: boolean, apply: (answer: T) => void) => {
    command<T>(method, stamped(params)).then(
      (answer) => {
        if (final) apply(answer);
      },
      (reason: unknown) => {
        if (!final) return;
        say(pcError(reason), true);
        void read();
      },
    );
  };

  const setAudioFrom = (answer: unknown) => setAudio(parseAudio(answer));
  const playback = (action: "previous" | "playPause" | "next") =>
    void change(`media.${action}`, "pc.media", { action }, (answer: unknown) => setMedia(parseMedia(answer)));

  if (unsupported)
    return (
      <View style={styles.block}>
        <TileRow>{power}</TileRow>
        {system ? <TileRow>{system}</TileRow> : null}
        {after}
        <TileRow>
          {files}
          <View style={styles.spacer} />
          <View style={styles.spacer} />
        </TileRow>
        <Text style={styles.note}>Update MonoCode on your computer for sound, media, camera, Bluetooth and dimming.</Text>
      </View>
    );

  const mic = audio?.micMuted;
  const connected = bluetooth?.devices.filter((device) => device.connected).length ?? 0;
  const current = audio?.outputs.find((output) => output.default);

  return (
    <>
      <View style={styles.block}>
        <TileRow>{power}</TileRow>
        {system ? <TileRow>{system}</TileRow> : null}
        <TileRow>
          <Tile
            icon={mic ? "micOff" : "micOn"}
            label="Microphone"
            state={audio === null ? "…" : mic === undefined ? "None" : mic ? "Muted" : "On"}
            on={mic === false}
            disabled={mic === undefined}
            busy={busy === "mic"}
            onPress={() =>
              void change("mic", "pc.audio", { micMuted: !mic }, setAudioFrom, mic ? "Microphone on" : "Microphone muted")
            }
          />
          <Tile
            icon={audio?.speakerMuted ? "volumeOff" : "volume"}
            label="Sound"
            state={audio === null ? "…" : audio.speakerMuted ? "Muted" : "On"}
            on={audio !== null && !audio.speakerMuted}
            disabled={audio === null}
            busy={busy === "speaker"}
            onPress={() =>
              audio &&
              void change("speaker", "pc.audio", { speakerMuted: !audio.speakerMuted }, setAudioFrom, audio.speakerMuted ? "Sound on" : "Sound muted")
            }
          />
          <Tile
            icon={camera === false ? "cameraOff" : "cameraOn"}
            label="Camera"
            state={camera === null ? "…" : camera ? "Allowed" : "Blocked"}
            on={camera === true}
            disabled={camera === null}
            busy={busy === "camera"}
            onPress={() =>
              void change<{ allowed?: boolean }>(
                "camera",
                "pc.camera",
                { allowed: !camera },
                (answer) => setCamera(answer?.allowed ?? !camera),
                camera ? "Camera blocked for all apps" : "Camera allowed",
              )
            }
          />
        </TileRow>
        <TileRow>
          <Tile
            icon="bluetooth"
            label="Bluetooth"
            state={
              bluetooth === null
                ? "…"
                : !bluetooth.available
                  ? "None"
                  : !bluetooth.on
                    ? "Off"
                    : connected
                      ? `${connected} connected`
                      : "On"
            }
            on={bluetooth?.on === true}
            disabled={!bluetooth?.available}
            busy={busy === "bluetooth"}
            onPress={() =>
              bluetooth &&
              void change(
                "bluetooth",
                "pc.bluetooth",
                { on: !bluetooth.on },
                (answer: unknown) => setBluetooth(parseBluetooth(answer)),
                bluetooth.on ? "Bluetooth off" : "Bluetooth on",
              )
            }
          />
          <Tile
            icon="sleep"
            label="Auto-hibernate"
            state={idle === null ? "…" : idle ? "When idle" : "Off"}
            on={idle === true}
            disabled={idle === null}
            busy={busy === "idle"}
            onPress={() =>
              void change<{ armed?: boolean }>(
                "idle",
                "pc.idleHibernate",
                { armed: !idle },
                (answer) => setIdle(answer?.armed === true),
                idle ? "Auto-hibernate is off" : "Hibernates once no chat has worked for 2 minutes",
              )
            }
          />
          {files}
        </TileRow>
        {after}

        <TileSlider
          icon={audio?.speakerMuted ? "volumeOff" : "volume"}
          label="Volume"
          value={audio ? Math.round(audio.volume * 100) : null}
          onChange={(percent, final) => slide("pc.audio", { volume: percent / 100 }, final, setAudioFrom)}
        />
        {dim === null ? null : (
          <TileSlider
            icon="sun"
            label="Brightness"
            hint="Dims the computer's screens beyond the monitor's own brightness, until MonoCode quits"
            value={dim === undefined ? null : 100 - dim}
            min={DIMMEST}
            max={100}
            onChange={(brightness, final) =>
              slide<{ level?: unknown }>("pc.dim", { level: 100 - brightness }, final, (answer) =>
                setDim(typeof answer?.level === "number" ? answer.level : null),
              )
            }
          />
        )}

        {audio && audio.outputs.length > 1 ? (
          <ChoiceMenu
            label={`Sound output, ${current?.name ?? "not chosen"}`}
            title="Play sound on"
            disabled={busy !== null}
            style={styles.output}
            actions={audio.outputs.map((output) => ({
              label: output.name,
              selected: output.default,
              onPress: () =>
                void change(`output.${output.id}`, "pc.audio", { output: output.id }, setAudioFrom, `Sound now plays on ${output.name}`),
            }))}
          >
            <Icon name="headphones" size={22} color={colors.content} />
            <Text style={styles.outputLabel}>Output</Text>
            {busy?.startsWith("output.") ? <ActivityIndicator size="small" color={colors.muted} /> : null}
            <Text style={styles.outputName} numberOfLines={1}>
              {current?.name ?? "Choose"}
            </Text>
            <Icon name="chevronUpDown" size={16} color={colors.muted} />
          </ChoiceMenu>
        ) : null}

        <View style={styles.media} accessibilityLabel="Now playing">
          <View style={styles.mediaText}>
            <Text style={[styles.mediaTitle, !media?.title && styles.mediaIdle]} numberOfLines={1}>
              {media === null ? "Now playing" : media.title || "Nothing playing"}
            </Text>
            {media?.title ? (
              <Text style={styles.mediaMeta} numberOfLines={1}>
                {[media.artist, media.app].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
          </View>
          <MediaButton icon="previous" label="Previous" busy={busy === "media.previous"} disabled={media === null || busy !== null} onPress={() => playback("previous")} />
          <MediaButton
            icon={media?.playing ? "pause" : "play"}
            label={media?.playing ? "Pause" : "Play"}
            big
            busy={busy === "media.playPause"}
            disabled={media === null || busy !== null}
            onPress={() => playback("playPause")}
          />
          <MediaButton icon="next" label="Next" busy={busy === "media.next"} disabled={media === null || busy !== null} onPress={() => playback("next")} />
        </View>
      </View>

      {bluetooth?.available && bluetooth.on && bluetooth.devices.length ? (
        <Section
          title="Bluetooth devices"
          fold={{ open: devicesOpen, onToggle: () => setDevicesOpen(!devicesOpen), count: bluetooth.devices.length }}
        >
          {bluetooth.devices.map((device) => (
            <View key={device.name} style={styles.deviceRow}>
              <View style={[styles.dot, device.connected && styles.dotOn]} />
              <Text style={styles.deviceName} numberOfLines={1}>
                {device.name}
              </Text>
              <Text style={styles.deviceState}>{device.connected ? "Connected" : ""}</Text>
            </View>
          ))}
        </Section>
      ) : null}
    </>
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
      hitSlop={4}
      style={({ pressed }) => [
        styles.mediaButton,
        big && styles.mediaButtonBig,
        disabled && !busy && styles.disabled,
        pressed && styles.pressedScale,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={big ? colors.onAccent : colors.muted} />
      ) : (
        <Icon name={icon} size={big ? 22 : 20} color={big ? colors.onAccent : colors.content} />
      )}
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  block: { gap: 8 },
  spacer: { flex: 1 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingHorizontal: 4, paddingTop: 4 },
  output: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  outputLabel: { color: colors.content, fontSize: 15, fontWeight: "500" },
  outputName: { flex: 1, textAlign: "right", color: colors.muted, fontSize: 14 },
  media: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 76,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: radii.card,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
  },
  mediaText: { flex: 1, minWidth: 0, gap: 2 },
  mediaTitle: { color: colors.content, fontSize: 15, fontWeight: "600" },
  mediaIdle: { color: colors.muted, fontWeight: "500" },
  mediaMeta: { color: colors.muted, fontSize: 13 },
  mediaButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  mediaButtonBig: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 14 },
  deviceName: { flexShrink: 1, color: colors.content, fontSize: 15 },
  deviceState: { marginLeft: "auto", color: colors.muted, fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
  dotOn: { backgroundColor: colors.additions },
  disabled: { opacity: 0.4 },
  pressedScale: { transform: [{ scale: 0.94 }], opacity: 0.85 },
}));
