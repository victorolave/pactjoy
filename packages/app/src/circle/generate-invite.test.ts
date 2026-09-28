import { describe, expect, it } from "vitest";
import type { RandomSource } from "../ports/random-source.ts";
import { InviteCodeGenerationFailed } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

/** Always draws alphabet index 0 -- `generateInviteCode` always returns "222222". */
const ALWAYS_COLLIDING_RANDOM: RandomSource = { int: () => 0 };

/** Draws "222222" for the first `collidingDraws` calls (6 `int()` calls each), then "333333" forever after. */
function collideThenSucceed(collidingDraws: number): RandomSource {
  let calls = 0;
  return {
    int(): number {
      calls += 1;
      return calls <= collidingDraws * 6 ? 0 : 1;
    },
  };
}

describe("generateInvite", () => {
  it("CM-3: generates a 6-char code from the safe alphabet, expiring 7 days later", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toHaveLength(6);
    expect(result.value.expiresAt).toBe(result.value.createdAt + 7 * 24 * 60 * 60 * 1000);

    const stored = await app.uow.read((repos) => repos.circles.get(created.value.id));
    expect(stored?.invite?.code).toBe(result.value.code);
  });

  it("CM-16 (B4): a solo (1-member) circle's own member can generate an invite", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Solo" });
    if (!created.ok) throw new Error("fixture setup failed");
    expect(created.value.members).toHaveLength(1);

    const result = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a non-member", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await generateInvite(app, actorFor("user-stranger"), {
      circleId: created.value.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("retries when the drawn code collides with another circle's active invite, and returns the non-colliding one", async () => {
    const app = createTestApp();
    const other = await createCircle(app, actorFor("user-other"), { name: "Other circle" });
    if (!other.ok) throw new Error("fixture setup failed");
    const otherInvite = await generateInvite(
      { uow: app.uow, clock: app.clock, random: { int: () => 0 } },
      actorFor("user-other"),
      { circleId: other.value.id },
    );
    if (!otherInvite.ok) throw new Error("fixture setup failed");
    expect(otherInvite.value.code).toBe("222222");

    const mine = await createCircle(app, actorFor("user-andrea"), { name: "Mine" });
    if (!mine.ok) throw new Error("fixture setup failed");

    const result = await generateInvite(
      { uow: app.uow, clock: app.clock, random: collideThenSucceed(1) },
      actorFor("user-andrea"),
      { circleId: mine.value.id },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.code).toBe("333333");
    expect(result.value.code).not.toBe(otherInvite.value.code);
  });

  it("throws InviteCodeGenerationFailed after 5 attempts all collide with another circle's active invite", async () => {
    const app = createTestApp();
    const other = await createCircle(app, actorFor("user-other"), { name: "Other circle" });
    if (!other.ok) throw new Error("fixture setup failed");
    const otherInvite = await generateInvite(
      { uow: app.uow, clock: app.clock, random: ALWAYS_COLLIDING_RANDOM },
      actorFor("user-other"),
      { circleId: other.value.id },
    );
    if (!otherInvite.ok) throw new Error("fixture setup failed");

    const mine = await createCircle(app, actorFor("user-andrea"), { name: "Mine" });
    if (!mine.ok) throw new Error("fixture setup failed");

    await expect(
      generateInvite(
        { uow: app.uow, clock: app.clock, random: ALWAYS_COLLIDING_RANDOM },
        actorFor("user-andrea"),
        { circleId: mine.value.id },
      ),
    ).rejects.toThrow(InviteCodeGenerationFailed);
  });

  it("does not treat a circle's own current code as a collision with itself (regenerating with the same draw)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Mine" });
    if (!created.ok) throw new Error("fixture setup failed");
    const first = await generateInvite(
      { uow: app.uow, clock: app.clock, random: ALWAYS_COLLIDING_RANDOM },
      actorFor("user-andrea"),
      { circleId: created.value.id },
    );
    if (!first.ok) throw new Error("fixture setup failed");
    expect(first.value.code).toBe("222222");

    const second = await generateInvite(
      { uow: app.uow, clock: app.clock, random: ALWAYS_COLLIDING_RANDOM },
      actorFor("user-andrea"),
      { circleId: created.value.id },
    );

    expect(second).toEqual({ ok: true, value: expect.objectContaining({ code: "222222" }) });
  });
});
