export function loadInteractiveIdleMinutes(): number {
  try {
    const value = Number(
      localStorage.getItem("monocode.interactiveIdleMinutes") ?? "15",
    );
    return Number.isFinite(value)
      ? Math.min(60, Math.max(5, Math.round(value)))
      : 15;
  } catch {
    return 15;
  }
}
export function saveInteractiveIdleMinutes(value: number): void {
  if (!Number.isFinite(value)) return;
  try {
    localStorage.setItem(
      "monocode.interactiveIdleMinutes",
      String(Math.min(60, Math.max(5, Math.round(value)))),
    );
  } catch {
    /* unavailable storage */
  }
}

const FOLDER_TRUST_KEY = "monocode.interactiveFolderTrust";

/**
 * Whether Claude Interactive records the chat folder as trusted in Claude's
 * own config before launch (L-115), so the hidden terminal never stops at the
 * trust dialog. On by default, as in Orca.
 */
export function loadInteractiveFolderTrust(): boolean {
  try {
    return localStorage.getItem(FOLDER_TRUST_KEY) !== "false";
  } catch {
    return true;
  }
}
export function saveInteractiveFolderTrust(on: boolean): void {
  try {
    localStorage.setItem(FOLDER_TRUST_KEY, String(on));
  } catch {
    /* unavailable storage */
  }
}
