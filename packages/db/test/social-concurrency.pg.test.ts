import {
  buildCommitment,
  circleId,
  commitmentId,
  createIntlTimeZone,
  createUuidV7IdGenerator,
  dismissNudge,
  habitId,
  instant,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  sendEncouragement,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

// The social writes take the circle and season read-set guard (D5), a FOR NO KEY UPDATE lock held
// to commit. Under READ COMMITTED that is what serializes two writers of the same case: the second
// one blocks at the guard and then reads the first one's rows. Without it both pass the eligibility
// check on the same pre-race view and BOTH take effect. ADR-0018, F13 to F15.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** 2026-10-10T15:00:00Z: noon in Bogota on season day 10 (day 1 is 2026-10-01): Andrea's week 1 is closed. */
const NOW = instant(Date.UTC(2026, 9, 10, 15));
const timeZone = createIntlTimeZone();

const ANDREA = { id: memberId(uuid(0xa1)), userId: userId(uuid(0xb1)) };
const VICTOR = { id: memberId(uuid(0xa2)), userId: userId(uuid(0xb2)) };

const member = (who: typeof ANDREA, name: string) => ({
  id: who.id,
  userId: who.userId,
  displayName: name,
  status: "active" as const,
  joinedAt: NOW,
  leftAt: null,
  erasedAt: null,
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
const commitment = (id: number, owner: typeof ANDREA, habit: number) =>
  buildCommitment({
    id: commitmentId(uuid(id)),
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
  commitments: [commitment(0xc01, ANDREA, 0xd1), commitment(0xc02, VICTOR, 0xd2)],
  approvals: [],
  pactClosedAt: NOW,
  pactRevision: 0,
  createdAt: NOW,
  version: 0,
};

// Pool >= 2: every case runs two transactions at once.
const client = createClient({ url: databaseUrl(), max: 6 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
const clock = { now: () => NOW };
const deps = { uow, clock, timeZone, ids: createUuidV7IdGenerator({ clock }) };
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});

/** Bounded repetitions: overlap is timing-dependent, the invariants are not. */
const ITERATIONS = 15;

/** Andrea logged nothing in week 1: a hard week, final since day 9, and Victor's live case. */
async function given() {
  await truncateAll(admin);
  await uow.transaction(async (repos) => {
    await repos.circles.save(CIRCLE, null);
    await repos.seasons.save(SEASON, null);
    return ok(undefined);
  });
}

const send = () =>
  sendEncouragement(deps, VICTOR, {
    seasonId: SEASON.id,
    recipientId: ANDREA.id,
    week: 1,
    emoji: "heart",
  });
const dismiss = () =>
  dismissNudge(deps, VICTOR, { seasonId: SEASON.id, targetId: ANDREA.id, week: 1 });

describe("social writes on Postgres: concurrency (ADR-0018, F13 to F15)", () => {
  it("SO-C1: a send and a dismissal of the same case at once: exactly one takes effect", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const [sent, dismissed] = await Promise.all([send(), dismiss()]);

      // The first to take the lock wins; the second reads its row and finds no live case.
      expect([sent.ok, dismissed.ok].filter(Boolean)).toHaveLength(1);
      const loser = sent.ok ? dismissed : sent;
      expect(loser).toEqual({ ok: false, error: { kind: "NudgeNotAvailable" } });
      const [encouragements] = await admin`select count(*)::int as n from pactjoy.encouragements`;
      const [dismissals] = await admin`select count(*)::int as n from pactjoy.nudge_dismissals`;
      expect((encouragements?.n ?? 0) + (dismissals?.n ?? 0)).toBe(1);
    }
  });

  it("SO-C2: two sends of the same case at once: one row, the other refused", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const race = await Promise.all([send(), send()]);

      expect(race.filter((r) => r.ok)).toHaveLength(1);
      const [encouragements] = await admin`select count(*)::int as n from pactjoy.encouragements`;
      expect(encouragements?.n).toBe(1);
      // The loser's push rolled back with its encouragement.
      const [notices] = await admin`select count(*)::int as n from pactjoy.notification_outbox`;
      expect(notices?.n).toBe(1);
    }
  });

  it("SO-C3: a send stores the recipient's push in the same transaction, ids only (F17)", async () => {
    await given();

    expect((await send()).ok).toBe(true);

    const [encouragement] = await admin`select id from pactjoy.encouragements`;
    const notices = await admin`
      select dedupe_key, kind, params, recipient_member_id, rollovers_left
      from pactjoy.notification_outbox`;
    expect(notices).toEqual([
      {
        dedupe_key: `encouragement:${encouragement?.id}`,
        kind: "encouragementNudge",
        params: { seasonId: SEASON.id, encouragementId: encouragement?.id },
        recipient_member_id: ANDREA.id,
        rollovers_left: 0,
      },
    ]);
  });
});
