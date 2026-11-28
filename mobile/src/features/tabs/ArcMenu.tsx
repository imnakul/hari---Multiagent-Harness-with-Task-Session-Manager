import { useState } from "react";

import { ChoiceSheet } from "@/ui/ChoiceMenu";
import { IconPickerSheet } from "./IconPickerSheet";
import { removePlaceIcons, setPlaceIcon, type PlaceIcons } from "./placeIcons";
import { removeFromArc, type ArcKind } from "./tabsMemory";

type Target = { id: string; name: string };

/**
 * Fork (Hari, L-412): an arc circle's long-press menu (Change icon, Remove
 * from arc) and the icon picker it leads to. Returns the opener and the
 * sheets to render.
 */
export function useArcMenu(fingerprint: string, kind: ArcKind, icons: PlaceIcons) {
  const [menuFor, setMenuFor] = useState<Target | null>(null);
  const [iconFor, setIconFor] = useState<Target | null>(null);
  // Kept while the picker fades out, so its title doesn't blank.
  const [lastIconFor, setLastIconFor] = useState<Target | null>(null);
  const sheets = (
    <>
      <ChoiceSheet
        open={menuFor !== null}
        title={menuFor?.name ?? ""}
        sections={
          menuFor
            ? [
                [
                  {
                    label: "Change icon",
                    icon: "appearance",
                    onPress: () => {
                      setIconFor(menuFor);
                      setLastIconFor(menuFor);
                    },
                  },
                  {
                    label: "Remove from arc",
                    icon: "close",
                    destructive: true,
                    onPress: () => removeFromArc(fingerprint, kind, menuFor.id),
                  },
                ],
              ]
            : []
        }
        onClose={() => setMenuFor(null)}
      />
      <IconPickerSheet
        open={iconFor !== null}
        name={lastIconFor?.name ?? ""}
        current={lastIconFor ? icons[lastIconFor.id] : undefined}
        onPick={(icon) => {
          if (!iconFor) return;
          if (icon) setPlaceIcon(fingerprint, iconFor.id, icon);
          else removePlaceIcons(fingerprint, [iconFor.id]);
        }}
        onClose={() => setIconFor(null)}
      />
    </>
  );
  return { openMenu: (target: Target) => setMenuFor(target), sheets };
}
