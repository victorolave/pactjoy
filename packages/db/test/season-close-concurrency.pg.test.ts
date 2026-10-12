import {
  buildCommitment,
  circleId,
  commitmentId,
  createIntlTimeZone,
  createSeason,
  createUuidV7IdGenerator,
  habitId,
  instant,
  localDate,
  memberId,
  ok,
  type ReviewRecord,
  type Season,
  seasonId,
  submitSeasonClosure,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** 2026-10-30T15:00:00Z: noon in Bogota on season day 30 (day 1 is 2026-10-01): the results day of a 4-week season. */
const NOW = instant(Date.UTC(2026, 9, 30, 15));
/** Seven days later: the stale day (L*7+8 = 36). */
const STALE_NOW = instant(Date.UTC(2026, 10, 5, 15));
const timeZone = createIntlTimeZone();

const ANDREA = { id: memberId(uuid(0xa1)), user: { userId: userId(uuid(0xb1)) } };
const VICTOR = { id: memberId(uuid(0xa2)), user: { userId: userId(uuid(0xb2)) } };
const C_ANDREA = commitmentId(uuid(0xc01));
const C_VICTOR = commitmentId(uuid(0xc02));

const member = (who: typeof ANDREA, name: string) => ({
  id: who.id,
  userId: who.user.userId,
  displayName: name,
  status: "active" as const,
  joinedAt: NOW,
  leftAt: null,
});
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "C",
  members: [member(ANDREA, "Andrea"), member(VICTOR, "Victor")],
  invite: null,
  createdAt: NOW,
  archivedAt: null,
  version: 0,
};
const commitment = (id: typeof C_ANDREA, owner: typeof ANDREA, habit: number) =>
  buildCommitment({
    id,
    memberId: owner.id,
    habitId: habitId(uuid(habit)),
    weightPercent: 100,
    privacy: "visible",
    measure: {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    },
  });
const SEASON: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: CIRCLE.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: localDate("2026-10-01"),
  lengthWeeks: 4,
  reviewCadenceWeeks: 2,
  status: "active",
  commitments: [commitment(C_ANDREA, ANDREA, 0xd1), commitment(C_VICTOR, VICTOR, 0xd2)],
  approvals: [],
  pactClosedAt: null,
  pactRevision: 0,
  createdAt: NOW,
  version: 0,
};

const closingReview = (owner: typeof ANDREA, id: number, on: typeof C_ANDREA): ReviewRecord => ({
  id: uuid(id) as ReviewRecord["id"],
  seasonId: SEASON.id,
  memberId: owner.id,
  periodIndex: 2,
  kind: "closing",
  status: "completed",
  srbai: "full",
  reflection: { helped: null, hard: null },
  responses: [{ commitmentId: on, items: [4, 4, 4, 4] }],
  recordedAt: NOW,
  version: 0,
});

// Pool >= 2: every case runs two transactions at once.
const client = createClient({ url: databaseUrl(), max: 6 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
const depsAt = (now: typeof NOW) => {
  const clock = { now: () => now };
  return { uow, clock, timeZone, ids: createUuidV7IdGenerator({ clock }) };
};
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});

/** Bounded repetitions: overlap is timing-dependent, the invariants are not. */
const ITERATIONS = 15;

async function given() {
  await truncateAll(admin);
  await uow.transaction(async (repos) => {
    await repos.circles.save(CIRCLE, null);
    await repos.seasons.save(SEASON, null);
    await repos.reviews.save(closingReview(ANDREA, 0xf1, C_ANDREA), null);
    await repos.reviews.save(closingReview(VICTOR, 0xf2, C_VICTOR), null);
    return ok(undefined);
  });
}

const close = (who: typeof ANDREA, commitmentOf: typeof C_ANDREA, now = NOW) =>
  submitSeasonClosure(depsAt(now), who.user, {
    seasonId: SEASON.id,
    decisions: [{ commitmentId: commitmentOf, decision: "continue" }],
  });

describe("season closure on Postgres: concurrency (ADR-0015, C6)", () => {
  it("SC-F6: the two last closers at once: both closures stored, the season closed once", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const race = await Promise.all([close(ANDREA, C_ANDREA), close(VICTOR, C_VICTOR)]);

      expect(race.every((r) => r.ok)).toBe(true);
      expect(race.filter((r) => r.ok && r.value.seasonClosed)).toHaveLength(1);
      const [closures] = await admin`select count(*)::int as n from pactjoy.season_closures`;
      expect(closures?.n).toBe(2);
      const [season] = await admin`select status, version from pactjoy.seasons`;
      expect(season).toMatchObject({ status: "closed", version: 1 });
    }
  });

  it("SC-F7: createSeason (stale) against a laggard's closure: one wins, never two active seasons", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();
      // Andrea has closed; Victor is the laggard, racing the stale createSeason.
      expect((await close(ANDREA, C_ANDREA)).ok).toBe(true);

      const race = await Promise.allSettled([
        close(VICTOR, C_VICTOR, STALE_NOW),
        createSeason(depsAt(STALE_NOW), ANDREA.user, {
          circleId: CIRCLE.id,
          timezone: "America/Bogota",
          startDate: "2026-11-05",
          lengthWeeks: 4,
        }),
      ]);

      // Whatever the order, at most one season is open, and the old one ends closed once.
      const [open] =
        await admin`select count(*)::int as n from pactjoy.seasons where status <> 'closed'`;
      expect(open?.n).toBeLessThanOrEqual(1);
      const [old] = await admin`select status from pactjoy.seasons where id = ${SEASON.id}`;
      expect(old?.status).toBe("closed");
      const created = race[1];
      const victor = race[0];
      if (created?.status === "fulfilled" && created.value.ok) {
        // The new season won: Victor's closure is refused or conflicted, and nothing of his is stored
        // unless his closure had already committed before it.
        if (victor?.status === "fulfilled" && victor.value.ok) {
          const [v] =
            await admin`select count(*)::int as n from pactjoy.season_closures where member_id = ${VICTOR.id}`;
          expect(v?.n).toBe(1);
        }
      }
    }
  });
});
