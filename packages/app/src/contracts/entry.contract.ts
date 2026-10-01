import { frac, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord, EntryValue } from "../entry/entry.ts";
import type { Repositories } from "../ports/repositories.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryId, type SeasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import { type ContractSubject, SEASON, seedCircleAndSeason } from "./fixtures.ts";

type EntryRepositories = Pick<Repositories, "circles" | "seasons" | "entries">;
type Uow = ContractSubject<EntryRepositories>["uow"];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const MEMBER = memberId(uuid(0xa1));
const COMMITMENT = commitmentId(uuid(0x301));
const DONE: EntryValue = { kind: "done" };

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
  deleted: false,
  ...options,
});

/**
 * `EntryRepository` add/read contract (EP-S1..S4, S6, S8..S9 live half, S11,
 * S12, S25..S27, S30, S31, S33), adapter-neutral. Tombstone cases need
 * `remove` and land with it (B6b). The factory must return an EMPTY store;
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
  });
}
