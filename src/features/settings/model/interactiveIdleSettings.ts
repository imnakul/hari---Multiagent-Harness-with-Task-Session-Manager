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
