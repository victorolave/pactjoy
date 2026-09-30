import { describe, expect, it } from "vitest";
import { approvePact } from "../pact/approve-pact.ts";
import { circleId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { givenOpenPactWithOneApproval, givenSoloOpenPact } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { leaveCircle } from "./leave-circle.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

describe("leaveCircle", () => {
  it("CM-13: marks the member as left, freeing them up to join/create elsewhere (A5)", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    const joined = await joinCircle(app, actorFor("user-victor"), {
      inviteCode: invite.value.code,
    });
    if (!joined.ok) throw new Error("fixture setup failed");

    const result = await leaveCircle(app, actorFor("user-victor"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const victor = result.value.members.find((m) => m.userId === "user-victor");
    expect(victor?.status).toBe("left");
    expect(victor?.leftAt).toBe(app.clock.now());

    // CM-11 corollary: freed up to create/join a new circle elsewhere.
    const rejoined = await createCircle(app, actorFor("user-victor"), { name: "New circle" });
    expect(rejoined.ok).toBe(true);
  });

  it("keeps the remaining active member(s) unaffected", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    if (!invite.ok) throw new Error("fixture setup failed");
    await joinCircle(app, actorFor("user-victor"), { inviteCode: invite.value.code });

    const result = await leaveCircle(app, actorFor("user-victor"), {
      circleId: created.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const andrea = result.value.members.find((m) => m.userId === "user-andrea");
    expect(andrea?.status).toBe("active");
  });

  it("rejects a non-member", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");

    const result = await leaveCircle(app, actorFor("user-stranger"), {
      circleId: created.value.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("rejects an unknown circle", async () => {
    const app = createTestApp();

    const result = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: circleId("does-not-exist"),
    });

    expect(result).toEqual({ ok: false, error: { kind: "CircleNotFound" } });
  });

  it("rejects leaving twice", async () => {
    const app = createTestApp();
    const created = await createCircle(app, actorFor("user-andrea"), { name: "Río Runners" });
    if (!created.ok) throw new Error("fixture setup failed");
    const first = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });
    expect(first.ok).toBe(true);

    const second = await leaveCircle(app, actorFor("user-andrea"), {
      circleId: created.value.id,
    });

    expect(second).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  describe("archiving (2026-09-30 decision)", () => {
    const NOW = instant(1_759_060_800_000);

    it("the last member leaving a circle with no season archives it, stamped with the leave instant", async () => {
      const app = createTestApp({ now: NOW });
      const created = await createCircle(app, actorFor("user-andrea"), { name: "Solo" });
      if (!created.ok) throw new Error("fixture setup failed");

      const result = await leaveCircle(app, actorFor("user-andrea"), {
        circleId: created.value.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.archivedAt).toBe(NOW);
      const stored = await app.uow.read((repos) => repos.circles.get(created.value.id));
      expect(stored?.archivedAt).toBe(NOW);
    });

    it("a member leaving while others remain does not archive the circle", async () => {
      const app = createTestApp({ now: NOW });
      const { circle, victor } = await givenOpenPactWithOneApproval(app);

      const result = await leaveCircle(app, victor, { circleId: circle.id });

      expect(result.ok && result.value.archivedAt).toBeNull();
    });

    it("the last member leaving while the pact is open archives the circle and discards the season", async () => {
      const app = createTestApp({ now: NOW });
      const { circle, season, andrea } = await givenSoloOpenPact(app);

      const result = await leaveCircle(app, andrea, { circleId: circle.id });

      expect(result.ok && result.value.archivedAt).toBe(NOW);
      expect(await app.uow.read((repos) => repos.seasons.get(season.id))).toBeNull();
    });

    it("the last member leaving an ACTIVE season archives the circle and keeps the season unchanged", async () => {
      const app = createTestApp({ now: NOW });
      const { circle, season, andrea } = await givenSoloOpenPact(app);
      const closed = await approvePact(app, andrea, { seasonId: season.id });
      if (!closed.ok) throw new Error("fixture setup failed");

      const result = await leaveCircle(app, andrea, { circleId: circle.id });

      expect(result.ok && result.value.archivedAt).toBe(NOW);
      const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
      expect(stored).toEqual(closed.value);
    });
  });
});
