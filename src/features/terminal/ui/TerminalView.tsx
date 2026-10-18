import { Terminal } from "@xterm/xterm";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getPtyStatus,
  killPty,
  markUnsupportedNotified,
  ptyReplayFrom,
  PTY_SUPPORTED,
  PTY_UNSUPPORTED_MESSAGE,
  resizePty,
  spawnPty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import { isOscColorQuery, oscColorReply } from "../model/terminalChrome";
import {
  isMacTerminalClearShortcut,
  macTerminalShortcutData,
} from "../model/terminalKeys";
import {
  defaultTerminalTitle,
  scanOscCwd,
  type TerminalMetaPatch,
} from "../model/terminalTab";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import {
  applyTerminalChrome,
  fitTerminal,
  resetGridStretch,
  type TerminalFitMode,
} from "../model/terminalLayout";
import { IS_MAC } from "../../../platform/tauri/platform";
import { attachGpuRenderer } from "../model/gpuRenderer";
import "@xterm/xterm/css/xterm.css";
import { hasTerminalSpawned, isTerminalStarted, isTerminalWanted, markTerminalExited, requestTerminalStart, retryTerminalStart, startTerminal, subscribeTerminalLifecycle, terminalExitCode } from "../../sessions/model/terminalLifecycle";
import { TYPOGRAPHY_CHANGE_EVENT, loadTerminalFontSize } from "../../settings/model/appearance";

type Props = {
  id: string;
  cwd: string;
  active: boolean;
  onMetaChange?: (patch: TerminalMetaPatch) => void;
};

/**
 * A same-id view must wait for a prior teardown before it attaches or spawns.
 * Cleanup only kills when the lifecycle no longer wants the terminal, so
 * ordinary remounts reattach to the existing shell.
 */
const stoppingPtys = new Map<string, Promise<void>>();

function cssColor(expr: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = expr;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || fallback;
}

function cssHexColor(expr: string, fallback: string): string {
  const color = cssColor(expr, fallback);
  if (/^#[\da-f]{6}$/i.test(color)) return color;
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return fallback;
  }
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const ANSI_DARK = {
  black: "#1d2428",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e8eef2",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};

// One-Light-family palette tuned for a near-white canvas.
const ANSI_LIGHT = {
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#4078f2",
  magenta: "#a626a4",
  cyan: "#0184bc",
  white: "#fafafa",
  brightBlack: "#7c8591",
  brightRed: "#df6b60",
  brightGreen: "#68b567",
  brightYellow: "#d19a2f",
  brightBlue: "#5c89f5",
  brightMagenta: "#b54bb3",
  brightCyan: "#1f9cc9",
  brightWhite: "#ffffff",
};

function terminalTheme(light: boolean) {
  return {
    background: "#00000000",
    foreground: cssColor("var(--color-content)", light ? "#2e2e2e" : "#e8eef2"),
    cursor: cssColor("var(--color-accent)", light ? "#4078f2" : "#4da3f5"),
    cursorAccent: light ? "#ffffff" : "#000000",
    selectionBackground: light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.18)",
    selectionInactiveBackground: light
      ? "rgba(0,0,0,0.08)"
      : "rgba(255,255,255,0.08)",
    ...(light ? ANSI_LIGHT : ANSI_DARK),
  };
}

function terminalFont(): string {
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-terminal")
    .trim();
  return fromCss || "ui-monospace, Cascadia Mono, Consolas, monospace";
}

function oscColors() {
  const light = isLightScheme();
  return {
    fg: cssHexColor(
      "var(--color-content)",
      light ? "#2e2e2e" : "#ebebeb",
    ),
    bg: cssHexColor(
      "var(--color-background-base)",
      light ? "#f7f7f7" : "#171717",
    ),
    cursor: cssHexColor(
      "var(--color-accent)",
      light ? "#4078f2" : "#4da3f5",
    ),
  };
}

export function TerminalView({ id, cwd, active, onMetaChange }: Props) {
  const started = useSyncExternalStore(
    subscribeTerminalLifecycle,
    () => isTerminalStarted(id),
    () => false,
  );
  if (!started) {
    return <DormantTerminalView id={id} cwd={cwd} />;
  }
  return (
    <LiveTerminalView
      id={id}
      cwd={cwd}
      active={active}
      onMetaChange={onMetaChange}
    />
  );
}

function DormantTerminalView({ id, cwd }: { id: string; cwd: string }) {
  const title = defaultTerminalTitle(cwd);
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-center gap-1.5 p-6 text-center">
      <p className="text-[13px] font-medium text-content">{title}</p>
      <p className="max-w-60 text-[12px] leading-relaxed text-content/50">
        This terminal hasn&apos;t started yet. Nothing is running.
      </p>
      <button
        type="button"
        onClick={() => startTerminal(id)}
        aria-label={`Start Terminal in ${title}`}
        className="mt-1 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Start Terminal
      </button>
    </div>
  );
}

function LiveTerminalView({ id, cwd, active, onMetaChange }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const restartRef = useRef<() => void>(() => {});
  const [exitCode, setExitCode] = useState<number | null | undefined>(() =>
    terminalExitCode(id),
  );
  const exited = exitCode !== undefined;
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const spawned = useRef(false);
  /**
   * Permanent failure: on Windows there is no PTY runtime, so every spawn
   * attempt fails identically. Without this latch, each failed attempt
   * prints an error line, whose render re-triggers `applySize` via
   * `onRender`, which spawns again — an infinite spawn-fail-render loop
   * that pegs the UI. Unix keeps the old retry-on-render behavior.
   */
  const dead = useRef(!PTY_SUPPORTED);
  const applySizeRef = useRef<() => void>(() => {});
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const runningProcessRef = useRef<string | null>(null);
  /** Absolute offset of the last byte written into this terminal view. */
  const syncedRef = useRef(0);
  const currentAttemptRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const outer = outerRef.current;
    const host = hostRef.current;
    if (!outer || !host) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: terminalFont(),
      fontSize: loadTerminalFontSize(),
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      allowTransparency: true,
      smoothScrollDuration: 0,
      theme: terminalTheme(isLightScheme()),
      macOptionIsMeta: IS_MAC,
    });
    term.open(host);
    const detachGpuRenderer = attachGpuRenderer(term, host);
    termRef.current = term;
    let closed = false;
    if (dead.current && markUnsupportedNotified(id)) {
      // Unsupported platform: explain once per terminal per launch, never
      // invoke the backend. (Component remounts from tab switches or layout
      // restores must not reprint it.)
      term.writeln(`\x1b[31m${PTY_UNSUPPORTED_MESSAGE}\x1b[0m`);
    }

    const onCopy = (event: ClipboardEvent) => {
      const text = term.getSelection();
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      term.paste(text);
    };
    host.addEventListener("copy", onCopy);
    host.addEventListener("paste", onPaste);

    term.attachCustomKeyEventHandler((event) => {
      const shortcutData = IS_MAC ? macTerminalShortcutData(event) : null;
      if (shortcutData) {
        if (event.type === "keydown") {
          event.preventDefault();
          event.stopPropagation();
          term.input(shortcutData);
        }
        return false;
      }
      if (IS_MAC && isMacTerminalClearShortcut(event)) {
        if (event.isComposing) return false;
        if (event.type === "keydown") {
          event.preventDefault();
          term.clear();
        }
        return false;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return true;
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (term.hasSelection()) return false;
        if (event.metaKey && !event.ctrlKey) return false;
        return true;
      }
      if (key === "v") return false;
      return true;
    });

    let oscBuffer = "";

    let unsubscribe = () => {};
    const start = (): Promise<void> => {
      if (closed) return Promise.resolve();
      unsubscribe = subscribePty(
        id,
        (data, start) => {
          if (closed) return;
          const onMeta = onMetaChangeRef.current;
          if (onMeta) {
            const text = new TextDecoder().decode(data);
            const scanned = scanOscCwd(text, oscBuffer);
            oscBuffer = scanned.rest;
            if (scanned.cwd) {
              const patch: TerminalMetaPatch = { cwd: scanned.cwd };
              if (!runningProcessRef.current) {
                patch.title = defaultTerminalTitle(scanned.cwd);
              }
              onMeta(patch);
            }
          }
          syncedRef.current = Math.max(syncedRef.current, start + data.length);
          term.write(data);
        },
        (code) => {
          if (closed) return;
          const status = code == null ? "" : ` (${code})`;
          setExitCode(code);
          markTerminalExited(id, code);
          term.writeln(`\r\n[process exited${status}]`);
        },
      );
      if (hasTerminalSpawned(id)) spawned.current = true;
      return requestTerminalStart(id, () =>
        spawnPty(id, cwd, term.cols, term.rows),
      );
    };

    // Deferred first spawn: restored terminals mount dormant and never reach
    // here until the user starts them. Concurrent mounts (Strict Mode
    // setup/cleanup/setup, repeated Start) share one spawn promise; a
    // remount after a successful spawn only reattaches and resyncs output.
    // A terminal that was explicitly closed waits for its prior kill to finish
    // before the replacement view subscribes or starts the same id again.
    const previousStop = stoppingPtys.get(id);
    const starting = previousStop ? previousStop.then(start) : start();
    currentAttemptRef.current = starting;
    starting
      .then(() => {
        if (closed) return;
        spawned.current = true;
        setSpawnError(null);
      })
      .catch((error) => {
        spawned.current = false;
        if (!closed) {
          const message =
            error instanceof Error ? error.message : String(error);
          setSpawnError(message);
          term.writeln(`\x1b[31m${message}\x1b[0m`);
        }
      });
    void starting.catch(() => undefined);

    restartRef.current = () => {
      if (closed || dead.current) return;
      setExitCode(undefined);
      setSpawnError(null);
      term.clear();
      syncedRef.current = 0;
      spawned.current = false;
      const next = retryTerminalStart(id, () =>
        spawnPty(id, cwdRef.current, term.cols, term.rows),
      );
      currentAttemptRef.current = next;
      void next
        .then(() => {
          if (closed) return;
          spawned.current = true;
        })
        .catch((error) => {
          spawned.current = false;
          if (!closed) {
            const message =
              error instanceof Error ? error.message : String(error);
            setSpawnError(message);
            term.writeln(`\x1b[31m${message}\x1b[0m`);
          }
        });
      void next.catch(() => undefined);
    };

    const dataSub = term.onData((data) => {
      if (dead.current) return;
      void currentAttemptRef.current
        .then(() => (closed || dead.current ? undefined : writePty(id, data)))
        .catch(() => undefined);
    });

    // WebView2 can stall event delivery for a window sitting behind others
    // (the PTY keeps running; `pty-data` resumes only on activation). Pull
    // anything missed straight from the backend on focus/visibility.
    let resyncInFlight = false;
    const resyncOutput = () => {
      if (closed || dead.current || !spawned.current || resyncInFlight) return;
      resyncInFlight = true;
      const from = syncedRef.current;
      ptyReplayFrom(id, from)
        .then(({ start, data }) => {
          if (closed || data.length === 0) return;
          const overlap = Math.max(0, syncedRef.current - start);
          if (data.length <= overlap) return;
          const fresh = data.slice(overlap);
          term.write(fresh);
          syncedRef.current = start + data.length;
        })
        .catch(() => undefined)
        .finally(() => {
          resyncInFlight = false;
        });
    };
    const onWindowFocus = () => resyncOutput();
    const onVisibility = () => {
      if (document.visibilityState === "visible") resyncOutput();
    };
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const replyOsc = (code: 10 | 11 | 12, hex: string) => {
      const reply = oscColorReply(code, hex);
      if (reply) {
        void currentAttemptRef.current
          .then(() => (closed ? undefined : writePty(id, reply)))
          .catch(() => undefined);
      }
      return true;
    };
    const oscFg = term.parser.registerOscHandler(10, (data) =>
      isOscColorQuery(data) ? replyOsc(10, oscColors().fg) : false,
    );
    const oscBg = term.parser.registerOscHandler(11, (data) =>
      isOscColorQuery(data) ? replyOsc(11, oscColors().bg) : false,
    );
    const oscCursor = term.parser.registerOscHandler(12, (data) =>
      isOscColorQuery(data) ? replyOsc(12, oscColors().cursor) : false,
    );

    const onSchemeChange = () => {
      term.options.theme = terminalTheme(isLightScheme());
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);

    term.attachCustomWheelEventHandler(() => {
      if (term.element?.classList.contains("enable-mouse-events")) return true;
      return term.buffer.active.type !== "alternate";
    });

    let lastCols = 0;
    let lastRows = 0;
    let raf = 0;
    let tuiMode = false;

    const fitMode = (): TerminalFitMode =>
      term.buffer.active.type === "alternate" ? "tui" : "shell";

    const syncAltScreenMode = () => {
      const next = fitMode() === "tui";
      if (next === tuiMode) return;
      tuiMode = next;
      applyTerminalChrome(term, outer, next);
      if (!next) resetGridStretch(term);
      lastCols = 0;
      lastRows = 0;
      schedule();
    };

    const applySize = () => {
      if (closed || dead.current) return;
      const next = fitTerminal(term, host, fitMode());
      if (!next) return;
      const { cols, rows } = next;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      void currentAttemptRef.current
        .then(() => (closed || dead.current ? undefined : resizePty(id, cols, rows)))
        .catch(() => {
          lastCols = 0;
          lastRows = 0;
        });
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applySize();
      });
    };

    const onTypographyChange = () => {
      term.options.fontFamily = terminalFont();
      term.options.fontSize = loadTerminalFontSize();
      lastCols = 0;
      lastRows = 0;
      schedule();
    };
    window.addEventListener(TYPOGRAPHY_CHANGE_EVENT, onTypographyChange);

    applySizeRef.current = applySize;
    const renderSub = term.onRender(() => {
      if (!spawned.current) applySize();
    });
    const bufferSub = term.buffer.onBufferChange(syncAltScreenMode);
    syncAltScreenMode();
    const frame = requestAnimationFrame(applySize);
    const observer = new ResizeObserver(schedule);
    observer.observe(host);

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      outer.classList.remove("monocode-terminal--alt-screen");
      applySizeRef.current = () => {};
      host.removeEventListener("copy", onCopy);
      host.removeEventListener("paste", onPaste);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
      window.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, onTypographyChange);
      dataSub.dispose();
      oscFg.dispose();
      oscBg.dispose();
      oscCursor.dispose();
      renderSub.dispose();
      bufferSub.dispose();
      unsubscribe();
      restartRef.current = () => {};
      // Hiding, switching tabs/projects, or blur never unmounts a started
      // terminal, so this runs on real close (or a Strict Mode remount that
      // still wants the session). Only kill when nobody wants the id: that
      // keeps a shared pending spawn alive across remounts while still
      // cleaning up a child whose close landed mid-spawn.
      const shouldKill = !isTerminalWanted(id);
      const stopping = currentAttemptRef.current
        .catch(() => undefined)
        .then(() => (shouldKill ? killPty(id) : undefined))
        .finally(() => {
          if (stoppingPtys.get(id) === stopping) stoppingPtys.delete(id);
        });
      stoppingPtys.set(id, stopping);
      detachGpuRenderer();
      term.dispose();
      termRef.current = null;
      spawned.current = false;
      syncedRef.current = 0;
    };
  }, [id]);

  // Identity-stable: the callers pass an inline arrow, so depending on the
  // prop itself would tear down and re-arm the poll — and re-fork `ps` — on
  // every parent render.
  const wantsMeta = !!onMetaChange;

  useEffect(() => {
    if (!wantsMeta || !PTY_SUPPORTED) return;
    let lastForeground: string | null = null;
    let inFlight = false;
    const refresh = () => {
      if (!spawned.current) return;
      // Each status read forks `ps`; an off-screen window has no title to paint.
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      void getPtyStatus(id)
        .then(({ foreground }) => {
          const fg = foreground?.trim() || null;
          runningProcessRef.current = fg;
          if (fg === lastForeground) return;
          lastForeground = fg;
          onMetaChangeRef.current?.(
            fg
              ? { title: fg, foreground: fg }
              : { title: defaultTerminalTitle(cwd), foreground: null },
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    refresh();
    const interval = setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, cwd, wantsMeta]);

  useEffect(() => {
    if (!active) return;
    applySizeRef.current();
    termRef.current?.focus();
  }, [active]);

  const statusMessage = exited
    ? `Process exited${exitCode == null ? "" : ` (${exitCode})`}.`
    : spawnError;
  return (
    <div
      ref={outerRef}
      className="monocode-terminal flex h-full w-full min-h-0 min-w-0 flex-col"
      onMouseDown={() => termRef.current?.focus()}
    >
      {statusMessage ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-content/10 bg-content/5 px-3 py-1.5 text-[12px] text-content/70"
        >
          <span className="min-w-0 flex-1 truncate">{statusMessage}</span>
          <button
            type="button"
            onClick={() => restartRef.current()}
            aria-label={exited ? "Restart terminal" : "Retry starting terminal"}
            className="shrink-0 rounded-md bg-content px-2 py-0.5 text-[11px] font-medium text-background-base hover:bg-content/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {exited ? "Restart" : "Retry"}
          </button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="monocode-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden"
      />
    </div>
  );
}
