import { createContext, use, useEffect, useState } from "react";
import { Image, Linking, Pressable, Text, View, type ImageStyle, type ViewStyle } from "react-native";

import type { MarkdownBlock } from "@/features/sessions/markdownParser";
import { radii, themedStyles, useColors, withAlpha } from "@/ui/theme";

import { hostOf, linkPreview, webLinks, type Command, type LinkCardStyle, type LinkPreview } from "./tools";

// Fork (Hari, L-236): a finished reply's web links as page cards, as the
// desktop shows them with Link previews set to Always. The desktop fetches the
// page; the card takes the desktop's Card style, sized for a phone.

/** Set by a finished reply when the desktop shows cards; unset, links stay plain. */
export const LinkCards = createContext<{ style: LinkCardStyle; command: Command } | null>(null);

/** A paragraph's cards stop at this many, as a long list of links would bury the reply. */
const CARDS_PER_BLOCK = 3;

/** The cards for the web links a paragraph or heading names, under it. */
export function BlockLinkCards({ block }: { block: MarkdownBlock }) {
  const cards = use(LinkCards);
  if (!cards) return null;
  const links = webLinks(block).slice(0, CARDS_PER_BLOCK);
  if (!links.length) return null;
  return (
    <>
      {links.map((url) => (
        <LinkCard key={url} url={url} style={cards.style} command={cards.command} />
      ))}
    </>
  );
}

type State =
  | { status: "loading" }
  | { status: "ready"; preview: LinkPreview }
  | { status: "unavailable" };

const LOOKS: Record<
  LinkCardStyle,
  { card: ViewStyle; image: ImageStyle; title: number; titleLines: number; lines: number }
> = {
  compact: { card: { height: 88 }, image: { width: 96 }, title: 13, titleLines: 1, lines: 2 },
  wide: { card: { height: 112 }, image: { width: "34%" }, title: 13, titleLines: 2, lines: 3 },
  large: { card: { flexDirection: "column" }, image: { aspectRatio: 1.91 }, title: 15, titleLines: 2, lines: 3 },
  "large-side": { card: { height: 140 }, image: { width: "40%" }, title: 15, titleLines: 2, lines: 4 },
};

export function LinkCard({ url, style, command }: { url: string; style: LinkCardStyle; command: Command }) {
  const styles = useStyles();
  const colors = useColors();
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    linkPreview(command, url, true).then(
      (preview) => {
        if (!live) return;
        const empty = !preview.title?.trim() && !preview.description?.trim() && !preview.imageDataUrl;
        setState(empty ? { status: "unavailable" } : { status: "ready", preview });
      },
      () => live && setState({ status: "unavailable" }),
    );
    return () => {
      live = false;
    };
  }, [command, url]);
  // A page with no preview keeps its link in the text alone.
  if (state.status === "unavailable") return null;
  const look = LOOKS[style];
  const large = style === "large";
  const preview = state.status === "ready" ? state.preview : null;
  const title = preview?.title?.trim() || hostOf(url);
  const description = preview?.description?.trim();
  const image = preview?.imageDataUrl ? (
    <Image source={{ uri: preview.imageDataUrl }} resizeMode="cover" style={[styles.image, look.image]} />
  ) : large && !preview ? (
    // Most pages have an image: its place is held so the card grows less.
    <View style={[styles.image, styles.skeleton, look.image]} />
  ) : null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${title}, ${hostOf(url)}`}
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => [styles.card, look.card, pressed && styles.pressed]}
    >
      {large ? image : null}
      <View style={[styles.text, large && styles.textLarge]}>
        <View style={styles.site}>
          {preview?.faviconDataUrl ? (
            <Image source={{ uri: preview.faviconDataUrl }} style={styles.favicon} />
          ) : null}
          <Text style={styles.host} numberOfLines={1}>
            {preview?.siteName?.trim() && style === "compact" ? preview.siteName.trim() : hostOf(url)}
          </Text>
        </View>
        {preview ? (
          <>
            <Text style={[styles.title, { fontSize: look.title }]} numberOfLines={look.titleLines}>
              {title}
            </Text>
            {description ? (
              <Text style={styles.description} numberOfLines={look.lines}>
                {description}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={[styles.line, { width: "80%", backgroundColor: withAlpha(colors.content, 0.08) }]} />
            <View style={[styles.line, { width: "55%", backgroundColor: withAlpha(colors.content, 0.06) }]} />
          </>
        )}
      </View>
      {large ? null : image}
    </Pressable>
  );
}

const useStyles = themedStyles((colors) => ({
  card: {
    flexDirection: "row",
    borderRadius: radii.row,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.stroke,
    backgroundColor: withAlpha(colors.content, 0.03),
    overflow: "hidden",
  },
  pressed: { backgroundColor: withAlpha(colors.content, 0.07) },
  text: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textLarge: { flex: 0, paddingVertical: 12 },
  site: { flexDirection: "row", alignItems: "center", gap: 6 },
  favicon: { width: 14, height: 14, borderRadius: 3 },
  host: { flexShrink: 1, color: colors.muted, fontSize: 12 },
  title: { color: colors.content, fontWeight: "600", lineHeight: 19 },
  description: { color: withAlpha(colors.content, 0.6), fontSize: 12, lineHeight: 16 },
  image: { backgroundColor: withAlpha(colors.content, 0.05) },
  skeleton: { backgroundColor: withAlpha(colors.content, 0.07) },
  line: { height: 10, borderRadius: 5 },
}));
