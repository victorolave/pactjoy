import {
  type Actor,
  createHabit,
  type IdGenerator,
  instant,
  type Repositories,
  type UnitOfWork,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const client = createClient({ url: databaseUrl(), max: 2 });
const admin = connect(databaseUrl());
// The Postgres adapter binds only habits, circles and seasons; createHabit touches only habits.
const uow = createUnitOfWork(client.begin, bindRepositories) as unknown as UnitOfWork<Repositories>;
afterAll(async () => {
  await client.end();
  await admin.end();
});

const actor: Actor = { userId: userId("00000000-0000-4000-8000-0000000000b1") };
const ids: IdGenerator = { next: () => "00000000-0000-4000-8000-0000000000d1" };
const deps = { uow, ids, clock: { now: () => instant(1_700_000_000_000) } };

const habitCount = async () => (await admin`select count(*)::int as n from pactjoy.habits`)[0]?.n;

// Entries have no Postgres repository yet, so the entry note itself cannot run through
// the database. A habit's name/why/category go through the same `isStorableText` guard.
describe("storable text on Postgres", () => {
  it("Postgres itself rejects NUL in text with 22021: the guard is what keeps it out", async () => {
    const error = await admin`select ${"a\u0000b"}::text`.catch((e) => e);

    expect(error).toMatchObject({ code: "22021" });
  });

  it.each([
    ["name", { name: "Read\u0000" }],
    ["why", { name: "Read", why: "be\u0000tter" }],
    ["category", { name: "Read", category: "\u0000" }],
  ])(
    "a NUL in the habit %s is rejected by the use case and nothing is written",
    async (_field, input) => {
      const result = await createHabit(deps, actor, input);

      expect(result.ok).toBe(false);
      expect(await habitCount()).toBe(0);
    },
  );

  it("accepts the same text without the NUL", async () => {
    const result = await createHabit(deps, actor, { name: "Read" });

    expect(result.ok).toBe(true);
    expect(await habitCount()).toBe(1);
  });
});
