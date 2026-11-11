import { Host as UniversalHost, Slider as UniversalSlider } from "@expo/ui";
import { Slider as ComposeSlider } from "@expo/ui/jetpack-compose";
import { Host, Picker, Slider, Text as NativeText } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import * as Haptics from "expo-haptics";
import { Image as ExpoImage } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AccentSwitch } from "@/ui/AccentSwitch";

import {
  OPACITY_RANGE,
  useEmptyBackground,
} from "@/features/background/useEmptyBackground";
import {
  useAppearancePreference,
  type AppearancePreference,
} from "@/features/settings/appearance";
import { SettingsPage, SettingsRow } from "@/features/settings/SettingsUI";
import { useCollapsedToolCalls } from "@/features/settings/toolCalls";
import { useWallpaperUri } from "@/features/wallpaper/Backdrop";
import {
  PRESET_IDS,
  presetHue,
  presetLabel,
  type PresetId,
} from "@/features/wallpaper/presets";
import {
  BLUR_RANGE,
  DIM_RANGE,
  pickWallpaperPhoto,
  setWallpaper,
  useWallpaper,
  type WallpaperSource,
} from "@/features/wallpaper/wallpaper";
import { projectForRoute } from "@/features/workspace/routing";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { Icon } from "@/ui/Icon";
import {
  ACCENTS,
  accentColor,
  accentLabel,
  GLASS_RANGE,
  hueOf,
  radii,
  setLook,
  themedStyles,
  TINT_STRENGTH,
  useColors,
  useLook,
  useScheme,
  withAlpha,
  type AccentChoice,
  type AccentPreset,
} from "@/ui/theme";

// Appearance: the open project's empty-chat photo first, shown as it will
// look, then light, dark or the phone's own as a native segmented control,
// and the app's look (L-245): its accent, a tint of it over the backgrounds,
// and a wallpaper behind every screen. Last, how the transcript shows tool calls.
export default function AppearanceScreen() {
  const styles = useStyles();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const project = projectForRoute(useWorkspace().projects, projectId);
  return (
    <SettingsPage>
      {project ? (
        <>
          <Text style={[styles.heading, styles.firstHeading]}>
            Empty chat photo
          </Text>
          <BackgroundSection projectId={project.id} />
        </>
      ) : null}
      <Text style={[styles.heading, !project && styles.firstHeading]}>
        Color scheme
      </Text>
      <SchemeControl />
      <AccentSection />
      <TintSection />
      <WallpaperSection />
      <TranscriptSection />
    </SettingsPage>
  );
}

const SCHEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies { value: AppearancePreference; label: string }[];

/** Light, dark or the phone's own, as iOS's own segmented control. */
function SchemeControl() {
  const [preference, setPreference] = useAppearancePreference();
  const colors = useColors();
  const styles = useStyles();
  // SwiftUI's segmented picker has no Android view; a row of buttons stands in.
  if (Platform.OS === "android") return (
    <View style={styles.segments}>
      {SCHEMES.map((option) => {
        const selected = preference === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => {
              void Haptics.selectionAsync();
              setPreference(option.value);
            }}
            style={[styles.segment, selected && { backgroundColor: colors.surfaceRaised }]}
          >
            <Text style={styles.segmentLabel}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <Host matchContents={{ vertical: true }}>
      <Picker
        selection={preference}
        onSelectionChange={(value) => {
          void Haptics.selectionAsync();
          setPreference(value as AppearancePreference);
        }}
        modifiers={[pickerStyle("segmented")]}
      >
        {SCHEMES.map((option) => (
          <NativeText key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </NativeText>
        ))}
      </Picker>
    </Host>
  );
}

/** How long a slider rests before the app redraws in its value. */
const COMMIT_DELAY = 120;

/**
 * A labelled slider whose thumb follows the finger at once, while the app
 * redraws in its value only once it rests a moment: each look change redraws
 * every screen, too much for every frame of a drag.
 */
function LookSlider({
  label,
  value,
  min,
  max,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const shown = draft ?? value;
  const change = (next: number) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onCommit(next);
      setDraft(null);
    }, COMMIT_DELAY);
  };
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{format(shown)}</Text>
      </View>
      <View accessible accessibilityLabel={label} accessibilityValue={{ text: format(shown) }}>
        <UniversalHost style={styles.slider}>
          {Platform.OS === "android" ? (
            // Android's own colours are Material's (from the phone's wallpaper), not the app's.
            <ComposeSlider
              value={shown}
              min={min}
              max={max}
              onValueChange={change}
              colors={{
                thumbColor: colors.accent,
                activeTrackColor: colors.accent,
                inactiveTrackColor: withAlpha(colors.accent, 0.24),
              }}
            />
          ) : (
            <UniversalSlider value={shown} min={min} max={max} onValueChange={change} />
          )}
        </UniversalHost>
      </View>
    </View>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Plays the tap's haptic, then changes the look two frames later, so the
 *  tap answers before every screen redraws. */
function changeLook(change: () => void) {
  void Haptics.selectionAsync();
  requestAnimationFrame(() => requestAnimationFrame(change));
}

// Blue is the app's own, so it stands for "default" rather than appearing twice.
const PRESETS = (Object.keys(ACCENTS) as AccentPreset[]).filter((name) => name !== "blue");
const ACCENT_CHOICES: AccentChoice[] = ["default", ...PRESETS];

/** The accent: the app's blue, a preset, any hue, or the wallpaper's own. */
function AccentSection() {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useScheme();
  const look = useLook();
  const wallpaperHue = useWallpaperHue();
  // The tapped dot checks at once; the app redraws a moment later.
  const [tapped, setTapped] = useState<AccentChoice | null>(null);
  const shown = tapped ?? look.accent;
  const custom = shown.startsWith("hue:");
  const pick = (choice: AccentChoice) => {
    if (choice === shown) return;
    setTapped(choice);
    changeLook(() => {
      setLook({ accent: choice });
      setTapped(null);
    });
  };
  const matched = wallpaperHue !== null && shown === `hue:${wallpaperHue}`;
  // A custom hue starts from the accent in use.
  const customHue = custom ? Number(shown.slice(4)) : hueOf(accentColor(shown, "dark"));
  return (
    <>
      <Text style={styles.heading}>Accent</Text>
      <View style={[styles.card, styles.accents]}>
        {ACCENT_CHOICES.map((choice) => (
          <AccentDot
            key={choice}
            fill={accentColor(choice, scheme)}
            label={choice === "default" ? "Blue (default)" : accentLabel(choice)}
            selected={choice === shown}
            onPress={() => pick(choice)}
          />
        ))}
        <AccentDot
          fill={accentColor(`hue:${customHue}`, scheme)}
          label="Custom colour"
          selected={custom && !matched}
          custom
          onPress={() => pick(`hue:${customHue}`)}
        />
      </View>
      {custom && !matched ? (
        <View style={[styles.card, styles.sliderCard]}>
          <LookSlider
            label="Hue"
            value={customHue}
            min={0}
            max={359}
            format={(hue) => `${Math.round(hue)}°`}
            onCommit={(hue) => setLook({ accent: `hue:${Math.round(hue) % 360}` })}
          />
        </View>
      ) : null}
      {wallpaperHue !== null ? (
        <View style={[styles.card, styles.followingCard]}>
          <SettingsRow
            icon="image"
            label="Match wallpaper"
            showChevron={false}
            onPress={() => pick(`hue:${wallpaperHue}`)}
            accessory={matched ? <Icon name="check" size={18} color={colors.accent} /> : null}
          />
        </View>
      ) : null}
      <Text style={styles.note}>
        {matched ? "Matched to your wallpaper." : `${accentLabel(shown)}.`} Send and stop,
        switches, links and selections take it, and so does the Live Update.
      </Text>
    </>
  );
}

function AccentDot({
  fill,
  label,
  selected,
  custom = false,
  onPress,
}: {
  fill: string;
  label: string;
  selected: boolean;
  custom?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.accentRing,
        selected && { borderColor: fill },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.accentDot, { backgroundColor: fill }]}>
        {selected ? (
          <Icon name="check" size={14} color={colors.onAccent === "#ffffff" ? "#ffffff" : "#0c0c0c"} />
        ) : custom ? (
          <Icon name="add" size={14} color="#ffffff" />
        ) : null}
      </View>
    </Pressable>
  );
}

/** The accent washed over backgrounds, cards and sheets, and how strongly. */
function TintSection() {
  const styles = useStyles();
  const look = useLook();
  const [tapped, setTapped] = useState<boolean | null>(null);
  const on = tapped ?? look.tint;
  const turn = (next: boolean) => {
    setTapped(next);
    changeLook(() => {
      setLook({ tint: next });
      setTapped(null);
    });
  };
  return (
    <>
      <Text style={styles.heading}>Backgrounds</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="layers"
          label="Tint with the accent"
          showChevron={false}
          onPress={() => turn(!on)}
          accessory={
            <AccentSwitch
              accessibilityLabel="Tint with the accent"
              value={on}
              onValueChange={turn}
            />
          }
        />
        {on ? (
          <>
            <View style={styles.divider} />
            <LookSlider
              label="Tint strength"
              value={look.strength}
              min={TINT_STRENGTH.min}
              max={TINT_STRENGTH.max}
              format={percent}
              onCommit={(strength) => setLook({ strength })}
            />
          </>
        ) : null}
      </View>
      <Text style={styles.note}>
        {on
          ? "Backgrounds, cards and sheets take a little of the accent's colour."
          : "Backgrounds stay neutral grey; only buttons and highlights take the accent."}
      </Text>
    </>
  );
}

/** The wallpaper's main hue, for an accent to match; null without one. */
function useWallpaperHue(): number | null {
  const { source } = useWallpaper();
  const look = useLook();
  if (source.kind === "preset") return presetHue(source.id, hueOf(accentColor(look.accent, "dark")));
  if (source.kind === "photo") return source.hue;
  return null;
}

const NONE: WallpaperSource = { kind: "none" };

/** The picture behind every screen: none, one of the app's, or a photo. */
function WallpaperSection() {
  const styles = useStyles();
  const scheme = useScheme();
  const wallpaper = useWallpaper();
  const { source } = wallpaper;
  const [busy, setBusy] = useState(false);
  const choose = (next: WallpaperSource) => {
    void Haptics.selectionAsync();
    setWallpaper({ source: next });
  };
  const pickPhoto = () => {
    setBusy(true);
    pickWallpaperPhoto()
      .catch(() => {
        Alert.alert("Couldn't use that photo", "Try another one.");
        return false;
      })
      .finally(() => setBusy(false));
  };
  const dimKey = scheme === "dark" ? "dimDark" : "dimLight";
  return (
    <>
      <Text style={styles.heading}>Wallpaper</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tiles}
        style={styles.tileStrip}
      >
        <WallpaperTile label="None" selected={source.kind === "none"} onPress={() => choose(NONE)} />
        {PRESET_IDS.map((id) => (
          <PresetTile
            key={id}
            id={id}
            selected={source.kind === "preset" && source.id === id}
            onPress={() => choose({ kind: "preset", id })}
          />
        ))}
        <PhotoTile
          source={source.kind === "photo" ? source : null}
          busy={busy}
          onPress={pickPhoto}
        />
      </ScrollView>
      {source.kind !== "none" ? (
        <View style={[styles.card, styles.sliderCard]}>
          <LookSlider
            label={scheme === "dark" ? "Dim (dark)" : "Dim (light)"}
            value={wallpaper[dimKey]}
            min={DIM_RANGE.min}
            max={DIM_RANGE.max}
            format={percent}
            onCommit={(dim) => setWallpaper({ [dimKey]: dim })}
          />
          <View style={styles.sliderDivider} />
          <LookSlider
            label="Card opacity"
            value={wallpaper.glass}
            min={GLASS_RANGE.min}
            max={GLASS_RANGE.max}
            format={percent}
            onCommit={(glass) => setWallpaper({ glass })}
          />
          <View style={styles.sliderDivider} />
          <LookSlider
            label="Softness"
            value={wallpaper.blur}
            min={BLUR_RANGE.min}
            max={BLUR_RANGE.max}
            format={(blur) => `${Math.round(blur)}`}
            onCommit={(blur) => setWallpaper({ blur: Math.round(blur) })}
          />
        </View>
      ) : null}
      <Text style={styles.note}>
        {source.kind === "none"
          ? "A picture behind the side menu, lists, Tasks, Activity and chats."
          : "Dim is set for light and dark apart, and is a little stronger behind messages. Code and Changes keep a plain background."}
      </Text>
    </>
  );
}

function WallpaperTile({
  label,
  selected,
  uri,
  icon,
  busy = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  uri?: string | null;
  icon?: "add" | "image";
  busy?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.tileFrame, selected && { borderColor: colors.accent }]}>
        <View style={styles.tileImage}>
          {uri ? (
            <ExpoImage
              source={{ uri }}
              contentFit="cover"
              cachePolicy="memory-disk"
              style={StyleSheet.absoluteFill}
              accessible={false}
            />
          ) : null}
          {busy ? (
            <ActivityIndicator color={colors.muted} />
          ) : icon && !uri ? (
            <Icon name={icon} size={20} color={colors.muted} />
          ) : null}
          {selected ? (
            <View style={[styles.tileCheck, { backgroundColor: colors.accent }]}>
              <Icon name="check" size={12} color={colors.onAccent} />
            </View>
          ) : null}
        </View>
      </View>
      <Text style={[styles.tileLabel, selected && { color: colors.content }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function PresetTile({
  id,
  selected,
  onPress,
}: {
  id: PresetId;
  selected: boolean;
  onPress: () => void;
}) {
  const uri = useWallpaperUri({ kind: "preset", id });
  return <WallpaperTile label={presetLabel(id)} uri={uri} selected={selected} onPress={onPress} />;
}

function PhotoTile({
  source,
  busy,
  onPress,
}: {
  source: Extract<WallpaperSource, { kind: "photo" }> | null;
  busy: boolean;
  onPress: () => void;
}) {
  const uri = useWallpaperUri(source ?? NONE);
  return (
    <WallpaperTile
      label={source ? "Change photo" : "Photo"}
      uri={uri}
      icon={source ? "image" : "add"}
      selected={!!source}
      busy={busy}
      onPress={onPress}
    />
  );
}

/** Tool calls folded to their phase's label until tapped, on by default. */
function TranscriptSection() {
  const styles = useStyles();
  const [collapsed, setCollapsed] = useCollapsedToolCalls();
  return (
    <>
      <Text style={styles.heading}>Transcript</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="wrench"
          label="Collapse tool calls"
          onPress={() => setCollapsed(!collapsed)}
          accessory={
            <AccentSwitch
              value={collapsed}
              onValueChange={setCollapsed}
            />
          }
        />
      </View>
      <Text style={styles.note}>
        Show only the label of the step the agent is on. Tap a step to see its
        tool calls.
      </Text>
    </>
  );
}

/** The project's empty-chat photo: shown as the chat shows it, picked,
 *  changed or removed here, how strongly it shows, and whether it is dithered. */
function BackgroundSection({ projectId }: { projectId: string }) {
  const colors = useColors();
  const styles = useStyles();
  const controls = useEmptyBackground(projectId);
  const { settings, background, busy } = controls;
  return (
    <>
      <View style={[styles.card, styles.backgroundCard]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={settings.image ? "Change photo" : "Choose photo"}
          onPress={() => void controls.pickImage()}
          style={[styles.preview, { backgroundColor: colors.background }]}
        >
          {background ? (
            <Image
              source={background.source}
              resizeMode="cover"
              style={[StyleSheet.absoluteFill, { opacity: background.opacity }]}
            />
          ) : null}
          {busy ? (
            <ActivityIndicator color={colors.muted} />
          ) : settings.image ? null : (
            <View style={styles.previewEmpty}>
              <Icon name="image" size={26} color={colors.muted} />
              <Text style={styles.previewHint}>Choose a photo</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.backgroundRows}>
          {settings.image ? (
            <>
              <View style={styles.visibility}>
                {Platform.OS === "android" ? (
                  <UniversalHost style={styles.slider}>
                    <UniversalSlider
                      value={settings.opacity}
                      min={OPACITY_RANGE.min}
                      max={OPACITY_RANGE.max}
                      onValueChange={controls.setOpacity}
                    />
                  </UniversalHost>
                ) : <Host style={styles.slider}>
                  <Slider
                    value={settings.opacity}
                    min={OPACITY_RANGE.min}
                    max={OPACITY_RANGE.max}
                    step={0.01}
                    onValueChange={controls.setOpacity}
                    modifiers={[
                      tint(colors.accent),
                      accessibilityLabel("Background visibility"),
                    ]}
                  />
                </Host>}
              </View>
              <View style={styles.divider} />
              <SettingsRow
                icon="sparkle"
                label="Dither effect"
                showChevron={false}
                onPress={() => controls.setDither(!settings.dither)}
                accessory={
                  <AccentSwitch
                    accessibilityLabel="Dither effect"
                    value={settings.dither}
                    onValueChange={controls.setDither}
                  />
                }
              />
              <View style={styles.divider} />
            </>
          ) : null}
          <SettingsRow
            icon="image"
            label={settings.image ? "Change photo" : "Choose photo"}
            onPress={() => void controls.pickImage()}
          />
          {settings.image ? (
            <>
              <View style={styles.divider} />
              <SettingsRow
                icon="trash"
                label="Remove photo"
                showChevron={false}
                destructive
                onPress={controls.removeImage}
              />
            </>
          ) : null}
        </View>
      </View>
      <Text style={styles.note}>
        Covers the wallpaper in this project&apos;s new chats. The dither effect draws it
        in dots, faded out toward the composer, as the desktop does.
      </Text>
    </>
  );
}

const TILE_WIDTH = 68;
const TILE_HEIGHT = 120;

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
  // Inset to the rows' labels, past their icons.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 40,
    backgroundColor: colors.stroke,
  },
  sliderDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 6,
    backgroundColor: colors.stroke,
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginHorizontal: 16,
  },
  firstHeading: {
    marginTop: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  backgroundCard: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  preview: {
    height: 220,
    borderRadius: radii.card - 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  previewEmpty: {
    alignItems: "center",
    gap: 8,
  },
  previewHint: {
    color: colors.muted,
    fontSize: 15,
  },
  // Under the preview, in line with the other cards' rows.
  backgroundRows: {
    marginTop: 6,
    marginHorizontal: -2,
  },
  accents: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    rowGap: 10,
  },
  // A ring that takes the accent's colour once it is the one picked.
  accentRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  accentDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderCard: {
    marginTop: 10,
    paddingVertical: 4,
  },
  followingCard: {
    marginTop: 10,
  },
  sliderRow: {
    paddingHorizontal: 6,
    paddingTop: 10,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sliderLabel: {
    color: colors.content,
    fontSize: 15,
  },
  sliderValue: {
    color: colors.muted,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  visibility: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  slider: {
    height: 44,
  },
  tileStrip: {
    marginHorizontal: -16,
  },
  tiles: {
    paddingHorizontal: 16,
    gap: 10,
  },
  tile: {
    width: TILE_WIDTH,
    alignItems: "center",
    gap: 6,
  },
  // The ring around a tile, in the accent once picked; the image sits inside
  // it at a radius 3 smaller, so the curves stay concentric.
  tileFrame: {
    padding: 3,
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileImage: {
    width: TILE_WIDTH - 10,
    height: TILE_HEIGHT,
    borderRadius: 11,
    borderCurve: "continuous",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.stroke,
  },
  tileCheck: {
    position: "absolute",
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  segments: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentLabel: {
    color: colors.content,
    fontSize: 14,
    fontWeight: "500",
  },
}));
