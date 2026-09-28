import { describe, expect, it } from "vitest";
import type { Target } from "../commitment/commitment.ts";
import { fromInt } from "../fraction/fraction.ts";
import { isConsistent, progressOf } from "./progress.ts";

const reading: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };
const coffees: Target = { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) };

describe("progressOf — direction=reach", () => {
  it("gives zero progress when there is no entry", () => {
    expect(progressOf(reading, null)).toEqual({ num: 0n, den: 1n });
  });

  it("gives zero progress when the entry is below the minimum", () => {
    expect(progressOf(reading, fromInt(5))).toEqual({ num: 0n, den: 1n });
  });

  it("gives progress = minimum/ideal exactly at the minimum (threshold, not a flat base)", () => {
    expect(progressOf(reading, fromInt(10))).toEqual({ num: 1n, den: 3n });
  });

  it("caps progress at 1 for an entry beyond the ideal", () => {
    expect(progressOf(reading, fromInt(60))).toEqual({ num: 1n, den: 1n });
  });
});

describe("progressOf — direction=limit", () => {
  it("gives zero progress when there is no entry (D3)", () => {
    expect(progressOf(coffees, null)).toEqual({ num: 0n, den: 1n });
  });

  it("gives full progress for an entry at or below the ideal", () => {
    expect(progressOf(coffees, fromInt(0))).toEqual({ num: 1n, den: 1n });
    expect(progressOf(coffees, fromInt(2))).toEqual({ num: 1n, den: 1n });
  });

  it("gives progress linearly from 1 to 1/2 between ideal and tolerance", () => {
    expect(progressOf(coffees, fromInt(3))).toEqual({ num: 3n, den: 4n });
    expect(progressOf(coffees, fromInt(4))).toEqual({ num: 1n, den: 2n });
  });

  it("gives zero progress beyond the tolerance", () => {
    expect(progressOf(coffees, fromInt(5))).toEqual({ num: 0n, den: 1n });
  });

  it("evaluates by segment membership without dividing by zero when ideal equals tolerance", () => {
    const flat: Target = { direction: "limit", ideal: fromInt(2), tolerance: fromInt(2) };
    expect(progressOf(flat, fromInt(2))).toEqual({ num: 1n, den: 1n });
    expect(progressOf(flat, fromInt(3))).toEqual({ num: 0n, den: 1n });
  });
});

describe("isConsistent", () => {
  it("is false when there is no entry", () => {
    expect(isConsistent(reading, null)).toBe(false);
  });

  it("is false when a reach entry is below the minimum", () => {
    expect(isConsistent(reading, fromInt(5))).toBe(false);
  });

  it("is true when a reach entry is at or above the minimum", () => {
    expect(isConsistent(reading, fromInt(10))).toBe(true);
  });

  it("is true for a limit entry within tolerance, false beyond it", () => {
    expect(isConsistent(coffees, fromInt(4))).toBe(true);
    expect(isConsistent(coffees, fromInt(5))).toBe(false);
  });
});
