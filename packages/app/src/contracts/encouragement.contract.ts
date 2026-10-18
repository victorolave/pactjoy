import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { EncouragementRepository } from "../encouragement/encouragement.repository.ts";
import type { Encouragement, NudgeDismissal } from "../encouragement/encouragement.ts";
import type { NudgeDismissalRepository } from "../encouragement/nudge-dismissal.repository.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { encouragementId, seasonId } from "../shared/ids.ts";
import { encouragementFixture, nudgeDismissalFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { SEASON } from "./fixtures.ts";

/**
 * What the encouragement contracts need from an adapter. They drive the repositories DIRECTLY (not
 * through a `UnitOfWork`), same as the review contract; a database adapter supplies its own
 * repository over an empty store and `seedSeason` to create the parent the foreign key needs.
 */
export interface EncouragementContractSubject {
  readonly repository: EncouragementRepository;
  /** Creates the season (and whatever it needs) the suite's rows point at. Optional. */
  readonly seedSeason?: () => Promise<void>;
}

export interface NudgeDismissalContractSubject {
  readonly repository: NudgeDismissalRepository;
  readonly seedSeason?: () => Promise<void>;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const VICTOR = memberId(uuid(0xa1));
const ANDREA = memberId(uuid(0xa2));
const CARLA = memberId(uuid(0xa3));
const NOW = 1_791_987_120_000; // 2026-10-14T14:12:00Z

const sent = (n: number, extra: Partial<Encouragement> = {}): Encouragement =>
  encouragementFixture({
    id: encouragementId(uuid(0x800 + n)),
    seasonId: SEASON.id,
    senderId: VICTOR,
    recipientId: ANDREA,
    caseWeek: 3,
    emoji: "raisedHands",
    sentAt: instant(NOW + n),
    sentOn: localDate("2026-10-14"),
    ...extra,
  });

/** `EncouragementRepository` contract, adapter-neutral. The factory must return an EMPTY store. */
export function describeEncouragementRepositoryContract(
  name: string,
  factory: () => Promise<EncouragementContractSubject>,
): void {
  describe(`EncouragementRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("reads are empty before anyone sends", async () => {
      const repository = await setup();
      expect(await repository.listSent(SEASON.id, VICTOR)).toEqual([]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([]);
      expect(await repository.get(encouragementId(uuid(0x800)))).toBeNull();
    });

    it("add stores the encouragement and the three reads return the same row", async () => {
      const repository = await setup();
      const one = sent(1, { emoji: "fire" });
      await repository.add(one);
      expect(await repository.listSent(SEASON.id, VICTOR)).toEqual([one]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([one]);
      expect(await repository.get(one.id)).toEqual(one);
    });

    it("listSent holds only the sender's rows and listReceived only the recipient's", async () => {
      const repository = await setup();
      const toAndrea = sent(1);
      const toCarla = sent(2, { recipientId: CARLA });
      const fromCarla = sent(3, { senderId: CARLA });
      for (const row of [toAndrea, toCarla, fromCarla]) await repository.add(row);
      expect((await repository.listSent(SEASON.id, VICTOR)).map((r) => r.id)).toEqual([
        toAndrea.id,
        toCarla.id,
      ]);
      expect((await repository.listReceived(SEASON.id, ANDREA)).map((r) => r.id)).toEqual([
        toAndrea.id,
        fromCarla.id,
      ]);
      expect(await repository.listReceived(SEASON.id, VICTOR)).toEqual([]);
      expect(await repository.listSent(SEASON.id, ANDREA)).toEqual([]);
    });

    it("lists are oldest first, ties by id, whatever the insert order", async () => {
      const repository = await setup();
      const late = sent(3, { recipientId: CARLA, sentOn: localDate("2026-10-15") });
      const early = sent(1, { sentOn: localDate("2026-10-13") });
      const tieHigh = sent(9, {
        id: encouragementId(uuid(0x8ff)),
        sentAt: instant(NOW + 2),
        caseWeek: 4,
        sentOn: localDate("2026-10-16"),
      });
      const tieLow = sent(8, {
        id: encouragementId(uuid(0x8fe)),
        sentAt: instant(NOW + 2),
        caseWeek: 5,
        sentOn: localDate("2026-10-17"),
      });
      for (const row of [late, tieHigh, early, tieLow]) await repository.add(row);
      expect((await repository.listSent(SEASON.id, VICTOR)).map((r) => r.id)).toEqual([
        early.id,
        tieLow.id,
        tieHigh.id,
        late.id,
      ]);
    });

    it("never returns another season's rows", async () => {
      const repository = await setup();
      await repository.add(sent(1));
      expect(await repository.listSent(seasonId(uuid(0xe99)), VICTOR)).toEqual([]);
      expect(await repository.listReceived(seasonId(uuid(0xe99)), ANDREA)).toEqual([]);
    });

    it("one encouragement per case: the same sender, recipient and week conflicts", async () => {
      const repository = await setup();
      const first = sent(1);
      await repository.add(first);
      await expect(
        repository.add(sent(2, { sentOn: localDate("2026-10-15"), emoji: "fire" })),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await repository.listSent(SEASON.id, VICTOR)).toEqual([first]);
    });

    it("one per person per day: the same sender, recipient and day conflicts, even for another week", async () => {
      const repository = await setup();
      const first = sent(1);
      await repository.add(first);
      await expect(repository.add(sent(2, { caseWeek: 4 }))).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await repository.listSent(SEASON.id, VICTOR)).toEqual([first]);
    });

    it("another recipient, another sender, another week on another day, are all independent", async () => {
      const repository = await setup();
      await repository.add(sent(1));
      await repository.add(sent(2, { recipientId: CARLA }));
      await repository.add(sent(3, { senderId: CARLA }));
      await repository.add(sent(4, { caseWeek: 4, sentOn: localDate("2026-10-15") }));
      expect(await repository.listReceived(SEASON.id, ANDREA)).toHaveLength(3);
    });

    it("add over an existing id conflicts", async () => {
      const repository = await setup();
      const first = sent(1);
      await repository.add(first);
      await expect(
        repository.add({ ...first, recipientId: CARLA, caseWeek: 9 }),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
    });

    it("deleteByRecipients deletes what the members received and keeps what they sent", async () => {
      const repository = await setup();
      const toAndrea = sent(1);
      const toCarla = sent(2, { recipientId: CARLA });
      const fromAndrea = sent(3, { senderId: ANDREA, recipientId: VICTOR });
      for (const row of [toAndrea, toCarla, fromAndrea]) await repository.add(row);
      await repository.deleteByRecipients([]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([toAndrea]);
      await repository.deleteByRecipients([ANDREA]);
      await repository.deleteByRecipients([ANDREA]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([]);
      expect(await repository.get(toAndrea.id)).toBeNull();
      expect(await repository.listSent(SEASON.id, ANDREA)).toEqual([fromAndrea]);
      expect(await repository.listReceived(SEASON.id, CARLA)).toEqual([toCarla]);
    });

    it("deleteByRecipients drops a row sent by an erased member only when its recipient is erased too", async () => {
      const repository = await setup();
      const fromAndrea = sent(1, { senderId: ANDREA, recipientId: VICTOR });
      await repository.add(fromAndrea);
      await repository.deleteByRecipients([ANDREA]);
      expect(await repository.get(fromAndrea.id)).toEqual(fromAndrea);
      await repository.deleteByRecipients([ANDREA, VICTOR]);
      expect(await repository.get(fromAndrea.id)).toBeNull();
    });

    it("deleteBySeasons deletes every row of those seasons only, and frees the keys", async () => {
      const repository = await setup();
      const one = sent(1);
      const two = sent(2, { senderId: CARLA });
      await repository.add(one);
      await repository.add(two);
      await repository.deleteBySeasons([]);
      await repository.deleteBySeasons([seasonId(uuid(0xe99))]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([one, two]);
      await repository.deleteBySeasons([SEASON.id]);
      await repository.deleteBySeasons([SEASON.id]);
      expect(await repository.listReceived(SEASON.id, ANDREA)).toEqual([]);
      expect(await repository.listSent(SEASON.id, VICTOR)).toEqual([]);
      await repository.add(one);
      expect(await repository.get(one.id)).toEqual(one);
    });
  });
}

const dismissal = (n: number, extra: Partial<NudgeDismissal> = {}): NudgeDismissal =>
  nudgeDismissalFixture({
    seasonId: SEASON.id,
    viewerId: VICTOR,
    targetId: ANDREA,
    caseWeek: 3,
    dismissedAt: instant(NOW + n),
    dismissedOn: localDate("2026-10-14"),
    ...extra,
  });

/** `NudgeDismissalRepository` contract, adapter-neutral. The factory must return an EMPTY store. */
export function describeNudgeDismissalRepositoryContract(
  name: string,
  factory: () => Promise<NudgeDismissalContractSubject>,
): void {
  describe(`NudgeDismissalRepository contract (${name})`, () => {
    const setup = async () => {
      const subject = await factory();
      await subject.seedSeason?.();
      return subject.repository;
    };

    it("listMine is empty before the viewer dismisses anything", async () => {
      const repository = await setup();
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([]);
    });

    it("add stores the dismissal and listMine returns the same row", async () => {
      const repository = await setup();
      const one = dismissal(1);
      await repository.add(one);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([one]);
    });

    it("listMine never returns another viewer's dismissals, nor another season's", async () => {
      const repository = await setup();
      await repository.add(dismissal(1));
      await repository.add(dismissal(2, { viewerId: CARLA }));
      expect((await repository.listMine(SEASON.id, VICTOR)).map((d) => d.viewerId)).toEqual([
        VICTOR,
      ]);
      expect((await repository.listMine(SEASON.id, CARLA)).map((d) => d.viewerId)).toEqual([CARLA]);
      expect(await repository.listMine(seasonId(uuid(0xe99)), VICTOR)).toEqual([]);
    });

    it("lists oldest first, ties by target and week, whatever the insert order", async () => {
      const repository = await setup();
      const late = dismissal(3, { targetId: CARLA });
      const early = dismissal(1, { caseWeek: 4 });
      const tieB = dismissal(2, { targetId: CARLA, caseWeek: 5, dismissedAt: instant(NOW + 2) });
      const tieA = dismissal(2, { caseWeek: 5, dismissedAt: instant(NOW + 2) });
      for (const row of [late, tieB, early, tieA]) await repository.add(row);
      expect(
        (await repository.listMine(SEASON.id, VICTOR)).map((d) => [d.targetId, d.caseWeek]),
      ).toEqual([
        [ANDREA, 4],
        [ANDREA, 5],
        [CARLA, 5],
        [CARLA, 3],
      ]);
    });

    it("is idempotent: dismissing the same case again succeeds and keeps the first dismissal", async () => {
      const repository = await setup();
      const first = dismissal(1);
      await repository.add(first);
      await expect(
        repository.add(dismissal(5, { dismissedOn: localDate("2026-10-20") })),
      ).resolves.toBeUndefined();
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([first]);
    });

    it("different weeks and different targets are different cases", async () => {
      const repository = await setup();
      await repository.add(dismissal(1));
      await repository.add(dismissal(2, { caseWeek: 4 }));
      await repository.add(dismissal(3, { targetId: CARLA }));
      expect(await repository.listMine(SEASON.id, VICTOR)).toHaveLength(3);
    });

    it("deleteByMembers deletes the dismissals the members made and those aimed at them", async () => {
      const repository = await setup();
      const toAndrea = dismissal(1);
      const toCarla = dismissal(2, { targetId: CARLA });
      const byAndrea = dismissal(3, { viewerId: ANDREA, targetId: CARLA });
      const carlaToVictor = dismissal(4, { viewerId: CARLA, targetId: VICTOR });
      for (const row of [toAndrea, toCarla, byAndrea, carlaToVictor]) await repository.add(row);
      await repository.deleteByMembers([]);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([toAndrea, toCarla]);
      await repository.deleteByMembers([ANDREA]);
      await repository.deleteByMembers([ANDREA]);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([toCarla]);
      expect(await repository.listMine(SEASON.id, ANDREA)).toEqual([]);
      expect(await repository.listMine(SEASON.id, CARLA)).toEqual([carlaToVictor]);
    });

    it("deleteBySeasons deletes every dismissal of those seasons only, and frees the keys", async () => {
      const repository = await setup();
      const first = dismissal(1);
      await repository.add(first);
      await repository.add(dismissal(2, { viewerId: CARLA }));
      await repository.deleteBySeasons([]);
      await repository.deleteBySeasons([seasonId(uuid(0xe99))]);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([first]);
      await repository.deleteBySeasons([SEASON.id]);
      await repository.deleteBySeasons([SEASON.id]);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([]);
      expect(await repository.listMine(SEASON.id, CARLA)).toEqual([]);
      const again = dismissal(5, { dismissedOn: localDate("2026-10-20") });
      await repository.add(again);
      expect(await repository.listMine(SEASON.id, VICTOR)).toEqual([again]);
    });
  });
}
