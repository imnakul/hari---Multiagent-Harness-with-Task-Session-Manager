/**
 * Site-wide facts. Update these when you ship; everything on the page reads
 * from here, so numbers never drift between sections.
 */
export const site = {
  name: "Hari",
  version: "0.16",
  /** Facts drawn from the repo on 15 Nov 2026 (branch nakul/windows-support-upstream-0.16.0). */
  stats: {
    features: 321, // L-01 … L-321 in docs/LOCAL-FEATURES.md
    commits: 445, // commits authored on the fork
    days: 73, // 3 Sep 2026 → 15 Nov 2026
    desktopMB: 25,
    phoneMB: 70,
  },
  downloads: {
    // TODO: point these at the real installer and APK (GitHub Pages or Releases).
    windows: {
      href: "https://github.com/imnakul/hari---Multiagent-Harness-with-Task-Session-Manager/releases/latest",
      file: "Hari_x64-setup.exe",
      note: "Windows 10 and 11 · x64",
    },
    android: {
      href: "https://github.com/imnakul/hari---Multiagent-Harness-with-Task-Session-Manager/releases/latest",
      file: "Hari.apk",
      note: "Android phones",
    },
  },
  links: {
    github: "https://github.com/imnakul/hari---Multiagent-Harness-with-Task-Session-Manager",
    monocode: "https://github.com/hardbeat920/monocode",
  },
  /** Agent CLIs Hari can drive with your existing sign-ins. Names only; no logos. */
  agents: [
    "Claude Code",
    "Codex",
    "Antigravity",
    "OpenCode",
    "Command Code",
    "Cline",
    "Cursor",
    "Grok Build",
    "Devin",
    "Pi",
    "Hermes Agent",
  ],
} as const;
