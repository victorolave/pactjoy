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

interface GuardSubject {
  readonly name: string;
  /** Builds a fresh adapter holding one aggregate stored at version 0. */
  readonly subject: () => Promise<Subject>;
}

/**
 * The `guardVersion` contract (D5 read-set guard) every repository adapter
 * must satisfy. Run today against the in-memory adapters; a Postgres
 * adapter reuses it by passing its own subject factories (move this
 * function to a shared non-test module at that point; Biome forbids
 * exports from test files).
 */
function describeGuardVersionContract(adapter: string, subjects: readonly GuardSubject[]): void {
  describe.each(subjects)(`${adapter} $name repository: guardVersion`, ({ subject }) => {
    defineGuardVersionCases(subject);
  });
}

function defineGuardVersionCases(subject: () => Promise<Subject>): void {
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

  it("fails a guard whose expected version is AHEAD of the stored one", async () => {
    const txn = (await subject()).begin();
    await txn.guard(1);
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
}

describeGuardVersionContract("in-memory", [
  { name: "circle", subject: circleSubject },
  { name: "season", subject: seasonSubject },
]);

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
