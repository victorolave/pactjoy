import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { SeasonClosureRepository } from "../season/closure/season-closure.repository.ts";
import type { SeasonClosure } from "../season/closure/season-closure.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { seasonClosureId, seasonId } from "../shared/ids.ts";
import { seasonClosureFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { SEASON } from "./fixtures.ts";

/**
 * What the closure contract needs from an adapter. It drives the repository DIRECTLY (not through
 * a `UnitOfWork`), same as the review contract; a database adapter supplies its own repository
 * over an empty store and `seedSeason` to create the parents the foreign keys need.
 */
export interface SeasonClosureContractSubject {
  readonly repository: SeasonClosureRepository;
  /** Creates the season (and whatever it needs) the suite's closures point at. Optional. */
  readonly seedSeason?: () => Promise<void>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const OWNER = memberId(uuid(0xa1));
const OTHER = memberId(uuid(0xa2));
const NOW = 1_791_987_120_000; // 2026-10-14T14:12:00Z

const closure = (n: number, extra: Partial<SeasonClosure> = {}): SeasonClosure =>
  seasonClosureFixture({
    id: seasonClosureId(uuid(0x500 + n)),
    seasonId: SEASON.id,
    memberId: OWNER,
    decidedAt: instant(NOW + n),
    decisions: [
      { commitmentId: commitmentId(uuid(0xc01)), decision: "continue" },
      { commitmentId: commitmentId(uuid(0xc02)), decision: "graduate" },
    ],
    ...extra,
  });

/** `SeasonClosureRepository` contract, adapter-neutral. The factory must return an EMPTY store. */
export function describeSeasonClosureRepositoryContract(
  name: string,
  factory: () => Promise<SeasonClosureContractSubject>,
): void {
  describe(`SeasonClosureRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("getMine is null for a member who has not closed", async () => {
      const repository = await setup();
      expect(await repository.getMine(SEASON.id, OWNER)).toBeNull();
    });

    it("save(null) inserts and getMine returns the same closure, children in saved order", async () => {
      const repository = await setup();
      const full = closure(1, {
        decisions: [
          { commitmentId: commitmentId(uuid(0xc03)), decision: "pause" },
          { commitmentId: commitmentId(uuid(0xc01)), decision: "adjust" },
          { commitmentId: commitmentId(uuid(0xc02)), decision: "graduate" },
          { commitmentId: commitmentId(uuid(0xc04)), decision: "continue" },
        ],
      });
      await repository.save(full, null);
      expect(await repository.getMine(SEASON.id, OWNER)).toEqual(full);
    });

    it("getMine never returns another member's or another season's closure", async () => {
      const repository = await setup();
      await repository.save(closure(1), null);
      expect(await repository.getMine(SEASON.id, OTHER)).toBeNull();
      expect(await repository.getMine(seasonId(uuid(0xe99)), OWNER)).toBeNull();
    });

    it("closedMemberIds is empty before anyone closes", async () => {
      const repository = await setup();
      expect(await repository.closedMemberIds(SEASON.id)).toEqual([]);
    });

    it("closedMemberIds returns member ids only, for this season only", async () => {
      const repository = await setup();
      await repository.save(closure(1), null);
      await repository.save(closure(2, { memberId: OTHER }), null);
      const ids = await repository.closedMemberIds(SEASON.id);
      expect([...ids].sort()).toEqual([OWNER, OTHER].sort());
      expect(ids.every((id) => typeof id === "string")).toBe(true);
      expect(await repository.closedMemberIds(seasonId(uuid(0xe99)))).toEqual([]);
    });

    it("a second closure for the same (season, member) conflicts and leaves the first intact", async () => {
      const repository = await setup();
      const first = closure(1);
      await repository.save(first, null);
      const again = closure(2, {
        decisions: [{ commitmentId: commitmentId(uuid(0xc01)), decision: "pause" }],
      });
      await expect(repository.save(again, null)).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.getMine(SEASON.id, OWNER)).toEqual(first);
    });

    it("two members may each close the same season", async () => {
      const repository = await setup();
      await repository.save(closure(1), null);
      await repository.save(closure(2, { memberId: OTHER }), null);
      expect(await repository.getMine(SEASON.id, OTHER)).not.toBeNull();
    });

    it("save(null) over an existing id conflicts", async () => {
      const repository = await setup();
      const first = closure(1);
      await repository.save(first, null);
      await expect(repository.save({ ...first, memberId: OTHER }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
    });

    it("save at a stale expected version conflicts", async () => {
      const repository = await setup();
      const first = closure(1);
      await repository.save(first, null);
      await expect(repository.save({ ...first, version: 1 }, 5)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await repository.getMine(SEASON.id, OWNER)).toEqual(first);
    });
  });
}
