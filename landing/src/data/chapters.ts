import type { Area, Media } from "./types";

export type Slot = {
  /** Short caption under the media, e.g. "Focus mode · 8 chats". */
  caption: string;
  /** Width / height. 16/10 for desktop shots, 9/19.5 for phone shots. */
  aspect?: number;
  media?: Media;
};

export type Chapter = {
  id: Area;
  kicker: string;
  /** Wrap one word in *asterisks* to set it in the italic display face. */
  title: string;
  lede: string;
  points: { title: string; body: string }[];
  slots: Slot[];
};

export const chapters: Chapter[] = [
  {
    id: "agents",
    kicker: "Agents",
    title: "Every agent, *one* composer.",
    lede:
      "Pick Claude Code, Codex, Antigravity, OpenCode, Command Code or Cline per chat, on the subscriptions you already have. Hari runs them side by side and keeps each one honest about tokens, quota and cost.",
    points: [
      {
        title: "Claude Code, two ways",
        body: "Structured chat, or Interactive: Claude's native terminal behind a clean transcript, with resume, PDFs, images and skills.",
      },
      {
        title: "Queue, steer, never lose a message",
        body: "Send while an agent works. Messages queue, survive restarts, and Steer cuts in only when you say so.",
      },
      {
        title: "Sidechats, forks, second opinions",
        body: "Branch a thought without derailing the main run. Ask another model. Nested under the chat they came from.",
      },
      {
        title: "Continue on another account",
        body: "Hit a limit? Move the chat to another Claude account with its full history and keep going.",
      },
      {
        title: "Improve prompt ✨",
        body: "Ctrl+Alt+I turns a rough draft into a complete prompt, keeping every path, @mention and command intact.",
      },
    ],
    slots: [
      { caption: "Composer with model, account and effort pickers" },
      { caption: "Live usage per account in the bottom bar", aspect: 16 / 6 },
    ],
  },
  {
    id: "sessions",
    kicker: "Sessions",
    title: "Run ten sessions. *Lose* none.",
    lede:
      "Built for running many AI sessions at once. Every chat gets a summary, a timeline, bookmarks and the list of files it touched, so coming back takes seconds instead of a scroll.",
    points: [
      {
        title: "Session overview",
        body: "Summary with a Left off card, Timeline, Bookmarks and Files changed in a glass panel beside each chat (Ctrl+Shift+O).",
      },
      {
        title: "Focus mode",
        body: "Running chats from every project side by side, up to eight, chrome hidden, panes resizable and draggable.",
      },
      {
        title: "Zen mode",
        body: "Ctrl+Alt+Z docks Hari as a slim panel on the right edge with up to four chats, so a browser, Figma or a call gets the rest.",
      },
      {
        title: "Session Manager",
        body: "A four-column board with tags, drafts you can start later and counts in the sidebar.",
      },
      {
        title: "Labels, notes and covers",
        body: "Give any chat a label and markdown notes, written for you by AI if you want, shown as a cover when you return.",
      },
    ],
    slots: [
      { caption: "Focus mode · chats from every project" },
      { caption: "Session overview · Summary, Timeline, Bookmarks" },
    ],
  },
  {
    id: "workspace",
    kicker: "Workspace",
    title: "The tabs you used to *alt-tab* to.",
    lede:
      "A real browser, a whiteboard with its own drawing agent, Obsidian-style notes, a task manager and a native terminal. All inside the same glass window as your agents, all able to hand context to a chat.",
    points: [
      {
        title: "Browser",
        body: "Tabs, bookmarks, console and network details, phone and tablet sizes. Opens beside a chat and sends pages, links or selections to it.",
      },
      {
        title: "Whiteboard",
        body: "Excalidraw sheets that save themselves, and an agent that draws on them, including with Interactive Claude.",
      },
      {
        title: "Notes",
        body: "Live markdown like Obsidian, with Preview and Source a keystroke away (Ctrl+E). Paste images straight in.",
      },
      {
        title: "Task Manager",
        body: "List, Table and Board views, a Focus-today strip, and # in any composer to hand a task to an agent.",
      },
      {
        title: "Terminal",
        body: "ConPTY on Windows, optionally drawn on the GPU, opened from the chat box.",
      },
    ],
    slots: [
      { caption: "Browser panel beside a chat" },
      { caption: "Whiteboard with the drawing agent" },
      { caption: "Task Manager · Board view" },
    ],
  },
  {
    id: "toolkit",
    kicker: "Toolkit",
    title: "Your agents' toolbelt, *managed*.",
    lede:
      "The parts of agent work that usually live in config files and terminal history: MCP servers, skills, saved prompts and scheduled runs, each with its own page and switches.",
    points: [
      {
        title: "MCP manager",
        body: "Add servers once, switch them on or off per provider, see the servers each Claude account carries.",
      },
      {
        title: "Skills",
        body: "Browse, enable and disable project and personal skills from Settings → Skills.",
      },
      {
        title: "Prompt library",
        body: "Save prompts and type ! in any composer to drop one in.",
      },
      {
        title: "Automations",
        body: "Scheduled agent runs with a cron editor that explains itself in plain language and previews the next run.",
      },
      {
        title: "Monos",
        body: "Agents that work across your projects, keep a memory, and file your to-dos into Tasks.",
      },
    ],
    slots: [{ caption: "MCP servers with per-provider switches" }, { caption: "Automation with a cron preview" }],
  },
  {
    id: "insight",
    kicker: "Insight",
    title: "Know where the *time* went.",
    lede:
      "An activity tracker for your whole day, analytics for every session, and the instruments to keep a 25 MB app at full frame rate while eight agents run.",
    points: [
      {
        title: "Activity",
        body: "Every prompt and agent turn by day, week or month. With ActivityWatch: apps, sites and meetings, plus AI notes and summaries.",
      },
      {
        title: "Session analytics",
        body: "Tokens, cache, cost and remaining quota per turn, per chat and per account, with a context meter that uses the provider's own numbers.",
      },
      {
        title: "Performance panel",
        body: "FPS, main-thread stalls and the timing of every backend call, with a log you can record.",
      },
      {
        title: "Resources panel",
        body: "CPU, RAM and GPU for every agent's process tree, with a pressure warning and a Stop on each.",
      },
      {
        title: "Storage manager",
        body: "Every image and file you ever gave an agent, by chat, project or date. Open, copy, drag back in, or clean up.",
      },
    ],
    slots: [
      { caption: "Activity · Week view" },
      { caption: "Process monitor · CPU, RAM, GPU", aspect: 16 / 7 },
      { caption: "Storage · every attachment in one place" },
    ],
  },
  {
    id: "phone",
    kicker: "Phone",
    title: "Your PC, in your *pocket*.",
    lede:
      "The Hari phone app pairs by scanning a code and holds one encrypted link to your computer (QUIC with mutual TLS 1.3). Run and approve sessions, pass anything across in one tap, and control the machine itself, even wake it up.",
    points: [
      {
        title: "Sessions on the go",
        body: "Chat, queue and watch Claude's terminal from the phone. Approve, deny or answer right from the notification.",
      },
      {
        title: "Share anything, both ways",
        body: "Text, links, clipboard and files. Share bar on Windows (Ctrl+Alt+H), a share bubble over any Android app.",
      },
      {
        title: "A control centre for your PC",
        body: "Volume, media, Bluetooth, camera, monitor off, lock, hibernate, restart, shut down, and apps open or closed.",
      },
      {
        title: "Wake it. Find it.",
        body: "Wake-on-LAN when the PC sleeps; Find my phone rings the phone at alarm volume from the desktop.",
      },
      {
        title: "Works offline",
        body: "Tasks and Notes stay on the phone and sync back when the computer returns.",
      },
    ],
    slots: [
      { caption: "Hari · Sessions", aspect: 9 / 19.5 },
      { caption: "Hari · Share", aspect: 9 / 19.5 },
      { caption: "Hari · Control", aspect: 9 / 19.5 },
    ],
  },
  {
    id: "craft",
    kicker: "Craft",
    title: "Glass first. *Fast* always.",
    lede:
      "Hari started with one idea: an agent harness should look as good as your wallpaper. Then we made it fast enough that the glass never costs you a frame.",
    points: [
      {
        title: "Your wallpaper, behind everything",
        body: "Any image with effects like Haze, under Acrylic glass whose strength, tint and accent you choose.",
      },
      {
        title: "Motion with a purpose",
        body: "Gliding hover highlights, sliding panels, a Zen dock that glides into place, and all of it off with Reduce motion.",
      },
      {
        title: "Off the main thread",
        body: "Saves, git and database writes run in the background, so the window never stalls under load.",
      },
      {
        title: "Heals itself",
        body: "A crashed WebView2 reloads on its own and keeps the text you were typing.",
      },
      {
        title: "Updates itself",
        body: "Desktop and phone both update automatically. 25 MB and 70 MB.",
      },
    ],
    slots: [{ caption: "Wallpaper & glass settings" }],
  },
];
