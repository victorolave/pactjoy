import { describe, expect, it } from "vitest";
import { habitId, userId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { buildHabit } from "./habit.ts";

const NOW = instant(1_700_000_000_000);

describe("buildHabit", () => {
  it("SS-1: creates a habit with a name only, leaving why/category empty", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "Correr",
      now: NOW,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: "habit-1",
        ownerId: "user-andrea",
        name: "Correr",
        why: null,
        category: null,
        createdAt: NOW,
        version: 0,
      },
    });
  });

  it("accepts an optional why and category as free text (P2-4)", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "Correr",
      why: "Sentirme con más energía",
      category: "Salud",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.why).toBe("Sentirme con más energía");
    expect(result.value.category).toBe("Salud");
  });

  it("SS-2: rejects an empty (or whitespace-only) name", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "   ",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
  });

  it("rejects a category longer than 60 characters (P2-4, reasonable length -- no exact spec bound)", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "Correr",
      category: "x".repeat(61),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: { kind: "CategoryTooLong" } });
  });

  it("accepts a category of exactly 60 characters", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "Correr",
      category: "x".repeat(60),
      now: NOW,
    });

    expect(result.ok).toBe(true);
  });

  it("trims whitespace-only why/category down to null", () => {
    const result = buildHabit({
      id: habitId("habit-1"),
      ownerId: userId("user-andrea"),
      name: "Correr",
      why: "   ",
      category: "   ",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.why).toBeNull();
    expect(result.value.category).toBeNull();
  });
});
