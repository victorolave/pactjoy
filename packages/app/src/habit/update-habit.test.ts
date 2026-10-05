import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createHabit } from "./create-habit.ts";
import { listMyHabits } from "./list-my-habits.query.ts";
import { updateHabit } from "./update-habit.ts";

const ANDREA = { userId: userId("user-andrea") };
const VICTOR = { userId: userId("user-victor") };

async function seed() {
  const app = createTestApp();
  const created = await createHabit(app, ANDREA, { name: "Leer", why: "Calma", icon: "book" });
  if (!created.ok) throw new Error("seed failed");
  return { app, habit: created.value };
}

describe("createHabit icon", () => {
  it("stores a valid icon and null when omitted", async () => {
    const app = createTestApp();
    const withIcon = await createHabit(app, ANDREA, { name: "Leer", icon: "book-open" });
    const without = await createHabit(app, ANDREA, { name: "Correr" });
    expect(withIcon.ok && withIcon.value.icon).toBe("book-open");
    expect(without.ok && without.value.icon).toBeNull();
  });

  it.each(["Book", "1book", "book icon", "", "a".repeat(33), "libro_"])(
    "rejects the malformed key %j with InvalidIcon",
    async (icon) => {
      const result = await createHabit(createTestApp(), ANDREA, { name: "Leer", icon });
      expect(result).toEqual({ ok: false, error: { kind: "InvalidIcon" } });
    },
  );

  it("accepts a key of exactly 32 characters", async () => {
    const result = await createHabit(createTestApp(), ANDREA, {
      name: "Leer",
      icon: "a".repeat(32),
    });
    expect(result.ok).toBe(true);
  });
});

describe("updateHabit", () => {
  it("edits the owner's habit and bumps the version", async () => {
    const { app, habit } = await seed();
    const result = await updateHabit(app, ANDREA, {
      habitId: habit.id,
      expectedVersion: 0,
      name: "Leer más",
      icon: "star",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      name: "Leer más",
      icon: "star",
      why: "Calma",
      version: 1,
    });
  });

  it("a partial body leaves absent fields alone and null clears optional ones", async () => {
    const { app, habit } = await seed();
    const result = await updateHabit(app, ANDREA, {
      habitId: habit.id,
      expectedVersion: 0,
      why: null,
      icon: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ name: "Leer", why: null, icon: null });
  });

  it("another user's habit is HabitNotFound, same as an unknown id", async () => {
    const { app, habit } = await seed();
    const other = await updateHabit(app, VICTOR, { habitId: habit.id, expectedVersion: 0 });
    expect(other).toEqual({ ok: false, error: { kind: "HabitNotFound" } });
  });

  it("a stale expectedVersion raises ConcurrencyConflict and changes nothing", async () => {
    const { app, habit } = await seed();
    await updateHabit(app, ANDREA, { habitId: habit.id, expectedVersion: 0, name: "Uno" });
    await expect(
      updateHabit(app, ANDREA, { habitId: habit.id, expectedVersion: 0, name: "Dos" }),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect((await listMyHabits(app, ANDREA))[0]?.name).toBe("Uno");
  });

  it("validates the merged fields (malformed icon, blank name)", async () => {
    const { app, habit } = await seed();
    expect(
      await updateHabit(app, ANDREA, { habitId: habit.id, expectedVersion: 0, icon: "Bad Key" }),
    ).toEqual({ ok: false, error: { kind: "InvalidIcon" } });
    expect(
      await updateHabit(app, ANDREA, { habitId: habit.id, expectedVersion: 0, name: " " }),
    ).toEqual({ ok: false, error: { kind: "InvalidName" } });
  });
});

describe("listMyHabits", () => {
  it("returns only the caller's habits and [] when none", async () => {
    const app = createTestApp();
    expect(await listMyHabits(app, ANDREA)).toEqual([]);
    await createHabit(app, ANDREA, { name: "Leer" });
    await createHabit(app, VICTOR, { name: "Ajeno" });
    expect((await listMyHabits(app, ANDREA)).map((h) => h.name)).toEqual(["Leer"]);
  });
});
