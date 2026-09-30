import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, seasonId, userId } from "../shared/ids.ts";
import { circleFixture, memberFixture, seasonFixture } from "./builders.ts";
import { createInMemoryCircleRepository } from "./in-memory-circle-repository.ts";
import { createInMemorySeasonRepository } from "./in-memory-season-repository.ts";

const CIRCLE = circleFixture({
  id: circleId("circle-1"),
  members: [memberFixture({ id: memberId("member-1"), userId: userId("user-1") })],
});
const SEASON = seasonFixture({ id: seasonId("season-1"), circleId: CIRCLE.id });

interface Txn {
  guard(expectedVersion: number): Promise<void>;
  guardMissingId(): Promise<void>;
  saveNextVersion(): Promise<void>;
  validate(): void;
  apply(): void;
}

interface Subject {
  begin(): Txn;
  bumpLiveVersion(): Promise<void>;
}

async function circleSubject(): Promise<Subject> {
  const repo = createInMemoryCircleRepository();
  await repo.save(CIRCLE, null);
  return {
    begin() {
      const scope = repo.beginTransaction();
      return {
        guard: (v) => scope.repository.guardVersion(CIRCLE.id, v),
        guardMissingId: () => scope.repository.guardVersion(circleId("missing"), 0),
        saveNextVersion: () => scope.repository.save({ ...CIRCLE, version: 1 }, 0),
        validate: () => scope.validate(),
        apply: () => scope.apply(),
      };
    },
    bumpLiveVersion: () => repo.save({ ...CIRCLE, version: 1 }, 0),
  };
}

async function seasonSubject(): Promise<Subject> {
  const repo = createInMemorySeasonRepository();
  await repo.save(SEASON, null);
  return {
    begin() {
      const scope = repo.beginTransaction();
      return {
        guard: (v) => scope.repository.guardVersion(SEASON.id, v),
        guardMissingId: () => scope.repository.guardVersion(seasonId("missing"), 0),
        saveNextVersion: () => scope.repository.save({ ...SEASON, version: 1 }, 0),
        validate: () => scope.validate(),
        apply: () => scope.apply(),
      };
    },
    bumpLiveVersion: () => repo.save({ ...SEASON, version: 1 }, 0),
  };
}

describe.each([
  { name: "circle", subject: circleSubject },
  { name: "season", subject: seasonSubject },
])("in-memory $name repository: guardVersion", ({ subject }) => {
  it("passes a guard whose version still matches", async () => {
    const txn = (await subject()).begin();
    await txn.guard(0);
    expect(() => txn.validate()).not.toThrow();
  });

  it("fails a stale guard once the live version moved on", async () => {
    const live = await subject();
    const txn = live.begin();
    await txn.guard(0);
    await live.bumpLiveVersion();
    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
  });

  it("fails a guard on an id that does not exist", async () => {
    const txn = (await subject()).begin();
    await txn.guardMissingId();
    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
  });

  it("lets one transaction guard and save the same aggregate: the guard checks the pre-commit version", async () => {
    const txn = (await subject()).begin();
    await txn.guard(0);
    await txn.saveNextVersion();
    expect(() => txn.validate()).not.toThrow();
    expect(() => txn.apply()).not.toThrow();
  });
});

describe("guardVersion outside a transaction", () => {
  it("is a no-op on the live repositories", async () => {
    await expect(
      createInMemoryCircleRepository().guardVersion(CIRCLE.id, 5),
    ).resolves.toBeUndefined();
    await expect(
      createInMemorySeasonRepository().guardVersion(SEASON.id, 5),
    ).resolves.toBeUndefined();
  });
});
