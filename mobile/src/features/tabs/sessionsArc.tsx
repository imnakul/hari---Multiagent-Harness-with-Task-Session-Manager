import { useMemo } from "react";

import { useConnection } from "@/features/connection/ConnectionProvider";
import { useWorkspace } from "@/features/workspace/WorkspaceProvider";
import { AllFace, ProjectFace } from "./ArcFaces";
import type { ArcItem } from "./PlaceArc";
import { usePlaceIcons } from "./placeIcons";
import { ALL, selectInArc, useTabsMemory } from "./tabsMemory";

/** Faces sized for the arc's 52 pt circles. */
const ARC_ICON = 22;
const ARC_FACE = 26;

/**
 * Fork (Hari, L-412): the Sessions arc's places: All, then the five projects
 * opened last (those the desktop still has), with the selected one's index
 * and a way to pick one.
 */
export function useSessionsArc(): {
  items: ArcItem[];
  selectedIndex: number;
  select: (id: string) => void;
} {
  const fingerprint = useConnection().pairing?.desktop.fingerprint ?? "";
  const { projects } = useWorkspace();
  const memory = useTabsMemory(fingerprint);
  const icons = usePlaceIcons(fingerprint);
  const { recent, selected } = memory.arcs.sessions;
  const items = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    return [
      { id: ALL, label: "All projects", face: <AllFace icon="layers" size={ARC_ICON} /> },
      ...recent.flatMap((id) => {
        const project = byId.get(id);
        return project ? [{ id, label: project.name, face: <ProjectFace project={project} icon={icons[id]} size={ARC_FACE} iconSize={ARC_ICON} /> }] : [];
      }),
    ];
  }, [projects, recent, icons]);
  return {
    items,
    selectedIndex: Math.max(0, items.findIndex((item) => item.id === selected)),
    select: (id) => selectInArc(fingerprint, "sessions", id),
  };
}
