import type { ReactNode } from "react";
import { Text } from "react-native";

import { PixelMascot } from "@/features/mascots/PixelMascot";
import { ProjectMascot } from "@/features/mascots/ProjectMascot";
import type { Mono, Project } from "@/features/workspace/types";
import { Icon, type IconName } from "@/ui/Icon";
import { themedStyles, useColors } from "@/ui/theme";
import type { PlaceIcon } from "./placeIcons";

const ICON = 26;
const MASCOT = 32;

/** Fork (Hari, L-412): the arc's first circle, every project or Mono. */
export function AllFace({ icon, size = ICON }: { icon: IconName; size?: number }) {
  const colors = useColors();
  return <Icon name={icon} size={size} color={colors.content} />;
}

/** The icon or emoji chosen on the phone, else what the desktop shows. */
export function PlaceFace({
  icon,
  fallback,
  iconSize = ICON,
}: {
  icon: PlaceIcon | undefined;
  fallback: ReactNode;
  /** For a chosen icon, and an emoji drawn to match. */
  iconSize?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (icon?.kind === "icon") return <Icon name={icon.name} size={iconSize} color={colors.content} />;
  if (icon?.kind === "emoji") return <Text style={[styles.emoji, iconSize !== ICON && { fontSize: iconSize, lineHeight: iconSize + 6 }]}>{icon.text}</Text>;
  return <>{fallback}</>;
}

export function ProjectFace({
  project,
  icon,
  size = MASCOT,
  iconSize,
}: {
  project: Project;
  icon: PlaceIcon | undefined;
  size?: number;
  iconSize?: number;
}) {
  return (
    <PlaceFace
      icon={icon}
      iconSize={iconSize}
      fallback={<ProjectMascot project={project.path} color={project.color} name={project.mascot} size={size} />}
    />
  );
}

export function MonoFace({ mono, icon, size = MASCOT }: { mono: Mono; icon: PlaceIcon | undefined; size?: number }) {
  return (
    <PlaceFace
      icon={icon}
      fallback={<PixelMascot name={mono.mascot} color={mono.color} status={mono.status} size={size} centered />}
    />
  );
}

const useStyles = themedStyles(() => ({
  emoji: { fontSize: 28, lineHeight: 34, textAlign: "center" },
}));
