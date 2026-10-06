import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createHabit } from "./create-habit.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("createHabit icon", () => {
  it("stores a valid icon and null when omitted", async () => {
    const app = createTestApp();
    const withIcon = await createHabit(app, actorFor("user-andrea"), {
      name: "Leer",
      icon: "book-open",
    });
    const without = await createHabit(app, actorFor("user-andrea"), { name: "Correr" });
    expect(withIcon.ok && withIcon.value.icon).toBe("book-open");
    expect(without.ok && without.value.icon).toBeNull();
  });

  it.each(["Book", "1book", "book icon", "", "a".repeat(33), "libro_"])(
    "rejects the malformed key %j with InvalidIcon",
    async (icon) => {
      const result = await createHabit(createTestApp(), actorFor("user-andrea"), {
        name: "Leer",
        icon,
      });
      expect(result).toEqual({ ok: false, error: { kind: "InvalidIcon" } });
    },
  );

  it("accepts a key of exactly 32 characters", async () => {
    const result = await createHabit(createTestApp(), actorFor("user-andrea"), {
      name: "Leer",
      icon: "a".repeat(32),
    });
    expect(result.ok).toBe(true);
  });
});

describe("createHabit", () => {
  it("SS-1: creates a habit owned by the actor, with name only", async () => {
    const app = createTestApp();

    const result = await createHabit(app, actorFor("user-andrea"), { name: "Correr" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ownerId).toBe("user-andrea");
    expect(result.value.name).toBe("Correr");
    expect(result.value.why).toBeNull();
    expect(result.value.category).toBeNull();

    const stored = await app.uow.read((repos) => repos.habits.get(result.value.id));
    expect(stored?.name).toBe("Correr");
  });

  it("accepts an optional why and category", async () => {
    const app = createTestApp();

    const result = await createHabit(app, actorFor("user-andrea"), {
      name: "Leer",
      why: "Aprender más",
      category: "Educación",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.why).toBe("Aprender más");
    expect(result.value.category).toBe("Educación");
  });

  it("SS-2: rejects an empty name and persists nothing", async () => {
    const app = createTestApp();

    const result = await createHabit(app, actorFor("user-andrea"), { name: "   " });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
  });

  it("a user may own more than one habit (habits are not capped like circle membership)", async () => {
    const app = createTestApp();

    const first = await createHabit(app, actorFor("user-andrea"), { name: "Correr" });
    const second = await createHabit(app, actorFor("user-andrea"), { name: "Leer" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).not.toBe(second.value.id);
  });
});
