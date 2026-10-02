import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput } from "../testing/circle-inputs.ts";
import { givenArchivedCircle } from "../testing/pact-fixtures.ts";
import { memberId } from "./circle.ts";
import { createCircle } from "./create-circle.ts";
import { renameCircle } from "./rename-circle.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("renameCircle", () => {
  it("CM-15: any member (not just the creator) may rename the circle -- no admin role (A4)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), createCircleInput("Original"));
    if (!created.ok) throw new Error("fixture setup failed");
    // A second member, not the creator, joined out-of-band for this test.
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          ...created.value,
          members: [
            ...created.value.members,
            {
              id: memberId("member-victor"),
              userId: userId("user-victor"),
              status: "active",
              joinedAt: app.clock.now(),
              leftAt: null,
            },
          ],
          version: created.value.version + 1,
        },
        created.value.version,
      );
      return { ok: true as const, value: undefined };
    });

    const result = await renameCircle(app, actorFor("user-victor"), {
      circleId: created.value.id,
      name: "Renamed by Victor",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Renamed by Victor");
  });

  it("CM-16 (B4): a solo (1-member) circle can rename itself -- no minimum-member guard", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), createCircleInput("Solo"));
    if (!created.ok) throw new Error("fixture setup failed");
    expect(created.value.members).toHaveLength(1);

    const result = await renameCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
      name: "Still Solo",
    });

    expect(result).toMatchObject({ ok: true, value: { name: "Still Solo" } });
  });

  it("rejects a non-member", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), createCircleInput("Original"));
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await renameCircle(app, actorFor("user-stranger"), {
      circleId: created.value.id,
      name: "Hijacked",
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("rejects an empty name", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), createCircleInput("Original"));
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await renameCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
      name: "  ",
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
  });

  it("rejects a name with a lone surrogate (storable text), leaving the circle untouched", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), createCircleInput("Original"));
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await renameCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
      name: "Los \uD83D",
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
    const nul = await renameCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
      name: "Los \u0000",
    });
    expect(nul).toEqual({ ok: false, error: { kind: "InvalidName" } });
    const emoji = await renameCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
      name: "Los 😀",
    });
    expect(emoji.ok).toBe(true);
  });

  it("rejects renaming an archived circle, leaving it untouched", async () => {
    const app = createTestApp();
    const { circle, andrea } = await givenArchivedCircle(app);

    const result = await renameCircle(app, andrea, { circleId: circle.id, name: "Back again" });

    expect(result).toEqual({ ok: false, error: { kind: "CircleArchived" } });
    expect(await app.circles.get(circle.id)).toEqual(circle);
  });
});
