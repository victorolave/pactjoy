import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput } from "../testing/circle-inputs.ts";
import { createCircle } from "./create-circle.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("createCircle", () => {
  it("CM-1: creates a circle with the actor as its sole, active first member", async () => {
    const app = createTestApp();

    const result = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Río Runners"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Río Runners");
    expect(result.value.members).toHaveLength(1);
    expect(result.value.members[0]?.userId).toBe("user-andrea");
    expect(result.value.members[0]?.status).toBe("active");

    const stored = await app.uow.read((repos) => repos.circles.get(result.value.id));
    expect(stored?.name).toBe("Río Runners");
  });

  it("CM-2: rejects an empty name and persists nothing", async () => {
    const app = createTestApp();

    const result = await createCircle(app, actorFor("user-andrea"), createCircleInput("   "));

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
    expect(
      await app.uow.read((repos) => repos.circles.findActiveByUser(userId("user-andrea"))),
    ).toBeNull();
  });

  it("CM-16: stores the creator's display name, trimmed", async () => {
    const app = createTestApp();

    const result = await createCircle(app, actorFor("user-andrea"), {
      name: "Río Runners",
      displayName: "  Ana  ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members[0]?.displayName).toBe("Ana");
  });

  it("CM-17: rejects an invalid display name with InvalidDisplayName and persists nothing", async () => {
    const app = createTestApp();

    const result = await createCircle(app, actorFor("user-andrea"), {
      name: "Río Runners",
      displayName: "   ",
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidDisplayName" } });
    expect(
      await app.uow.read((repos) => repos.circles.findActiveByUser(userId("user-andrea"))),
    ).toBeNull();
  });

  it("CM-11: rejects creating a second circle while already an active member of one", async () => {
    const app = createTestApp();
    const first = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("First circle"),
    );
    expect(first.ok).toBe(true);

    const second = await createCircle(
      app,
      actorFor("user-andrea"),
      createCircleInput("Second circle"),
    );

    expect(second).toEqual({ ok: false, error: { kind: "AlreadyInActiveCircle" } });
  });
});
