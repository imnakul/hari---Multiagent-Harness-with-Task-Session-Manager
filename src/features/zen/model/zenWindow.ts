/**
 * Zen mode's window and saved choices (fork, L-230). The Rust side
 * (`zen_window.rs`) moves the window; this keeps what it needs between runs.
 */
import { invoke } from "@tauri-apps/api/core";
import { clampZenSplit } from "./zenPanes";

/** A window's outer box, in physical px. */
export type ZenBounds = { x: number; y: number; width: number; height: number };

/** What leaving Zen puts back. */
export type ZenRestore = { bounds: ZenBounds; maximized: boolean };

const BOUNDS_KEY = "monocode.zenBounds.v1";
const PINNED_KEY = "monocode.zenPinned.v1";
const SPLIT_KEY = "monocode.zenSplit.v1";
const RESTORE_KEY = "monocode.zenRestore.v1:";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice holds until the window closes.
  }
}

function isBounds(value: unknown): value is ZenBounds {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return (
    Number.isInteger(box.x) &&
    Number.isInteger(box.y) &&
    Number.isInteger(box.width) &&
    Number.isInteger(box.height) &&
    (box.width as number) > 0 &&
    (box.height as number) > 0
  );
}

export function parseZenBounds(raw: string | null): ZenBounds | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isBounds(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseZenRestore(raw: string | null): ZenRestore | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (!isBounds(record.bounds) || typeof record.maximized !== "boolean")
      return null;
    return { bounds: record.bounds, maximized: record.maximized };
  } catch {
    return null;
  }
}

/** Where the Zen panel last was, when the user moved or sized it. */
export function loadZenBounds(): ZenBounds | null {
  return parseZenBounds(read(BOUNDS_KEY));
}

export function saveZenBounds(bounds: ZenBounds): void {
  write(BOUNDS_KEY, JSON.stringify(bounds));
}

export function loadZenPinned(): boolean {
  return read(PINNED_KEY) === "1";
}

export function saveZenPinned(on: boolean): void {
  write(PINNED_KEY, on ? "1" : "0");
}

/** Splits that keep their own size: two chats, or a tool's list and item. */
export type ZenSplitName = "chats" | "tool";

/** The top half's share of a Zen split. */
export function loadZenSplit(name: ZenSplitName): number {
  const raw = read(`${SPLIT_KEY}:${name}`);
  return raw === null ? 0.5 : clampZenSplit(Number(raw));
}

export function saveZenSplit(name: ZenSplitName, value: number): void {
  write(`${SPLIT_KEY}:${name}`, String(clampZenSplit(value)));
}

/**
 * The size before Zen, kept while Zen is on. The window-state plugin saves
 * the narrow panel if the app closes in Zen, so the next start puts this back.
 */
export function loadZenRestore(label: string): ZenRestore | null {
  return parseZenRestore(read(RESTORE_KEY + label));
}

export function saveZenRestore(label: string, restore: ZenRestore | null): void {
  write(RESTORE_KEY + label, restore ? JSON.stringify(restore) : null);
}

export function zenWindowEnter(
  remembered: ZenBounds | null,
  smooth: boolean,
): Promise<ZenRestore> {
  return invoke<ZenRestore>("zen_window_enter", { remembered, smooth });
}

export function zenWindowExit(
  restore: ZenRestore,
  smooth: boolean,
): Promise<ZenBounds> {
  return invoke<ZenBounds>("zen_window_exit", { restore, smooth });
}

export function zenWindowPin(on: boolean): Promise<void> {
  return invoke<void>("zen_window_pin", { on });
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
