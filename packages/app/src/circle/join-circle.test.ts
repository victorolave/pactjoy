import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { memberFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { memberId } from "./circle.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { inviteCode } from "./invite-code.ts";
import { joinCircle } from "./join-circle.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("joinCircle", () => {
  it("CM-7/CM-8 (reinterpreted, B1): joining is allowed while there is no season yet (default gate)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");

    const result = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members.map((m) => m.userId)).toEqual(["user-andrea", "user-victor"]);
  });

  it("CM-7/CM-8 (reinterpreted, B1): joining is allowed while the season's pact is still open", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    app.seasonGate.setStatus(created.value.id, "pactOpen");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");

    const result = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });

    expect(result.ok).toBe(true);
  });

  it("CM-9 (B11): rejects joining while a season is active (pact closed, mid-season)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    app.seasonGate.setStatus(created.value.id, "active");

    const result = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotJoinable" } });
  });

  it("B11: allows joining between seasons -- the circle's last season is closed", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    app.seasonGate.setStatus(created.value.id, "closed");

    const result = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });

    expect(result.ok).toBe(true);
  });

  it("CM-4: rejects an expired invite code", async () => {
    const app = createTestApp({ now: instant(1_700_000_000_000) });
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const circle = {
      ...created.value,
      invite: {
        code: inviteCode("AB23CD"),
        createdAt: instant(1_699_000_000_000),
        expiresAt: instant(1_699_100_000_000),
        createdBy: memberId("member-1"),
      },
      version: created.value.version + 1,
    };
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(circle, created.value.version);
      return ok(undefined);
    });

    const result = await joinCircle(app, actorFor("user-victor"), { inviteCode: "AB23CD" });

    expect(result).toEqual({ ok: false, error: { kind: "InviteExpired" } });
  });

  it("CM-5: an invalidated (regenerated) code is rejected; the new code works", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const first = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!first.ok) throw new Error("fixture setup failed");
    const second = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!second.ok) throw new Error("fixture setup failed");
    expect(second.value.code).not.toBe(first.value.code);

    const withOldCode = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: first.value.code,
    });
    expect(withOldCode).toEqual({ ok: false, error: { kind: "InviteNotFound" } });

    const withNewCode = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: second.value.code,
    });
    expect(withNewCode.ok).toBe(true);
  });

  it("CM-10: rejects a 7th member when the circle already has 6 active members", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-0"), { name: "Full circle" });
    if (!created.ok) throw new Error("fixture setup failed");
    const extraMembers = Array.from({ length: 5 }, (_, i) =>
      memberFixture({ id: memberId(`member-extra-${i}`), userId: userId(`user-${i + 1}`) }),
    );
    const circle = {
      ...created.value,
      members: [...created.value.members, ...extraMembers],
      invite: {
        code: inviteCode("FU11CC"),
        createdAt: app.clock.now(),
        expiresAt: instant(app.clock.now() + 1),
        createdBy: memberId("member-0"),
      },
      version: created.value.version + 1,
    };
    expect(circle.members).toHaveLength(6);
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(circle, created.value.version);
      return ok(undefined);
    });

    const result = await joinCircle(app, actorFor("user-seventh"), { inviteCode: "FU11CC" });

    expect(result).toEqual({ ok: false, error: { kind: "CircleFull" } });
  });

  it("CM-11: rejects joining while already an active member of another circle", async () => {
    const app = createTestApp();
    const first = await createCircle(app, actorFor("user-andrea"), { name: "First" });
    if (!first.ok) throw new Error("fixture setup failed");
    const second = await createCircle(app, actorFor("user-victor"), { name: "Second" });
    if (!second.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-victor"), {
      circleId: second.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");

    const result = await joinCircle(app, actorFor("user-andrea"), {
      inviteCode: invite.value.code,
    });

    expect(result).toEqual({ ok: false, error: { kind: "AlreadyInActiveCircle" } });
  });

  it("rejects a code that never existed", async () => {
    const app = createTestApp();

    const result = await joinCircle(app, actorFor("user-victor"), { inviteCode: "ZZZZZZ" });

    expect(result).toEqual({ ok: false, error: { kind: "InviteNotFound" } });
  });

  it("D5: two concurrent joins racing the 6-member cap -- exactly one commits, the loser is rejected with ConcurrencyConflict, and the winner's write is not lost", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-0"), { name: "Almost full" });
    if (!created.ok) throw new Error("fixture setup failed");
    const extraMembers = Array.from({ length: 4 }, (_, i) =>
      memberFixture({ id: memberId(`member-extra-${i}`), userId: userId(`user-${i + 1}`) }),
    );
    const circle = {
      ...created.value,
      members: [...created.value.members, ...extraMembers],
      invite: {
        code: inviteCode("RACE01"),
        createdAt: app.clock.now(),
        expiresAt: instant(app.clock.now() + 1),
        createdBy: memberId("member-0"),
      },
      version: created.value.version + 1,
    };
    expect(circle.members).toHaveLength(5);
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(circle, created.value.version);
      return ok(undefined);
    });

    const [a, b] = await Promise.allSettled([
      joinCircle(app, actorFor("user-racer-a"), { inviteCode: "RACE01" }),
      joinCircle(app, actorFor("user-racer-b"), { inviteCode: "RACE01" }),
    ]);

    const settled = [a, b];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect(fulfilled[0]).toMatchObject({ value: { ok: true } });

    // The winner's write must survive the loser's rollback (ADR-0008, D5):
    // a failed transaction must not clobber a concurrent transaction's commit.
    const persisted = await app.circles.get(circle.id);
    expect(persisted?.members).toHaveLength(6);
  });
});
