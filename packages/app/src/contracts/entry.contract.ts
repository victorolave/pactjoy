import { frac, type MemberId, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord, EntryValue } from "../entry/entry.ts";
import type { Repositories } from "../ports/repositories.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import {
  type EntryPhotoId,
  entryId,
  entryPhotoId,
  type SeasonId,
  seasonId,
} from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { entryPhotoFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { type ContractSubject, SEASON, seedCircleAndSeason } from "./fixtures.ts";

type EntryRepositories = Pick<Repositories, "circles" | "seasons" | "entries" | "entryPhotos">;
type Uow = ContractSubject<EntryRepositories>["uow"];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const MEMBER = memberId(uuid(0xa1));
const COMMITMENT = commitmentId(uuid(0x301));
const DONE: EntryValue = { kind: "done" };

/** An attached ledger row, so an entry may point at it (the foreign key of a real database). */
const photoRow = (n: number) =>
  entryPhotoFixture({
    id: entryPhotoId(uuid(0x700 + n)),
    seasonId: SEASON.id,
    memberId: MEMBER,
    commitmentId: COMMITMENT,
    objectKey: `o/${n.toString(16).padStart(32, "0")}.jpg`,
    status: "attached",
    version: 1,
  });
const PHOTO = (n: number): EntryPhotoId => photoRow(n).id;

const entry = (n: number, options: Partial<EntryRecord> = {}): EntryRecord => ({
  id: entryId(uuid(0x500 + n)),
  seasonId: SEASON.id,
  memberId: MEMBER,
  commitmentId: COMMITMENT,
  day: seasonDay(n),
  recordedOn: seasonDay(n),
  recordedAt: instant(1_700_000_000_000 + n),
  clientRequestId: `req-${n}`,
  editedAt: null,
  version: 0,
  requestFingerprint: `fp-${n}`,
  value: DONE,
  note: null,
  photoId: null,
  deleted: false,
  ...options,
});

/**
 * `EntryRepository` add/read contract (EP-S1..S4, S6, S8..S9 live half, S11,
 * S12, S25..S27, S30, S31, S33) and replace/remove (EP-S5, S8, S10, S13..S18,
 * S21..S23), adapter-neutral. The factory must return an EMPTY store;
 * the parent circle and season are seeded through the ports (foreign key).
 */
export function describeEntryRepositoryContract(
  name: string,
  factory: () => Promise<ContractSubject<EntryRepositories>>,
): void {
  describe(`EntryRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      await seedCircleAndSeason(uow);
      return {
        uow,
        add: (...entries: EntryRecord[]) =>
          uow.transaction(async ({ entries: repo }) => {
            for (const e of entries) await repo.add(e);
            return ok(undefined);
          }),
        get: (e: EntryRecord) => uow.read(({ entries }) => entries.get(e.id)),
        stored: (e: EntryRecord) => uow.read(({ entries }) => entries.getStored(e.id)),
        replace: (next: EntryRecord, expected: number) =>
          uow.transaction(async ({ entries }) => {
            await entries.replace(next, expected);
            return ok(undefined);
          }),
        remove: (e: EntryRecord, expected: number) =>
          uow.transaction(async ({ entries }) => {
            await entries.remove(e.id, expected);
            return ok(undefined);
          }),
      };
    }
    const rejects = (uow: Uow, e: EntryRecord) =>
      expect(
        uow.transaction(async ({ entries }) => {
          await entries.add(e);
          return ok(undefined);
        }),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);

    it("EP-S1/S30/S31/S33: round-trips every value kind, note, day and instant", async () => {
      const { add, get } = await subject();
      const all = [
        entry(1),
        entry(2, { value: { kind: "missed" }, note: "ñ ✓ 🙌" }),
        entry(3, { value: { kind: "quantity", value: frac(1n, 3n) }, editedAt: instant(5) }),
        entry(4, { day: seasonDay(0), recordedOn: seasonDay(2_000_000), note: "🙌".repeat(280) }),
      ];
      await add(...all);
      for (const e of all) expect(await get(e)).toEqual(e);
    });

    it("EP-P1: round-trips the photo id, null included", async () => {
      const { uow, add, get } = await subject();
      await uow.transaction(async ({ entryPhotos }) => {
        await entryPhotos.add(photoRow(1));
        return ok(undefined);
      });
      const withPhoto = entry(1, { photoId: PHOTO(1) });
      const without = entry(2);
      await add(withPhoto, without);
      expect(await get(withPhoto)).toEqual(withPhoto);
      expect(await get(without)).toEqual(without);
    });

    it("EP-P2: replace sets, swaps and clears the photo id", async () => {
      const { uow, add, get, replace } = await subject();
      await uow.transaction(async ({ entryPhotos }) => {
        await entryPhotos.add(photoRow(1));
        await entryPhotos.add(photoRow(2));
        return ok(undefined);
      });
      const e = entry(1);
      await add(e);
      const first = entry(1, { photoId: PHOTO(1), version: 1 });
      await replace(first, 0);
      expect(await get(e)).toEqual(first);
      const second = entry(1, { photoId: PHOTO(2), version: 2 });
      await replace(second, 1);
      expect(await get(e)).toEqual(second);
      const cleared = entry(1, { photoId: null, version: 3 });
      await replace(cleared, 2);
      expect(await get(e)).toEqual(cleared);
    });

    it("EP-P3: remove blanks the photo id of the tombstone", async () => {
      const { uow, add, stored, remove } = await subject();
      await uow.transaction(async ({ entryPhotos }) => {
        await entryPhotos.add(photoRow(1));
        return ok(undefined);
      });
      const e = entry(1, { photoId: PHOTO(1) });
      await add(e);
      await remove(e, 0);
      expect(await stored(e)).toMatchObject({ deleted: true, photoId: null });
    });

    it("EP-S2/S9: unknown id and unknown key read as null", async () => {
      const { uow } = await subject();
      const e = entry(1);
      expect(await uow.read(({ entries }) => entries.get(e.id))).toBeNull();
      expect(await uow.read(({ entries }) => entries.getStored(e.id))).toBeNull();
      expect(
        await uow.read(({ entries }) =>
          entries.findByClientRequest(e.memberId, e.commitmentId, e.clientRequestId),
        ),
      ).toBeNull();
    });

    it("EP-S3: a duplicate id conflicts and nothing is added twice", async () => {
      const { uow, add } = await subject();
      await add(entry(1));
      await rejects(uow, entry(1, { clientRequestId: "other" }));
      expect(await uow.read(({ entries }) => entries.listBySeason(SEASON.id))).toHaveLength(1);
    });

    it("EP-S4/S6/S8: the idempotency key is unique per member and commitment", async () => {
      const { uow, add } = await subject();
      const first = entry(1);
      await add(first);
      await rejects(uow, entry(2, { clientRequestId: first.clientRequestId }));
      const otherMember = entry(3, {
        memberId: memberId(uuid(0xa2)),
        clientRequestId: first.clientRequestId,
      });
      const otherCommitment = entry(4, {
        commitmentId: commitmentId(uuid(0x302)),
        clientRequestId: first.clientRequestId,
      });
      await add(otherMember, otherCommitment);
      const found = (e: EntryRecord) =>
        uow.read(({ entries }) =>
          entries.findByClientRequest(e.memberId, e.commitmentId, e.clientRequestId),
        );
      expect(await found(first)).toEqual(first);
      expect(await found(otherMember)).toEqual(otherMember);
      expect(await found(otherCommitment)).toEqual(otherCommitment);
      expect(await uow.read(({ entries }) => entries.getStored(first.id))).toEqual(first);
    });

    it("EP-S11/S12: listBySeason filters by season and keeps a stable order", async () => {
      const { uow, add } = await subject();
      const list = () => uow.read(({ entries }) => entries.listBySeason(SEASON.id));
      expect(await list()).toEqual([]);
      // Same recordedAt on purpose: insertion order decides, not time or id.
      const all = [entry(3), entry(1), entry(2)].map((e) => ({ ...e, recordedAt: instant(1) }));
      await add(...all);
      expect(await list()).toEqual(all);
      expect(await list()).toEqual(all);
      const elsewhere = "00000000-0000-4000-8000-0000000000ff" as SeasonId;
      expect(await uow.read(({ entries }) => entries.listBySeason(elsewhere))).toEqual([]);
    });

    it("EP-S25/S26/S27: quantities round-trip as exact normalized fractions", async () => {
      const { add, get } = await subject();
      const huge = 2n ** 53n + 1n;
      const values = [
        frac(1n, 3n),
        frac(7n, 2n),
        frac(0n, 1n),
        frac(4n, 2n),
        frac(1n, 4n),
        frac(huge, 3n),
        frac(-huge, 7n),
      ];
      const stored = values.map((value, i) => entry(i + 1, { value: { kind: "quantity", value } }));
      await add(...stored);
      for (const e of stored) {
        const value = (await get(e))?.value;
        expect(value).toEqual(e.value);
        if (value?.kind !== "quantity") throw new Error("expected a quantity");
        expect(typeof value.value.num).toBe("bigint");
        expect(typeof value.value.den).toBe("bigint");
      }
      expect((await get(stored[3] as EntryRecord))?.value).toEqual({
        kind: "quantity",
        value: frac(2n, 1n),
      });
    });

    const plainError = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ConcurrencyConflict);
    };
    const conflict = (promise: Promise<unknown>) =>
      expect(promise).rejects.toBeInstanceOf(ConcurrencyConflict);

    it("EP-S13: replace updates value, note, editedAt and version", async () => {
      const { add, get, replace } = await subject();
      const e = entry(1);
      await add(e);
      const next = entry(1, {
        value: { kind: "quantity", value: frac(5n, 2n) },
        note: "edited",
        editedAt: instant(9),
        version: 1,
      });
      await replace(next, 0);
      expect(await get(e)).toEqual(next);
    });

    it("EP-S14/S15/S16: replace conflicts on a stale version, an unknown id and a tombstone", async () => {
      const { add, replace, remove } = await subject();
      const e = entry(1);
      await add(e);
      await replace(entry(1, { note: "v1", version: 1 }), 0);
      await conflict(replace(entry(1, { note: "late", version: 1 }), 0));
      await conflict(replace(entry(2, { version: 1 }), 0));
      await remove(e, 1);
      await conflict(replace(entry(1, { note: "dead", version: 3 }), 2));
    });

    it("EP-S17/S18: a wrong next.version or a changed immutable field is a plain error and stores nothing", async () => {
      const { add, get, replace } = await subject();
      const e = entry(1);
      await add(e);
      await plainError(replace(entry(1, { note: "x", version: 2 }), 0));
      const changed: Partial<EntryRecord>[] = [
        { day: seasonDay(9) },
        { recordedOn: seasonDay(9) },
        { recordedAt: instant(9) },
        { clientRequestId: "other" },
        { requestFingerprint: "other" },
        { memberId: memberId(uuid(0xa2)) },
        { commitmentId: commitmentId(uuid(0x302)) },
      ];
      for (const change of changed) {
        await plainError(replace(entry(1, { note: "x", version: 1, ...change }), 0));
      }
      expect(await get(e)).toEqual(e);
    });

    it("a wrong next.version writes nothing even when the caller swallows the error and commits", async () => {
      const { uow, add, get } = await subject();
      const e = entry(1);
      await add(e);
      await uow.transaction(async ({ entries }) => {
        await plainError(entries.replace(entry(1, { note: "x", version: 5 }), 0));
        return ok(undefined);
      });
      expect(await get(e)).toEqual(e);
    });

    it("EP-S21: remove leaves a blanked tombstone that get and listBySeason hide", async () => {
      const { uow, add, get, stored, remove } = await subject();
      const e = entry(1, { value: { kind: "quantity", value: frac(1n, 3n) }, note: "secret" });
      const live = entry(2);
      await add(e, live);
      await remove(e, 0);
      expect(await get(e)).toBeNull();
      expect(await uow.read(({ entries }) => entries.listBySeason(SEASON.id))).toEqual([live]);
      expect(await stored(e)).toEqual({
        id: e.id,
        seasonId: e.seasonId,
        memberId: e.memberId,
        commitmentId: e.commitmentId,
        day: e.day,
        recordedOn: e.recordedOn,
        recordedAt: e.recordedAt,
        clientRequestId: e.clientRequestId,
        editedAt: e.editedAt,
        version: 1,
        requestFingerprint: e.requestFingerprint,
        value: null,
        note: null,
        photoId: null,
        deleted: true,
      });
    });

    it("EP-S8/S5: findByClientRequest returns the tombstone and its key stays taken", async () => {
      const { uow, add, stored, remove } = await subject();
      const e = entry(1);
      await add(e);
      await remove(e, 0);
      const found = await uow.read(({ entries }) =>
        entries.findByClientRequest(e.memberId, e.commitmentId, e.clientRequestId),
      );
      expect(found).toEqual(await stored(e));
      expect(found).toMatchObject({ deleted: true, requestFingerprint: e.requestFingerprint });
      await rejects(uow, entry(2, { clientRequestId: e.clientRequestId }));
    });

    it("EP-S22: remove conflicts on a stale version, an unknown id and a tombstone", async () => {
      const { add, remove } = await subject();
      const e = entry(1);
      await add(e);
      await conflict(remove(e, 5));
      await conflict(remove(entry(2), 0));
      await remove(e, 0);
      await conflict(remove(e, 0));
      await conflict(remove(e, 1));
    });

    it("remove after a replace succeeds and leaves a tombstone at version 2", async () => {
      const { add, replace, remove, stored } = await subject();
      const e = entry(1, { note: "secret" });
      await add(e);
      await replace(entry(1, { note: "edited", version: 1 }), 0);
      await remove(e, 1);
      expect(await stored(e)).toMatchObject({ deleted: true, value: null, note: null, version: 2 });
    });

    it("remove with the pre-replace version, after a replace in the same transaction, conflicts", async () => {
      const { uow, add, get, stored } = await subject();
      const e = entry(1);
      await add(e);
      await conflict(
        uow.transaction(async ({ entries }) => {
          await entries.replace(entry(1, { note: "edited", version: 1 }), 0);
          // The transaction's own replace already moved the entry to version 1.
          await entries.remove(e.id, 0);
          return ok(undefined);
        }),
      );
      expect(await get(e)).toEqual(e);
      expect(await stored(e)).toEqual(e);
    });

    it("replace then remove at the replaced version in one transaction commits a tombstone at version 2", async () => {
      const { uow, add, stored } = await subject();
      const e = entry(1, { note: "secret" });
      await add(e);
      const inside = await uow.transaction(async ({ entries }) => {
        await entries.replace(entry(1, { note: "edited", version: 1 }), 0);
        await entries.remove(e.id, 1);
        return ok(await entries.getStored(e.id));
      });
      expect(inside).toEqual(ok(await stored(e)));
      expect(await stored(e)).toMatchObject({ deleted: true, note: null, version: 2 });
    });

    // Replace after remove only asserts that the transaction rejects, and that
    // is deliberate. Postgres reports ConcurrencyConflict (the UPDATE matches no
    // live row, which it cannot tell from a lost race without a read) while
    // in-memory throws a plain Error; either way it is a caller bug. The spec
    // text says the entry "stays a tombstone", but the whole transaction rolls
    // back, so the original stays live. That divergence is deliberate.
    it("EP-S23: replace after remove in one transaction rejects and rolls everything back", async () => {
      const { uow, add, get, stored } = await subject();
      const e = entry(1);
      await add(e);
      await expect(
        uow.transaction(async ({ entries }) => {
          await entries.remove(e.id, 0);
          await entries.replace(entry(1, { note: "back", version: 2 }), 1);
          return ok(undefined);
        }),
      ).rejects.toThrow();
      expect(await get(e)).toEqual(e);
      expect(await stored(e)).toEqual(e);
    });

    describe("account erasure", () => {
      const PEER = memberId(uuid(0xa2));
      const noted = (n: number, options: Partial<EntryRecord> = {}) =>
        entry(n, {
          note: "secret note",
          requestFingerprint: '["done",null,"secret note"]',
          ...options,
        });
      const erase = (uow: Uow, members: readonly MemberId[]) =>
        uow.transaction(async ({ entries }) => {
          await entries.eraseEvidence(members);
          return ok(undefined);
        });

      it("eraseEvidence blanks note, photo and the plain-text request key of live rows and tombstones, keeping the scoring facts", async () => {
        const { uow, add, remove, stored, get } = await subject();
        await uow.transaction(async ({ entryPhotos }) => {
          await entryPhotos.add(photoRow(1));
          return ok(undefined);
        });
        const live = noted(1, { photoId: PHOTO(1) });
        const quantity = noted(2, {
          value: { kind: "quantity", value: frac(7n, 2n) },
          editedAt: instant(9),
        });
        const dead = noted(3);
        const peer = noted(4, { memberId: PEER });
        await add(live, quantity, dead, peer);
        await remove(dead, 0);
        await erase(uow, [MEMBER]);
        expect(await get(live)).toEqual({
          ...live,
          note: null,
          photoId: null,
          requestFingerprint: "erased",
          clientRequestId: live.id,
          version: 1,
        });
        expect(await get(quantity)).toEqual({
          ...quantity,
          note: null,
          requestFingerprint: "erased",
          clientRequestId: quantity.id,
          version: 1,
        });
        expect(await stored(dead)).toMatchObject({
          deleted: true,
          value: null,
          note: null,
          day: dead.day,
          requestFingerprint: "erased",
          clientRequestId: dead.id,
          version: 2,
        });
        expect(await get(peer)).toEqual(peer);
      });

      it("eraseEvidence moves the idempotency key to the entry id and frees nothing else", async () => {
        const { uow, add } = await subject();
        const e = noted(1);
        await add(e);
        await erase(uow, [MEMBER]);
        const byOld = await uow.read(({ entries }) =>
          entries.findByClientRequest(e.memberId, e.commitmentId, e.clientRequestId),
        );
        const byId = await uow.read(({ entries }) =>
          entries.findByClientRequest(e.memberId, e.commitmentId, e.id),
        );
        expect(byOld).toBeNull();
        expect(byId).toMatchObject({ id: e.id, requestFingerprint: "erased" });
      });

      it("eraseEvidence is a safe repeat that bumps no version twice, and [] is a no-op", async () => {
        const { uow, add, get } = await subject();
        const e = noted(1);
        await add(e);
        await erase(uow, []);
        expect(await get(e)).toEqual(e);
        await erase(uow, [MEMBER]);
        await erase(uow, [MEMBER]);
        expect(await get(e)).toMatchObject({ version: 1, requestFingerprint: "erased" });
      });

      it("eraseEvidence is seen inside its own transaction and undone by a rollback", async () => {
        const { uow, add, get } = await subject();
        const e = noted(1);
        await add(e);
        const seen = await uow.transaction(async ({ entries }) => {
          await entries.eraseEvidence([MEMBER]);
          return ok(await entries.get(e.id));
        });
        expect((seen as { value: EntryRecord | null }).value).toMatchObject({
          note: null,
          version: 1,
        });
        const f = noted(2);
        await add(f);
        await expect(
          uow.transaction(async ({ entries }) => {
            await entries.eraseEvidence([MEMBER]);
            throw new Error("boom");
          }),
        ).rejects.toThrow("boom");
        expect(await get(f)).toEqual(f);
      });

      it("deleteBySeasons removes live rows and tombstones of the seasons, and nothing for others", async () => {
        const { uow, add, remove, get, stored } = await subject();
        await uow.transaction(async ({ entryPhotos }) => {
          await entryPhotos.add(photoRow(1));
          return ok(undefined);
        });
        const live = entry(1, { photoId: PHOTO(1) });
        const dead = entry(2);
        await add(live, dead);
        await remove(dead, 0);
        const drop = (ids: SeasonId[]) =>
          uow.transaction(async ({ entries }) => {
            await entries.deleteBySeasons(ids);
            return ok(undefined);
          });
        await drop([]);
        await drop([seasonId(uuid(0xe99))]);
        expect(await get(live)).toEqual(live);
        await drop([SEASON.id]);
        await drop([SEASON.id]);
        expect(await get(live)).toBeNull();
        expect(await stored(dead)).toBeNull();
        expect(await uow.read(({ entries }) => entries.listBySeason(SEASON.id))).toEqual([]);
        expect(
          await uow.read(({ entries }) =>
            entries.findByClientRequest(MEMBER, COMMITMENT, dead.clientRequestId),
          ),
        ).toBeNull();
      });
    });
  });
}
