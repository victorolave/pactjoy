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
};
const EDITED: EntryRecord = {
  ...ENTRY,
  value: { kind: "quantity", value: fromInt(45) },
  note: "more",
  editedAt: instant(2),
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

describe("in-memory entry repository: replace (compare-and-swap)", () => {
  it("stages the replacement: visible inside the transaction, live only after apply", async () => {
    const repo = await withStored();
    const txn = repo.beginTransaction();

    await txn.repository.replace(EDITED, ENTRY);

    expect(await txn.repository.get(ENTRY.id)).toEqual(EDITED);
    expect(await txn.repository.listBySeason(ENTRY.seasonId)).toEqual([EDITED]);
    expect(await repo.get(ENTRY.id)).toEqual(ENTRY);
    txn.validate();
    txn.apply();
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
  });

  it.each([
    ["value", { value: { kind: "quantity", value: fromInt(31) } }],
    ["kind", { value: { kind: "missed" } }],
    ["note", { note: "first" }],
    ["editedAt", { editedAt: instant(3) }],
  ] as const)("conflicts when only the %s was edited after it was read", async (_field, change) => {
    const repo = await withStored();
    const txn = repo.beginTransaction();
    await txn.repository.replace(EDITED, ENTRY);

    const other = repo.beginTransaction();
    await other.repository.replace({ ...ENTRY, ...change }, ENTRY);
    other.validate();
    other.apply();

    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
    expect(await repo.get(ENTRY.id)).toEqual({ ...ENTRY, ...change });
  });

  it("conflicts when the stored entry no longer exists", async () => {
    const repo = createInMemoryEntryRepository();
    const txn = repo.beginTransaction();
    await txn.repository.replace(EDITED, ENTRY);

    expect(() => txn.validate()).toThrow(ConcurrencyConflict);
  });

  it("applies directly on the live repository, with the same check", async () => {
    const repo = await withStored();
    await repo.replace(EDITED, ENTRY);
    expect(await repo.get(ENTRY.id)).toEqual(EDITED);
    await expect(repo.replace(EDITED, ENTRY)).rejects.toBeInstanceOf(ConcurrencyConflict);
  });
});
