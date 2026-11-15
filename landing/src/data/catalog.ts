import type { Area } from "./types";

/** The "Everything in Hari" index. One line each; keep them short. */
export type CatalogItem = { name: string; line: string; area: Area; isNew?: boolean };

export const catalog: CatalogItem[] = [
  // Agents
  { area: "agents", name: "Claude Code", line: "Structured chat or the native terminal, Interactive mode" },
  { area: "agents", name: "Codex", line: "Full catalog, effort, speed and sandbox modes" },
  { area: "agents", name: "Antigravity CLI", line: "Streaming, resume, quotas and custom agents" },
  { area: "agents", name: "OpenCode", line: "Free models grouped first" },
  { area: "agents", name: "Command Code", line: "Every model, with plan locks explained" },
  { area: "agents", name: "Cline", line: "As a provider, beside the others" },
  { area: "agents", name: "Queue & Steer", line: "Messages survive restarts and never auto-send by accident" },
  { area: "agents", name: "Sidechats", line: "Ask on the side with the source chat's context" },
  { area: "agents", name: "Forks & second opinions", line: "Nested under the chat they came from" },
  { area: "agents", name: "Multi-account", line: "Pick the account per chat; continue on another with full history" },
  { area: "agents", name: "Improve prompt", line: "✨ rewrites a rough draft into a complete prompt" },
  { area: "agents", name: "Live model switch", line: "Change model or permissions mid-run" },
  { area: "agents", name: "Clear approvals", line: "Allow once or Always, never auto-answered in Plan mode" },
  { area: "agents", name: "Recall with Up", line: "Step back through what you sent" },
  { area: "agents", name: "Inline media", line: "Images, videos and PDFs in every chat" },
  { area: "agents", name: "Link cards", line: "Rich previews for every link an agent writes" },

  // Sessions
  { area: "sessions", name: "Session overview", line: "Summary, Timeline, Bookmarks, Files changed" },
  { area: "sessions", name: "Focus mode", line: "Up to eight running chats from every project" },
  { area: "sessions", name: "Zen mode", line: "A slim docked panel with up to four chats" },
  { area: "sessions", name: "Session Manager", line: "Four columns, tags, drafts and counts" },
  { area: "sessions", name: "Drafts", line: "Write now, start later" },
  { area: "sessions", name: "Session metadata", line: "Labels and markdown notes on any chat" },
  { area: "sessions", name: "Idle covers", line: "A summary card over chats you left a while ago" },
  { area: "sessions", name: "Native resume", line: "Import and continue Claude and Codex CLI conversations" },
  { area: "sessions", name: "Split panes", line: "Rounded cards with a gliding focus ring" },
  { area: "sessions", name: "Notifications", line: "Replies, approvals, questions and automation runs in one bell" },
  { area: "sessions", name: "Cloud & Remote", line: "Local, Remote Control or Cloud per chat" },

  // Workspace
  { area: "workspace", name: "Browser", line: "Tabs, bookmarks, console, network, device sizes" },
  { area: "workspace", name: "Browser side panel", line: "Beside the chat, sends pages and selections to it" },
  { area: "workspace", name: "Whiteboard", line: "Excalidraw sheets that save themselves" },
  { area: "workspace", name: "Drawing agent", line: "An agent that draws on the board, in the background" },
  { area: "workspace", name: "Notes", line: "Live markdown, Preview and Source on Ctrl+E" },
  { area: "workspace", name: "Task Manager", line: "List, Table and Board with a peek pane" },
  { area: "workspace", name: "Focus today", line: "A week strip that carries tasks over" },
  { area: "workspace", name: "# tasks in chat", line: "Hand a task to an agent from any composer" },
  { area: "workspace", name: "Terminal", line: "ConPTY on Windows, GPU rendering optional" },
  { area: "workspace", name: "Source control", line: "Full-row diffs, partial staging, AI commit text" },
  { area: "workspace", name: "Quick Composer", line: "A global shortcut to start a chat from anywhere" },

  // Toolkit
  { area: "toolkit", name: "MCP manager", line: "Per-provider switches, per-account servers" },
  { area: "toolkit", name: "Skills", line: "Project and personal skills in Settings" },
  { area: "toolkit", name: "Prompt library", line: "Type ! in any composer" },
  { area: "toolkit", name: "Automations", line: "Cron editor with plain-language preview" },
  { area: "toolkit", name: "Monos", line: "Agents across projects with memory and schedules" },
  { area: "toolkit", name: "Operator", line: "/operator lets an agent run sessions, tasks and notes" },
  { area: "toolkit", name: "Debug Inspector", line: "Cross-provider metadata and token trace" },
  { area: "toolkit", name: "Shortcuts", line: "Rebind anything in Settings → Shortcuts" },

  // Insight
  { area: "insight", name: "Activity tracker", line: "Day, week and month of everything you did" },
  { area: "insight", name: "ActivityWatch", line: "Apps, sites and meetings beside your prompts" },
  { area: "insight", name: "AI day notes", line: "A short note after each turn and a weekly summary" },
  { area: "insight", name: "Session analytics", line: "Tokens, cache, cost and quota per turn" },
  { area: "insight", name: "Context meter", line: "System, tools, memory and skills, broken down" },
  { area: "insight", name: "Usage everywhere", line: "5-hour, weekly and monthly limits per account" },
  { area: "insight", name: "Performance panel", line: "FPS, main-thread checks, backend timings" },
  { area: "insight", name: "Resources panel", line: "CPU, RAM and GPU per agent, with Stop" },
  { area: "insight", name: "Storage manager", line: "Every attachment, by chat, project or date" },

  // Phone
  { area: "phone", name: "Hari for Android", line: "Your sessions, tasks and notes on the phone", isNew: true },
  { area: "phone", name: "Answer from notifications", line: "Approve, Deny, Answer and Reply" },
  { area: "phone", name: "Live Updates", line: "Running sessions in Android's status area" },
  { area: "phone", name: "Share", line: "Text, links, clipboard and files, both ways", isNew: true },
  { area: "phone", name: "Share bar", line: "Ctrl+Alt+H, always on top of every app", isNew: true },
  { area: "phone", name: "Share bubble", line: "One tap over any Android app sends the clipboard", isNew: true },
  { area: "phone", name: "Share with Hari", line: "From Explorer's menu and Android's share sheet" },
  { area: "phone", name: "Control centre", line: "Volume, media, Bluetooth, camera, monitor" },
  { area: "phone", name: "Power", line: "Lock, hibernate, restart, shut down, Minimal mode", isNew: true },
  { area: "phone", name: "Apps", line: "Open, close, minimise or end apps on the PC" },
  { area: "phone", name: "Wake-on-LAN", line: "Wake the computer from the phone" },
  { area: "phone", name: "Find my phone", line: "Ring it at alarm volume from the desktop" },
  { area: "phone", name: "Browse files", line: "The PC's drives on the phone, the phone's on the PC" },
  { area: "phone", name: "Phone stats on PC", line: "Battery, temperature, storage and network" },
  { area: "phone", name: "Offline Tasks & Notes", line: "Edits wait and sync when the PC is back" },
  { area: "phone", name: "Hibernate when idle", line: "Sleeps the PC once every agent has finished" },

  // Craft
  { area: "craft", name: "Wallpaper", line: "Any image, with Haze and other effects" },
  { area: "craft", name: "Acrylic glass", line: "Native Windows glass with adjustable strength" },
  { area: "craft", name: "Accent & tint", line: "Presets, any hue, or matched to the wallpaper" },
  { area: "craft", name: "Gliding hover", line: "One highlight that slides through every list" },
  { area: "craft", name: "Close to tray", line: "Agents keep running when the window closes" },
  { area: "craft", name: "Launch on startup", line: "Starts quietly in the tray" },
  { area: "craft", name: "Self-healing window", line: "Recovers from a WebView2 crash, keeps your draft" },
  { area: "craft", name: "Auto-updates", line: "Desktop and phone, from one release" },
];
