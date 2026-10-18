import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { FeedReactionRepository } from "../reaction/feed-reaction.repository.ts";
import type { FeedReaction } from "../reaction/feed-reaction.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { feedReactionId, seasonId } from "../shared/ids.ts";
import { feedReactionFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { SEASON } from "./fixtures.ts";

/**
 * What the feed-reaction contract needs from an adapter. It drives the repository DIRECTLY (not
 * through a `UnitOfWork`), same as the review contract; a database adapter supplies its own
 * repository over an empty store and `seedSeason` to create the parent the foreign key needs.
 */
export interface FeedReactionContractSubject {
  readonly repository: FeedReactionRepository;
  /** Creates the season (and whatever it needs) the suite's reactions point at. Optional. */
  readonly seedSeason?: () => Promise<void>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const VICTOR = memberId(uuid(0xa1));
const CARLA = memberId(uuid(0xa2));
const ITEM = `session:${uuid(0xc01)}:3`;
const OTHER_ITEM = `week:${uuid(0xc01)}:1`;
const NOW = 1_791_987_120_000; // 2026-10-14T14:12:00Z

const reaction = (n: number, extra: Partial<FeedReaction> = {}): FeedReaction =>
  feedReactionFixture({
    id: feedReactionId(uuid(0x700 + n)),
    seasonId: SEASON.id,
    itemKey: ITEM,
    memberId: VICTOR,
    emoji: "heart",
    reactedAt: instant(NOW + n),
    ...extra,
  });

/** `FeedReactionRepository` contract, adapter-neutral. The factory must return an EMPTY store. */
export function describeFeedReactionRepositoryContract(
  name: string,
  factory: () => Promise<FeedReactionContractSubject>,
): void {
  describe(`FeedReactionRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("listBySeason is empty and find is null before anyone reacts", async () => {
      const repository = await setup();
      expect(await repository.listBySeason(SEASON.id)).toEqual([]);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toBeNull();
    });

    it("save(null) inserts and both reads return the same reaction", async () => {
      const repository = await setup();
      const stored = reaction(1, { emoji: "raisedHands" });
      await repository.save(stored, null);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toEqual(stored);
      expect(await repository.listBySeason(SEASON.id)).toEqual([stored]);
    });

    it("listBySeason is ordered by when they were set, ties by id, whatever the insert order", async () => {
      const repository = await setup();
      const late = reaction(3, { memberId: CARLA });
      const early = reaction(1, { itemKey: OTHER_ITEM });
      const tieHigh = reaction(9, {
        id: feedReactionId(uuid(0x7ff)),
        reactedAt: instant(NOW + 2),
        itemKey: `${OTHER_ITEM}0`,
      });
      const tieLow = reaction(8, {
        id: feedReactionId(uuid(0x7fe)),
        reactedAt: instant(NOW + 2),
        itemKey: `${OTHER_ITEM}1`,
      });
      for (const row of [late, tieHigh, early, tieLow]) await repository.save(row, null);
      expect((await repository.listBySeason(SEASON.id)).map((r) => r.id)).toEqual([
        early.id,
        tieLow.id,
        tieHigh.id,
        late.id,
      ]);
    });

    it("never returns another season's reactions", async () => {
      const repository = await setup();
      await repository.save(reaction(1), null);
      expect(await repository.listBySeason(seasonId(uuid(0xe99)))).toEqual([]);
      expect(await repository.find(seasonId(uuid(0xe99)), ITEM, VICTOR)).toBeNull();
    });

    it("find is exact on item and member", async () => {
      const repository = await setup();
      await repository.save(reaction(1), null);
      expect(await repository.find(SEASON.id, OTHER_ITEM, VICTOR)).toBeNull();
      expect(await repository.find(SEASON.id, ITEM, CARLA)).toBeNull();
    });

    it("two members may react to the same item, and one member to two items", async () => {
      const repository = await setup();
      await repository.save(reaction(1), null);
      await repository.save(reaction(2, { memberId: CARLA }), null);
      await repository.save(reaction(3, { itemKey: OTHER_ITEM }), null);
      expect(await repository.listBySeason(SEASON.id)).toHaveLength(3);
    });

    it("a second reaction of the same member to the same item conflicts and leaves the first intact", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await expect(repository.save(reaction(2, { emoji: "fire" }), null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await repository.listBySeason(SEASON.id)).toEqual([first]);
    });

    it("save(null) over an existing id conflicts", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await expect(repository.save({ ...first, itemKey: OTHER_ITEM }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
    });

    it("save at the expected version changes the emoji and bumps the version", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      const changed = { ...first, emoji: "fire", version: 1 } as const;
      await repository.save(changed, 0);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toEqual(changed);
      expect(await repository.listBySeason(SEASON.id)).toEqual([changed]);
    });

    it("save at a stale expected version conflicts and changes nothing", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await expect(
        repository.save({ ...first, emoji: "clap", version: 6 }, 5),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toEqual(first);
    });

    it("remove deletes the reaction and frees its key for a new one", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await repository.remove(first.id, 0);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toBeNull();
      expect(await repository.listBySeason(SEASON.id)).toEqual([]);
      const again = reaction(2, { emoji: "clap" });
      await repository.save(again, null);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toEqual(again);
    });

    it("remove at a stale version conflicts and keeps the reaction", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await expect(repository.remove(first.id, 4)).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.listBySeason(SEASON.id)).toEqual([first]);
    });

    it("remove of a reaction that is already gone conflicts", async () => {
      const repository = await setup();
      const first = reaction(1);
      await repository.save(first, null);
      await repository.remove(first.id, 0);
      await expect(repository.remove(first.id, 0)).rejects.toBeInstanceOf(ConcurrencyConflict);
    });

    it("deleteBySeasons deletes every reaction of those seasons only, and frees the keys", async () => {
      const repository = await setup();
      const mine = reaction(1);
      const theirs = reaction(2, { memberId: CARLA, itemKey: OTHER_ITEM });
      await repository.save(mine, null);
      await repository.save(theirs, null);
      await repository.deleteBySeasons([]);
      await repository.deleteBySeasons([seasonId(uuid(0xe99))]);
      expect(await repository.listBySeason(SEASON.id)).toEqual([mine, theirs]);
      await repository.deleteBySeasons([SEASON.id]);
      await repository.deleteBySeasons([SEASON.id]);
      expect(await repository.listBySeason(SEASON.id)).toEqual([]);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toBeNull();
      const again = reaction(3, { emoji: "clap" });
      await repository.save(again, null);
      expect(await repository.find(SEASON.id, ITEM, VICTOR)).toEqual(again);
    });
  });
}
