import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { themedStyles, useColors, withAlpha } from "@/ui/theme";
import { ARC_CIRCLE, arcOffset, arcPlacement, ringCopies } from "./tabMath";

export type ArcItem = {
  id: string;
  /** Over the selected circle. */
  label: string;
  /** What the circle holds: an icon, emoji or mascot, sized for `ARC_CIRCLE`. */
  face: ReactNode;
};

/** The selected name's line, over the circles. */
const NAME_ROW = 22;
/** Room for the selected name, the circles and their curve (28 pt down at two away). */
export const ARC_HEIGHT = NAME_ROW + ARC_CIRCLE + 30;

/**
 * Fork (Hari, L-412): the Sessions tab's arc of places, as drawn. Circles sit
 * on a curve around the one at `position` (a float index, moved on the UI
 * thread by the finger holding the Sessions tab), which is largest; its name
 * shows over the arc, clear of the thumb. It goes round (L-416). It takes no touches: the tab bar's gesture drives it.
 */
export function PlaceArc({
  items,
  position,
  shownIndex,
  width,
}: {
  items: readonly ArcItem[];
  position: SharedValue<number>;
  /** The circle nearest the middle, ringed and named. */
  shownIndex: number;
  width: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  const shown = items[shownIndex];
  // L-416: the places go round, repeated when there are few of them.
  const copies = ringCopies(items.length);
  const slots = Array.from({ length: copies }, (_, copy) => items.map((item) => ({ item, copy }))).flat();
  return (
    <View style={styles.arc} pointerEvents="none">
      {slots.map(({ item, copy }, slot) => (
        <ArcCircle
          key={item.id + ":" + copy}
          index={slot}
          count={slots.length}
          position={position}
          left={width / 2 - ARC_CIRCLE / 2}
        >
          {item.face}
        </ArcCircle>
      ))}
      <Text numberOfLines={1} style={[styles.name, { color: colors.accent }]}>
        {shown?.label.toUpperCase()}
      </Text>
    </View>
  );
}

function ArcCircle({
  index,
  count,
  position,
  left,
  children,
}: {
  index: number;
  count: number;
  position: SharedValue<number>;
  left: number;
  children: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ring = withAlpha(colors.content, 0.22);
  // The circle in the middle is ringed, whichever copy it is.
  const selectedRing = useAnimatedStyle(() => {
    const middle = Math.abs(arcOffset(index, position.get(), count)) < 0.5;
    return { borderWidth: middle ? 2 : 1, borderColor: middle ? colors.accent : ring };
  });
  const placed = useAnimatedStyle(() => {
    // L-416: the arc goes round, so the last circle sits before the first.
    const place = arcPlacement(arcOffset(index, position.get(), count));
    return {
      opacity: place.opacity,
      transform: [
        { translateX: place.translateX },
        { translateY: place.translateY },
        { scale: place.scale },
      ],
    };
  });
  return (
    <Animated.View style={[styles.circleSlot, { left }, placed]}>
      {/* A see-through bubble over the wallpaper, not the app's solid
          Android card (LiquidView), which read as dark discs here. */}
      <Animated.View style={[styles.circle, selectedRing]}>{children}</Animated.View>
    </Animated.View>
  );
}

const useStyles = themedStyles((colors) => ({
  arc: { height: ARC_HEIGHT, alignSelf: "stretch" },
  circleSlot: { position: "absolute", top: NAME_ROW, width: ARC_CIRCLE, height: ARC_CIRCLE },
  circle: {
    width: ARC_CIRCLE,
    height: ARC_CIRCLE,
    borderRadius: ARC_CIRCLE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.content, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.content, 0.22),
  },
  name: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
}));
