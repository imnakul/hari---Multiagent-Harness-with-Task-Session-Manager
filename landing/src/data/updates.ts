import type { Area, Media } from "./types";

/**
 * What's new. Newest first. Add an entry each time you ship.
 *
 * - date: ISO yyyy-mm-dd (shown as "15 Nov 2026").
 * - media: optional image or short video (keep videos under ~8 MB, muted, looped).
 * - refs: the L-IDs from docs/LOCAL-FEATURES.md, for your own tracking.
 */
export type Update = {
  date: string;
  version?: string;
  title: string;
  summary: string;
  highlights?: string[];
  areas: Area[];
  media?: Media;
  refs?: string[];
};

export const updates: Update[] = [
  {
    date: "2026-11-15",
    version: "0.16.0-local55",
    title: "Share bar, Share bubble and power from the phone",
    summary:
      "Sending something across is now one shortcut on Windows and one tap on Android, and the phone can restart, shut down or slim the PC down.",
    highlights: [
      "Share bar: Ctrl+Alt+H opens a see-through window above every app",
      "Share bubble floats over any Android app and sends the clipboard",
      "Restart, Shut down and Minimal mode tiles in the phone's Control tab",
      "Share history returns after a reinstall; removals sync both ways",
    ],
    areas: ["phone"],
    refs: ["L-317", "L-318", "L-319", "L-320", "L-321"],
  },
  {
    date: "2026-11-15",
    title: "Your PC's sound, camera and Bluetooth on the phone",
    summary:
      "The Control tab gained volume, output device, now playing, microphone mute, camera access and Bluetooth, plus hibernate-when-idle and file browsing in both directions.",
    highlights: [
      "Hibernate once every agent has been idle for two minutes",
      "Browse the PC's drives from the phone and the phone's from the PC",
      "Share opens as a glass side panel on the desktop",
    ],
    areas: ["phone"],
    refs: ["L-290", "L-292", "L-294", "L-295", "L-297"],
  },
  {
    date: "2026-11-14",
    title: "Storage manager and Share between devices",
    summary:
      "A gallery of every file you have given an agent, and a two-way channel for text, links, the clipboard and files between Hari and the computer.",
    areas: ["insight", "phone"],
    refs: ["L-273", "L-279", "L-280"],
  },
  {
    date: "2026-11-10",
    title: "Activity: a day, week or month of your work",
    summary:
      "Every prompt and finished turn by project and branch, with apps, sites and meetings from ActivityWatch and an AI note after each turn.",
    areas: ["insight"],
    refs: ["L-240", "L-253"],
  },
  {
    date: "2026-11-07",
    title: "Hari for Android",
    summary:
      "The phone app arrives with the peacock-feather icon, a frosted look you can tint and wallpaper, Live Updates for running sessions, and automatic updates.",
    areas: ["phone", "craft"],
    refs: ["L-235", "L-239", "L-245"],
  },
  {
    date: "2026-11-01",
    title: "Zen mode",
    summary:
      "Ctrl+Alt+Z turns the window into a slim panel docked to the right edge with up to four chats, so the rest of the screen is yours.",
    areas: ["sessions"],
    refs: ["L-230", "L-264"],
  },
  {
    date: "2026-10-31",
    title: "A browser inside Hari",
    summary:
      "Browser tabs and a side panel beside the chat, with bookmarks, device sizes, console and network details, and a right-click menu that sends anything to a chat.",
    areas: ["workspace"],
    refs: ["L-203", "L-207", "L-215", "L-222", "L-226"],
  },
  {
    date: "2026-10-30",
    title: "Whiteboard with a drawing agent",
    summary: "Excalidraw sheets that save themselves, and an agent that draws on them while you keep working.",
    areas: ["workspace"],
    refs: ["L-194", "L-199", "L-223"],
  },
  {
    date: "2026-10-29",
    title: "Session overview",
    summary:
      "Summary, Timeline, Bookmarks and Files changed for every chat, written as you go, so you can pick any session back up in seconds.",
    areas: ["sessions"],
    refs: ["L-191", "L-192"],
  },
  {
    date: "2026-10-20",
    title: "Focus mode",
    summary: "Running chats from every project side by side, up to eight, with resizable rounded panes and a gliding focus edge.",
    areas: ["sessions"],
    refs: ["L-123", "L-128", "L-143", "L-144"],
  },
  {
    date: "2026-10-03",
    title: "Task Manager and Session Manager",
    summary: "Persistent tasks in List, Table and Board views, and a four-column board for every session and draft.",
    areas: ["workspace", "sessions"],
    refs: ["L-41", "L-42", "L-43", "L-44"],
  },
  {
    date: "2026-09-09",
    title: "Usage, context and cost",
    summary: "Live token usage, a context breakdown and per-turn costs, with how much quota is left on every account.",
    areas: ["insight"],
    refs: ["L-11", "L-12", "L-24"],
  },
  {
    date: "2026-09-05",
    title: "A native Windows terminal",
    summary: "ConPTY terminals with no console flashes, and child processes tied to the app so nothing is left running.",
    areas: ["workspace"],
    refs: ["L-13", "L-14"],
  },
  {
    date: "2026-09-03",
    title: "Day one: glass and wallpaper on Windows",
    summary: "Native Acrylic glass, adjustable glass strength, typography choices and your own wallpaper behind it all.",
    areas: ["craft"],
    refs: ["L-09", "L-37"],
  },
];
