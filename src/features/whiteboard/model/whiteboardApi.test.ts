import { describe, expect, it, vi } from "vitest";
import { adoptWhenMounted, type ChangeSource } from "./whiteboardApi";

function editor(): ChangeSource & { emit: () => void } {
  const listeners = new Set<() => void>();
  return {
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => [...listeners].forEach((listener) => listener()),
  };
}

describe("adoptWhenMounted (L-392)", () => {
  it("adopts the editor that mounts, not one from a render React threw away", () => {
    const adopt = vi.fn();
    const live = editor();
    const discarded = editor();
    // The live editor is built first; a thrown-away render builds another after it.
    adoptWhenMounted(live, adopt);
    adoptWhenMounted(discarded, adopt);
    expect(adopt).not.toHaveBeenCalled();
    live.emit();
    expect(adopt).toHaveBeenCalledExactlyOnceWith(live);
    live.emit();
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it("refuses an editor whose sheet was left before it loaded", () => {
    const adopt = vi.fn();
    const late = editor();
    adoptWhenMounted(late, adopt, () => false);
    late.emit();
    expect(adopt).not.toHaveBeenCalled();
  });
});
