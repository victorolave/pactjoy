import { describe, expect, it } from "vitest";
import { buildCircle, memberId } from "../circle/circle.ts";
import { inviteCode } from "../circle/invite-code.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, userId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { createInMemoryCircleRepository } from "./in-memory-circle-repository.ts";

const NOW = instant(1_700_000_000_000);

function buildFixtureCircle(id = "circle-1", user = "user-andrea") {
  const result = buildCircle({
    id: circleId(id),
    name: "Río Runners",
    creatorId: memberId("member-1"),
    creatorUserId: userId(user),
    now: NOW,
  });
  if (!result.ok) throw new Error("fixture setup failed");
  return result.value;
}

describe("createInMemoryCircleRepository", () => {
  it("get() returns null for an unknown id, and the saved circle after save()", async () => {
    const repo = createInMemoryCircleRepository();
    const circle = buildFixtureCircle();

    expect(await repo.get(circle.id)).toBeNull();

    await repo.save(circle, null);

    expect(await repo.get(circle.id)).toEqual(circle);
  });

  it("save() throws ConcurrencyConflict when expectedVersion does not match", async () => {
    const repo = createInMemoryCircleRepository();
    const circle = buildFixtureCircle();
    await repo.save(circle, null);

    await expect(repo.save({ ...circle, version: 1 }, 5)).rejects.toThrow(ConcurrencyConflict);
  });

  it("findActiveByUser() finds the circle a user is an active member of", async () => {
    const repo = createInMemoryCircleRepository();
    const circle = buildFixtureCircle();
    await repo.save(circle, null);

    const found = await repo.findActiveByUser(userId("user-andrea"));

    expect(found?.id).toBe("circle-1");
    expect(await repo.findActiveByUser(userId("user-victor"))).toBeNull();
  });

  it("findByInviteCode() finds a circle by its current invite code only", async () => {
    const repo = createInMemoryCircleRepository();
    const withInvite = {
      ...buildFixtureCircle(),
      invite: {
        code: inviteCode("AB23CD"),
        createdAt: NOW,
        expiresAt: instant(NOW + 1),
        createdBy: memberId("member-1"),
      },
    };
    await repo.save(withInvite, null);

    expect((await repo.findByInviteCode("AB23CD"))?.id).toBe("circle-1");
    expect(await repo.findByInviteCode("ZZ99ZZ")).toBeNull();
  });

  describe("beginTransaction() -- per-transaction isolation (ADR-0008, D4/D5)", () => {
    it("save() through the scope buffers the write: the live repo sees nothing until validate()+apply()", async () => {
      const repo = createInMemoryCircleRepository();
      const circle = buildFixtureCircle();
      await repo.save(circle, null);

      const { repository: scoped, validate, apply } = repo.beginTransaction();
      await scoped.save({ ...circle, version: 1, name: "Renamed" }, 0);

      expect((await repo.get(circle.id))?.name).toBe("Río Runners");

      validate();
      apply();
      expect((await repo.get(circle.id))?.name).toBe("Renamed");
    });

    it("reads through the scope see its own buffered write before commit() (read-your-own-writes)", async () => {
      const repo = createInMemoryCircleRepository();
      const circle = buildFixtureCircle();
      await repo.save(circle, null);

      const { repository: scoped } = repo.beginTransaction();
      await scoped.save({ ...circle, version: 1, name: "Renamed" }, 0);

      expect((await scoped.get(circle.id))?.name).toBe("Renamed");
    });

    it("validate()+apply() applies every staged write together when all versions still match", async () => {
      const repo = createInMemoryCircleRepository();
      const x = buildFixtureCircle("circle-x", "user-x");
      const y = buildFixtureCircle("circle-y", "user-y");
      await repo.save(x, null);
      await repo.save(y, null);

      const { repository: scoped, validate, apply } = repo.beginTransaction();
      await scoped.save({ ...x, version: 1, name: "X renamed" }, 0);
      await scoped.save({ ...y, version: 1, name: "Y renamed" }, 0);
      validate();
      apply();

      expect((await repo.get(x.id))?.name).toBe("X renamed");
      expect((await repo.get(y.id))?.name).toBe("Y renamed");
    });

    it("D5/atomicity: if ANY staged aggregate's version has moved on, validate() throws and apply() is never reached -- no partial commit", async () => {
      const repo = createInMemoryCircleRepository();
      const x = buildFixtureCircle("circle-x", "user-x");
      const y = buildFixtureCircle("circle-y", "user-y");
      await repo.save(x, null);
      await repo.save(y, null);

      const { repository: scoped, validate } = repo.beginTransaction();
      // Stage a valid write to X (expectedVersion still matches).
      await scoped.save({ ...x, version: 1, name: "X renamed" }, 0);
      // Stage a write to Y with a stale expectedVersion, simulating a
      // *different*, concurrently-committed write to Y that this
      // transaction never saw.
      await repo.save({ ...y, version: 1, name: "Y changed by someone else" }, 0);
      await scoped.save({ ...y, version: 2, name: "Y renamed by us" }, 0);

      expect(() => validate()).toThrow(ConcurrencyConflict);
      expect((await repo.get(x.id))?.name).toBe("Río Runners");
      expect((await repo.get(y.id))?.name).toBe("Y changed by someone else");
    });

    it("D5: the race at the 6-member cap -- the loser's scope never touches the live store, so the winner's write is never clobbered", async () => {
      const repo = createInMemoryCircleRepository();
      const circle = buildFixtureCircle();
      await repo.save(circle, null);

      const a = repo.beginTransaction();
      const b = repo.beginTransaction();
      await a.repository.save({ ...circle, version: 1, name: "A wins" }, 0);
      await b.repository.save({ ...circle, version: 1, name: "B loses" }, 0);

      a.validate();
      a.apply();
      expect(() => b.validate()).toThrow(ConcurrencyConflict);
      expect((await repo.get(circle.id))?.name).toBe("A wins");
    });

    it("CM-18: of two open transactions giving one user an active membership, the second commit throws", async () => {
      const repo = createInMemoryCircleRepository();
      const first = repo.beginTransaction();
      const second = repo.beginTransaction();
      await first.repository.save(buildFixtureCircle("circle-1"), null);
      await second.repository.save(buildFixtureCircle("circle-2"), null);

      first.validate();
      first.apply();

      expect(() => second.validate()).toThrow(ConcurrencyConflict);
      expect(await repo.get(circleId("circle-2"))).toBeNull();
    });
  });

  it("CM-18: a non-transactional save() of a second active membership throws and saves nothing", async () => {
    const repo = createInMemoryCircleRepository();
    await repo.save(buildFixtureCircle("circle-1"), null);

    await expect(repo.save(buildFixtureCircle("circle-2"), null)).rejects.toThrow(
      ConcurrencyConflict,
    );
    expect(await repo.get(circleId("circle-2"))).toBeNull();
  });
});
