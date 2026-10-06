import { ConcurrencyConflict, type Habit, habitId, instant, ok, userId } from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const HABIT: Habit = {
  id: habitId("00000000-0000-4000-8000-0000000000d1"),
  ownerId: userId("00000000-0000-4000-8000-0000000000b1"),
  name: "Read",
  why: null,
  category: null,
  icon: null,
  createdAt: instant(1_700_000_000_000),
  version: 0,
};

// Pool >= 2: HP-S8 needs two transactions in flight at once.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await client.end();
  await admin.end();
});

const save = (habit: Habit, expected: number | null) =>
  uow.transaction(async ({ habits }) => {
    await habits.save(habit, expected);
    return ok(undefined);
  });

describe("habit repository on Postgres", () => {
  it("indexes the owner-scoped newest-first list with the id tie-break", async () => {
    const rows = await admin.unsafe(
      "select indexdef from pg_indexes where schemaname = 'pactjoy' and tablename = 'habits' and indexname = 'habits_owner_created_at_idx'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toBe(
      "CREATE INDEX habits_owner_created_at_idx ON pactjoy.habits USING btree (owner_id, created_at DESC, id)",
    );
  });

  it("HP-S8: two concurrent updates at expected version 0, exactly one wins", async () => {
    await save(HABIT, null);

    const results = await Promise.allSettled([
      save({ ...HABIT, name: "A", version: 1 }, 0),
      save({ ...HABIT, name: "B", version: 1 }, 0),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(ConcurrencyConflict) });
    const stored = await uow.read(({ habits }) => habits.get(HABIT.id));
    expect(stored?.version).toBe(1);
  });

  it("HP-S11: a non-uuid id is a raw Error (22P02), not ConcurrencyConflict", async () => {
    const error = await save({ ...HABIT, id: habitId("not-a-uuid") }, null).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConcurrencyConflict);
    expect(error).toMatchObject({ code: "22P02" });
  });

  it("UW-S20: version -1 breaks habits_version_check (23514) and surfaces raw", async () => {
    const error = await save({ ...HABIT, version: -1 }, null).catch((e) => e);

    expect(error).not.toBeInstanceOf(ConcurrencyConflict);
    expect(error).toMatchObject({ code: "23514", constraint_name: "habits_version_check" });
  });

  it("a malformed icon breaks habits_icon_check (23514) and surfaces raw", async () => {
    const error = await save({ ...HABIT, icon: "Bad Icon" }, null).catch((e) => e);

    expect(error).not.toBeInstanceOf(ConcurrencyConflict);
    expect(error).toMatchObject({ code: "23514", constraint_name: "habits_icon_check" });
  });
});
