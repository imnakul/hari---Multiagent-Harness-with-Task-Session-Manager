import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Moon } from "../../shared/ui/icons";
import { idlePhase } from "./idleHibernateModel";

/**
 * Fork (Hari, L-292): "Hibernate when idle". Armed from the bottom bar or the
 * phone's Control tab (one flag in Rust). Once no chat has worked for two
 * minutes, a 30-second notice counts down, then the computer hibernates.
 * One-shot: it disarms itself before hibernating.
 */

const EVENT = "monocode-idle-hibernate";
/** Only inside the desktop app (tests and the browser build have no Tauri). */
const isTauri = (): boolean => typeof window !== "undefined" && Reflect.has(window, "__TAURI_INTERNALS__");
let armed = false;
const listeners = new Set<() => void>();
let started = false;

function setArmed(next: boolean) {
  if (armed === next) return;
  armed = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started || !isTauri()) return;
  started = true;
  void invoke<boolean>("idle_hibernate_get").then(setArmed).catch(() => {});
  void listen<boolean>(EVENT, (event) => setArmed(event.payload === true));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useArmed() {
  return useSyncExternalStore(subscribe, () => armed, () => false);
}

function toggle(next: boolean) {
  setArmed(next);
  void invoke("idle_hibernate_set", { armed: next }).catch(() => setArmed(!next));
}

/** The bottom-bar switch. */
export function IdleHibernateButton({ inset = false }: { inset?: boolean }) {
  const on = useArmed();
  if (!isTauri()) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      title={
        on
          ? "Hibernate when idle is on: the computer hibernates once no chat has worked for 2 minutes. Click to turn off."
          : "Hibernate when idle: hibernate once no chat has worked for 2 minutes"
      }
      onClick={() => toggle(!on)}
      className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap hover:bg-content/10 ${
        inset ? "rounded-full px-2" : "rounded-md px-1.5"
      } ${on ? "bg-accent/15 text-accent" : ""}`}
    >
      <Moon className="size-3.5" />
      {on ? <span>Hibernate when idle</span> : null}
    </button>
  );
}

/** Always mounted: watches the chats while armed and shows the countdown. */
export function IdleHibernateWatcher({ busy }: { busy: boolean }) {
  const on = useArmed();
  const [idleSince, setIdleSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setIdleSince(on && !busy ? Date.now() : null);
  }, [on, busy]);

  useEffect(() => {
    if (idleSince == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [idleSince]);

  const phase = idlePhase(idleSince, now);

  useEffect(() => {
    if (phase.kind !== "now") return;
    setIdleSince(null);
    void invoke("idle_hibernate_now").catch(() => {});
  }, [phase.kind]);

  if (phase.kind !== "notice") return null;
  return createPortal(
    <div
      role="alert"
      className="fixed bottom-12 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-stroke bg-surface px-4 py-2.5 text-[13px] text-content shadow-lg"
    >
      <Moon className="size-4 text-accent" />
      <span>
        No chat is working. Hibernating in {phase.seconds} s.
      </span>
      <button
        type="button"
        className="rounded-md px-2 py-1 font-medium text-accent hover:bg-accent/10"
        onClick={() => toggle(false)}
      >
        Cancel
      </button>
    </div>,
    document.body,
  );
}
