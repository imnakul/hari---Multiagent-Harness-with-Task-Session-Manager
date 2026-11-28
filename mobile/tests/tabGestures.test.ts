import { describe, expect, it } from "vitest";

import {
  arcOffset,
  arcPlacement,
  cancelsSlide,
  crossings,
  indexAt,
  ringCopies,
  scrubPosition,
  wrapIndex,
} from "@/features/tabs/tabMath";
import { entranceSide } from "@/features/tabs/tabTransition";

describe("tab bar slide (AC-6, 7)", () => {
  it("finds the tab under the finger and clamps to the ends", () => {
    expect(indexAt(0, 500, 5)).toBe(0);
    expect(indexAt(499, 500, 5)).toBe(4);
    expect(indexAt(250, 500, 5)).toBe(2);
    expect(indexAt(-30, 500, 5)).toBe(0);
    expect(indexAt(900, 500, 5)).toBe(4);
    expect(indexAt(10, 0, 5)).toBe(0);
  });
  it("counts the boundaries crossed", () => {
    expect(crossings(0, 3)).toBe(3);
    expect(crossings(3, 1)).toBe(2);
    expect(crossings(2, 2)).toBe(0);
  });
  it("cancels past 40 pt vertically, either way", () => {
    expect(cancelsSlide(40)).toBe(false);
    expect(cancelsSlide(41)).toBe(true);
    expect(cancelsSlide(-41)).toBe(true);
  });
});

describe("arc scrub", () => {
  it("steps one circle per 44 pt, right to the next", () => {
    expect(scrubPosition(2, 0, 6)).toBe(2);
    expect(scrubPosition(2, 44, 6)).toBe(3);
    expect(scrubPosition(2, -88, 6)).toBe(0);
    expect(Math.round(scrubPosition(0, 70, 6))).toBe(2);
  });
  // L-416: the arc goes round instead of stopping at its ends.
  it("goes round past either end", () => {
    expect(wrapIndex(scrubPosition(0, -44, 3), 3)).toBe(2);
    expect(wrapIndex(scrubPosition(2, 44, 3), 3)).toBe(0);
    expect(wrapIndex(scrubPosition(1, 44 * 7, 3), 3)).toBe(2);
    expect(scrubPosition(0, 100, 0)).toBe(0);
    expect(wrapIndex(5, 0)).toBe(0);
  });
  it("places each circle the shorter way round", () => {
    expect(arcOffset(5, 0, 6)).toBe(-1);
    expect(arcOffset(1, 0, 6)).toBe(1);
    expect(arcOffset(0, 5, 6)).toBe(1);
    expect(arcOffset(3, 0, 6)).toBe(-3);
    expect(arcOffset(2, 1.5, 6)).toBeCloseTo(0.5);
  });
  it("repeats a few places so the far side stays out of view", () => {
    expect(ringCopies(1)).toBe(1);
    expect(ringCopies(2)).toBe(3);
    expect(ringCopies(4)).toBe(2);
    expect(ringCopies(6)).toBe(1);
  });
});

describe("arc placement", () => {
  it("lays circles out by their offset from the selected one", () => {
    expect(arcPlacement(0)).toEqual({ translateX: 0, translateY: 0, scale: 1, opacity: 1 });
    expect(arcPlacement(1)).toEqual({ translateX: 54, translateY: 7, scale: 0.86, opacity: 1 });
    expect(arcPlacement(-2).translateX).toBe(-108);
    expect(arcPlacement(-2).translateY).toBe(28);
    expect(arcPlacement(-2).opacity).toBe(1);
    expect(arcPlacement(2.3).opacity).toBeCloseTo(0.5);
    expect(arcPlacement(3).opacity).toBe(0);
    expect(arcPlacement(5).scale).toBeCloseTo(0.72);
    // Continuous, for a smooth drag: halfway between two circles is halfway in size.
    expect(arcPlacement(0.5).scale).toBeCloseTo(0.93);
  });
});

describe("tab entrance side", () => {
  it("comes in from the side it lies on the bar", () => {
    expect(entranceSide("running", "share")).toBe(1);
    expect(entranceSide("share", "sessions")).toBe(-1);
    expect(entranceSide("monos", "sessions")).toBe(1);
  });
  it("doesn't move for the same tab or the first one", () => {
    expect(entranceSide("sessions", "sessions")).toBe(0);
    expect(entranceSide("sessions", undefined)).toBe(0);
  });
});
