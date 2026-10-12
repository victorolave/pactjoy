import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { ReviewRepository } from "../review/review.repository.ts";
import type { ReviewRecord } from "../review/review.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { reviewId, seasonId } from "../shared/ids.ts";
import { reviewFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { SEASON } from "./fixtures.ts";

/**
 * What the review contract needs from an adapter. It drives the repository DIRECTLY (not through a
 * `UnitOfWork`), because the review port is wired into `Repositories` in a later work unit; a
 * database adapter supplies its own repository over an empty store and `seedSeason` to create the
 * parents the foreign keys need. The in-memory adapter needs no seeding.
 */
export interface ReviewContractSubject {
  readonly repository: ReviewRepository;
  /** Creates the season (and whatever it needs) the suite's reviews point at. Optional. */
  readonly seedSeason?: () => Promise<void>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const OWNER = memberId(uuid(0xa1));
const OTHER = memberId(uuid(0xa2));
const NOW = 1_791_987_120_000; // 2026-10-14T14:12:00Z

const record = (n: number, extra: Partial<ReviewRecord> = {}): ReviewRecord =>
  reviewFixture({
    id: reviewId(uuid(0xf00 + n)),
    seasonId: SEASON.id,
    memberId: OWNER,
    periodIndex: n,
    kind: "interim",
    recordedAt: instant(NOW + n),
    responses: [
      { commitmentId: commitmentId(uuid(0xc01)), items: [4, null, null, null] },
      { commitmentId: commitmentId(uuid(0xc02)), items: [5, null, null, null] },
    ],
    ...extra,
  });

/**
 * `ReviewRepository` contract, adapter-neutral. The factory must return an EMPTY store.
 */
export function describeReviewRepositoryContract(
  name: string,
  factory: () => Promise<ReviewContractSubject>,
): void {
  describe(`ReviewRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("listMine is empty for a member with no reviews", async () => {
      const repository = await setup();
      expect(await repository.listMine(SEASON.id, OWNER)).toEqual([]);
    });

    it("save(null) inserts and listMine returns the same review, children and nulls included", async () => {
      const repository = await setup();
      const full = record(2, {
        srbai: "full",
        reflection: { helped: "Con calma", hard: null },
        responses: [
          { commitmentId: commitmentId(uuid(0xc01)), items: [4, 4, 5, 5] },
          { commitmentId: commitmentId(uuid(0xc02)), items: [1, 2, 3, 7] },
        ],
      });
      await repository.save(full, null);
      expect(await repository.listMine(SEASON.id, OWNER)).toEqual([full]);
    });

    it("stores a skipped baseline with no answers", async () => {
      const repository = await setup();
      const skipped = record(0, {
        kind: "baseline",
        status: "skipped",
        srbai: null,
        responses: [],
        reflection: { helped: null, hard: null },
      });
      await repository.save(skipped, null);
      expect(await repository.listMine(SEASON.id, OWNER)).toEqual([skipped]);
    });

    it("listMine returns the member's reviews ordered by period, whatever the insert order", async () => {
      const repository = await setup();
      const [a, b, c] = [record(3), record(1), record(2)];
      for (const rec of [a, b, c]) await repository.save(rec, null);
      expect((await repository.listMine(SEASON.id, OWNER)).map((r) => r.periodIndex)).toEqual([
        1, 2, 3,
      ]);
    });

    it("listMine never returns another member's reviews", async () => {
      const repository = await setup();
      await repository.save(record(1), null);
      await repository.save(record(2, { id: reviewId(uuid(0xf90)), memberId: OTHER }), null);
      const mine = await repository.listMine(SEASON.id, OWNER);
      const theirs = await repository.listMine(SEASON.id, OTHER);
      expect(mine.map((r) => r.memberId)).toEqual([OWNER]);
      expect(theirs.map((r) => r.memberId)).toEqual([OTHER]);
    });

    it("listMine never returns another season's reviews", async () => {
      const repository = await setup();
      await repository.save(record(1), null);
      expect(await repository.listMine(seasonId(uuid(0xe99)), OWNER)).toEqual([]);
    });

    it("a second review for the same (season, member, period) conflicts and leaves the first intact", async () => {
      const repository = await setup();
      const first = record(1);
      await repository.save(first, null);
      const again = record(1, {
        id: reviewId(uuid(0xf91)),
        reflection: { helped: "x", hard: null },
      });
      await expect(repository.save(again, null)).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.listMine(SEASON.id, OWNER)).toEqual([first]);
    });

    it("two members may review the same period", async () => {
      const repository = await setup();
      await repository.save(record(1), null);
      await repository.save(record(1, { id: reviewId(uuid(0xf92)), memberId: OTHER }), null);
      expect(await repository.listMine(SEASON.id, OTHER)).toHaveLength(1);
    });

    it("save(null) over an existing id conflicts", async () => {
      const repository = await setup();
      const first = record(1);
      await repository.save(first, null);
      await expect(repository.save({ ...first, periodIndex: 2 }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
    });

    it("save at a stale expected version conflicts", async () => {
      const repository = await setup();
      const first = record(1);
      await repository.save(first, null);
      await expect(repository.save({ ...first, version: 1 }, 5)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await repository.listMine(SEASON.id, OWNER)).toEqual([first]);
    });
  });
}
