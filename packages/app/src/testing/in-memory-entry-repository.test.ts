import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { entryId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { createInMemoryEntryRepository } from "./in-memory-entry-repository.ts";

const ENTRY: EntryRecord = {
  id: entryId("entry-1"),
  seasonId: seasonId("season-1"),
  memberId: memberId("member-1"),
  commitmentId: commitmentId("commitment-1"),
  day: seasonDay(2),
  recordedOn: seasonDay(2),
  recordedAt: instant(1),
  value: { kind: "quantity", value: fromInt(30) },
  note: null,
  clientRequestId: "req-1",
  editedAt: null,
  version: 0,
  requestFingerprint: "fp",
  deleted: false,
};
const EDITED: EntryRecord = {
  ...ENTRY,
  value: { kind: "quantity", value: fromInt(45) },
  note: "more",
  editedAt: instant(2),
  version: 1,
};

async function withStored() {
  const repo = createInMemoryEntryRepository();
  await repo.add(ENTRY);
  return repo;
}

describe("in-memory entry repository: get", () => {
  it("returns the stored entry by id, or null", async () => {
    const repo = await withStored();
    expect(await repo.get(ENTRY.id)).toEqual(ENTRY);
    expect(await repo.get(entryId("missing"))).toBeNull();
  });
});

// Deleting blanks the evidence: only the identity, the key and the fingerprint stay.
const TOMBSTONE = { ...ENTRY, value: null, note: null, version: 1, deleted: true };

describe("in-memory entry repository: remove leaves a tombstone", () => {
  it("stages the tombstone: invisible to reads inside the transaction, live only after apply", async () => {
    const repo = await withStored();
    const txn = repo.beginTransaction();

    await txn.repository.remove(ENTRY.id, 0);

    expect(await txn.repository.get(ENTRY.id)).toBeNull();
    expect(await txn.repository.listBySeason(ENTRY.seasonId)).toEqual([]);
    expect(
      await txn.repository.findByClientRequest(ENTRY.memberId, ENTRY.commitmentId, "req-1"),
    ).toEqual(TOMBSTONE);
    expect(await repo.get(ENTRY.id)).toEqual(ENTRY);
    txn.validate();
    txn.apply();
    expect(await repo.get(ENTRY.id)).toBeNull();
    expect(await repo.listBySeason(ENTRY.seasonId)).toEqual([]);
    expect(await repo.findByClientRequest(ENTRY.memberId, ENTRY.commitmentId, "req-1")).toEqual(
      TOMBSTONE,
    );
  });

  it("keeps the idempotency key: the tombstone is found by it and the key cannot be added again", async () => {
    const repo = await withStored();
    await repo.remove(ENTRY.id, 0);

    expect(await repo.findByClientRequest(ENTRY.memberId, ENTRY.commitmentId, "req-1")).toEqual(
      TOMBSTONE,
    );
    expect(await repo.getStored(ENTRY.id)).toEqual(TOMBSTONE);
    expect(await repo.beginTransaction().repository.getStored(ENTRY.id)).toEqual(TOMBSTONE);
    await expect(repo.add({ ...ENTRY, id: entryId("entry-2") })).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
  });

  it("hides only the tombstoned entry from the season's entries", async () => {
    const repo = await withStored();
    const other = { ...ENTRY, id: entryId("entry-2"), clientRequestId: "req-2" };
    await repo.add(other);
    await repo.remove(ENTRY.id, 0);

    expect(await repo.listBySeason(ENTRY.seasonId)).toEqual([other]);
  });

  it("conflicts when the entry moved to another version after it was read", async () => {
    const repo = await withStored();
    const txn = repo.beginTransaction();
    await txn.repository.remove(ENTRY.id, 0);
    await repo.replace(EDITED, 0);

    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
  });

  it("conflicts when the entry is gone or already tombstoned, in a transaction and live", async () => {
    const empty = createInMemoryEntryRepository();
    const txn = empty.beginTransaction();
    await txn.repository.remove(ENTRY.id, 0);
    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
    await expect(empty.remove(ENTRY.id, 0)).rejects.toBeInstanceOf(ConcurrencyConflict);

    const repo = await withStored();
    await repo.remove(ENTRY.id, 0);
    await expect(repo.remove(ENTRY.id, 1)).rejects.toBeInstanceOf(ConcurrencyConflict);
  });

  it("refuses a live removal at a stale version and keeps the entry", async () => {
    const repo = await withStored();
    await repo.replace(EDITED, 0);

    await expect(repo.remove(ENTRY.id, 0)).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
  });

  it("cannot be edited afterwards: a replace of a tombstone conflicts", async () => {
    const repo = await withStored();
    await repo.remove(ENTRY.id, 0);

    await expect(repo.replace({ ...TOMBSTONE, version: 2 } as never, 1)).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
  });
});

describe("in-memory entry repository: replace (by version)", () => {
  it("stages the replacement: visible inside the transaction, live only after apply", async () => {
    const repo = await withStored();
    const txn = repo.beginTransaction();

    await txn.repository.replace(EDITED, 0);

    expect(await txn.repository.get(ENTRY.id)).toEqual(EDITED);
    expect(await txn.repository.listBySeason(ENTRY.seasonId)).toEqual([EDITED]);
    expect(await repo.get(ENTRY.id)).toEqual(ENTRY);
    txn.validate();
    txn.apply();
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
  });

  it("conflicts when the stored version moved on after it was read", async () => {
    const repo = await withStored();
    const txn = repo.beginTransaction();
    await txn.repository.replace(EDITED, 0);

    const other = repo.beginTransaction();
    await other.repository.replace({ ...ENTRY, note: "first", version: 1 }, 0);
    other.validate();
    other.apply();

    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
    expect((await repo.get(ENTRY.id))?.note).toBe("first");
  });

  it("conflicts when the stored entry no longer exists", async () => {
    const repo = createInMemoryEntryRepository();
    const txn = repo.beginTransaction();
    await txn.repository.replace(EDITED, 0);

    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
  });

  it("applies directly on the live repository, with the same check", async () => {
    const repo = await withStored();
    await repo.replace(EDITED, 0);
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
    await expect(repo.replace({ ...EDITED, version: 1 }, 0)).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
  });

  it.each([
    ["seasonId", { seasonId: seasonId("other") }],
    ["memberId", { memberId: memberId("other") }],
    ["commitmentId", { commitmentId: commitmentId("other") }],
    ["day", { day: seasonDay(3) }],
    ["recordedOn", { recordedOn: seasonDay(3) }],
    ["recordedAt", { recordedAt: instant(99) }],
    ["clientRequestId", { clientRequestId: "other" }],
    ["requestFingerprint", { requestFingerprint: "other" }],
    ["deleted", { deleted: true }],
  ] as const)(
    "throws when the immutable %s changes, in a transaction and live",
    async (_field, change) => {
      const repo = await withStored();
      const txn = repo.beginTransaction();
      const tampered = { ...EDITED, ...change } as EntryRecord;

      await expect(txn.repository.replace(tampered, 0)).rejects.toThrow(/immutable field/);
      await expect(repo.replace(tampered, 0)).rejects.toThrow(/immutable field/);
      expect(await repo.get(ENTRY.id)).toEqual(ENTRY);
    },
  );

  it("throws when next.version is not expectedVersion + 1", async () => {
    const repo = await withStored();
    const skipped = { ...EDITED, version: 5 };

    await expect(repo.replace(skipped, 0)).rejects.toThrow(/expectedVersion \+ 1/);
    await expect(repo.beginTransaction().repository.replace(skipped, 0)).rejects.toThrow(
      /expectedVersion \+ 1/,
    );
  });
});
