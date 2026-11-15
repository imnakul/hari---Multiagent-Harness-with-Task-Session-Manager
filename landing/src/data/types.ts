/**
 * Media for any slot on the site. Drop files in `landing/public/media/`
 * and reference them as "media/your-file.webp" (no leading slash).
 * Leave `media` undefined and the slot renders a designed placeholder.
 */
export type Media =
  | { type: "image"; src: string; alt: string; width?: number; height?: number }
  | {
      type: "video";
      src: string;
      /** Still frame shown before the video loads. Strongly recommended. */
      poster?: string;
      alt: string;
    };

export type Area =
  | "agents"
  | "sessions"
  | "workspace"
  | "toolkit"
  | "insight"
  | "phone"
  | "craft";

export const AREA_LABEL: Record<Area, string> = {
  agents: "Agents",
  sessions: "Sessions",
  workspace: "Workspace",
  toolkit: "Toolkit",
  insight: "Insight",
  phone: "Phone",
  craft: "Craft",
};
