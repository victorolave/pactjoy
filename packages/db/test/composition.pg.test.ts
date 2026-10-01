import {
  addCommitment,
  approvePact,
  ConcurrencyConflict,
  createCircle,
  createHabit,
  createIntlTimeZone,
  createSeason,
  createUuidV7IdGenerator,
  habitId,
  instant,
  memberScore,
  recordEntry,
  userId,
} from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresUnitOfWork } from "../src/index.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";
import { createFreshDatabase } from "./migrate.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00Z
const clock = { now: () => NOW };
const ids = createUuidV7IdGenerator({ clock });
const timeZone = createIntlTimeZone();
const andrea = { userId: userId(ids.next()) };

const uow = createPostgresUnitOfWork({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const must = <T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T => {
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
};

beforeEach(() => truncateAll(admin));
afterAll(async () => {
  await uow.end();
  await admin.end();
});

describe("createPostgresUnitOfWork", () => {
  it("DC-S1: exposes transaction and read over every repository", async () => {
    expect(Object.keys(uow).sort()).toEqual(["end", "read", "transaction"]);
    const names = await uow.read(async (repos) => Object.keys(repos).sort());
    expect(names).toEqual(["circles", "entries", "habits", "pauses", "seasons"]);
  });

  it("DC-S3/S10: createCircle and createHabit succeed with v7 ids that uuid columns accept", async () => {
    const circle = must(await createCircle({ uow, ids, clock }, andrea, { name: "Rio Runners" }));
    const habit = must(await createHabit({ uow, ids, clock }, andrea, { name: "Run" }));
    expect(circle.id).toMatch(UUID_V7);
    expect(habit.id).toMatch(UUID_V7);
    expect(await uow.read((repos) => repos.circles.get(circle.id))).toEqual(circle);
  });

  it("DC-S13: runs the real use cases end to end and scores with no pauses", async () => {
    const deps = { uow, ids, clock, timeZone };
    const circle = must(await createCircle(deps, andrea, { name: "Rio Runners" }));
    const created = must(
      await createSeason(deps, andrea, {
        circleId: circle.id,
        timezone: "UTC",
        startDate: "2025-09-28",
        lengthWeeks: 8,
      }),
    );
    const withCommitment = must(
      await addCommitment(deps, andrea, {
        seasonId: created.id,
        habitId: habitId(ids.next()),
        weightPercent: 100,
        privacy: "visible",
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
    );
    const active = must(await approvePact(deps, andrea, { seasonId: created.id }));
    expect(active.status).toBe("active");
    const commitment = withCommitment.commitments[0];
    if (!commitment) throw new Error("commitment missing");

    must(
      await recordEntry(deps, andrea, {
        seasonId: created.id,
        commitmentId: commitment.id,
        value: { kind: "done" },
        clientRequestId: "req-1",
      }),
    );
    const score = must(await memberScore(deps, andrea, { seasonId: created.id }));

    expect(score).toMatchObject({ kind: "scored", scope: "own" });
    expect(await uow.read((repos) => repos.pauses.listBySeason(created.id))).toEqual([]);
  });

  it("DC-S4: runs on a driver with prepared statements disabled (transaction-pooler safe)", async () => {
    const [row] = await admin.unsafe("select current_setting('server_version_num')::int as v");
    expect(row?.v).toBeGreaterThanOrEqual(170000);
    // Re-using one tiny pool for many transactions would fail with
    // "prepared statement already exists" if prepare were on.
    const single = createPostgresUnitOfWork({ url: databaseUrl(), max: 1 });
    try {
      for (let i = 0; i < 3; i++)
        await single.read((repos) => repos.habits.get(habitId(ids.next())));
    } finally {
      await single.end();
    }
  });

  it("DC-S5: an unreachable database rejects with a plain Error, not ConcurrencyConflict", async () => {
    const dead = createPostgresUnitOfWork({
      url: "postgres://u:p@127.0.0.1:1/none",
      connectTimeoutSeconds: 2,
    });
    try {
      const failure = await dead.read(async () => 1).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(ConcurrencyConflict);
    } finally {
      await dead.end();
    }
  });

  it("DC-S6: an unmigrated database surfaces the raw 42P01", async () => {
    const empty = await createFreshDatabase(databaseUrl());
    const bare = createPostgresUnitOfWork({ url: empty.url });
    try {
      await expect(
        bare.read((repos) => repos.habits.get(habitId(ids.next()))),
      ).rejects.toMatchObject({
        code: "42P01",
      });
    } finally {
      await bare.end();
      await empty.drop();
    }
  });

  it("DC-S7: an empty URL throws at the factory call", () => {
    expect(() => createPostgresUnitOfWork({ url: "" })).toThrow(/url/i);
  });
});
