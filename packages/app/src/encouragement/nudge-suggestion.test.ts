import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, type CommitmentRecord, commitmentId } from "../commitment/commitment.ts";
import {
  ANDREA,
  approvedPause,
  CORRER,
  dateOf,
  feedCircle,
  feedWorld,
  LEER,
  leer,
  MEDITAR,
  meditar,
  minutes,
  VICTOR,
} from "../feed/feed-fixtures.ts";
import { habitId, seasonId, userId } from "../shared/ids.ts";
import {
  circleFixture,
  encouragementFixture,
  memberFixture,
  nudgeDismissalFixture,
} from "../testing/builders.ts";
import { PER_DAY_REACH } from "../testing/entry-measures.ts";
import { type NudgeInput, pickNudge } from "./nudge-suggestion.ts";

const CARLA = memberId("member-carla");

const carlaRun = () =>
  buildCommitment({
    id: commitmentId("commitment-carla"),
    memberId: CARLA,
    habitId: habitId("habit-correr"),
    weightPercent: 100,
    privacy: "visible",
    measure: PER_DAY_REACH,
  });

const victorRun = () =>
  buildCommitment({
    id: CORRER,
    memberId: VICTOR,
    habitId: habitId("habit-correr"),
    weightPercent: 100,
    privacy: "visible",
    measure: PER_DAY_REACH,
  });

const carla = () =>
  memberFixture({ id: CARLA, userId: userId("user-carla"), displayName: "Carla" });

/** Andrea, Victor and Carla, in that order. */
const threeMembers = () =>
  circleFixture({ id: feedCircle().id, members: [...feedCircle().members, carla()] });

const kept = (commitment: CommitmentRecord, days: number[], week = 0) =>
  days.map((d) => minutes(commitment, week * 7 + d, "30"));

interface Options {
  readonly today?: number;
  readonly entries?: NudgeInput["entries"];
  readonly requests?: NudgeInput["requests"];
  readonly viewer?: "victor" | "andrea";
  readonly sent?: NudgeInput["sent"];
  readonly dismissed?: NudgeInput["dismissed"];
  readonly circle?: NudgeInput["circle"];
  readonly commitments?: readonly CommitmentRecord[];
  readonly status?: "active" | "closed";
}

/**
 * By default Andrea kept 2 of 7 Meditar and 0 of 1 Leer in week 1 (2 of 8: a hard week), and
 * Victor, the viewer, kept nothing of his own. The clock reads day 8, when week 1 turns final.
 */
function pick(options: Options = {}) {
  const today = options.today ?? 8;
  const world = feedWorld({
    today,
    entries: options.entries ?? kept(meditar(), [0, 1]),
    requests: options.requests ?? [],
    commitments: options.commitments ?? [meditar(), leer(), victorRun()],
    status: options.status ?? "active",
  });
  return pickNudge({
    season: world.season,
    actualStart: world.actualStart,
    today: world.today,
    todayDate: dateOf(today),
    circle: options.circle ?? feedCircle(),
    viewerId: options.viewer === "andrea" ? ANDREA : VICTOR,
    entries: world.entries,
    requests: world.requests,
    sent: options.sent ?? [],
    dismissed: options.dismissed ?? [],
  });
}

describe("pickNudge: when a member has a case (owner rule: below half of a closed week)", () => {
  it("suggests the member whose latest final week was below half, with the week 1-based", () => {
    expect(pick()).toEqual({ targetId: ANDREA, week: 1, commitmentId: MEDITAR });
  });

  it("exactly half is not hard (2 * kept = counted)", () => {
    // 3 of 7 Meditar + 1 of 1 Leer = 4 of 8.
    expect(pick({ entries: [...kept(meditar(), [0, 1, 2]), minutes(leer(), 2, "10")] })).toBeNull();
  });

  it("one session short of half is hard (3 of 8)", () => {
    expect(pick({ entries: [...kept(meditar(), [0, 1]), minutes(leer(), 2, "10")] })).toMatchObject(
      { targetId: ANDREA },
    );
  });

  it("never offers an open week (still inside its grace period)", () => {
    expect(pick({ today: 7 })).toBeNull();
  });

  describe("a sparse schedule does not close its week early", () => {
    // Andrea works one scheduled day a week and missed it: the engine calls the week final on
    // day 6 (its last day), but the week only closes with its grace, on day 8.
    const mondaysOnly = meditar({
      measure: {
        ...meditar().measure,
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0] } },
      },
    });
    const sparse = (today: number) =>
      pick({ today, entries: [], commitments: [mondaysOnly, victorRun()] });

    it.each([5, 6, 7])("offers nothing on day %i", (today) => {
      expect(sparse(today)).toBeNull();
    });

    it("offers the case from day 8", () => {
      expect(sparse(8)).toEqual({ targetId: ANDREA, week: 1, commitmentId: MEDITAR });
    });
  });

  it("never offers a week that was fully paused (nothing counted)", () => {
    const pause = approvedPause({
      startDay: seasonDay(0),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      decidedOn: seasonDay(0),
      commitments: [
        { commitmentId: MEDITAR, resumedOn: null, resumedAt: null },
        { commitmentId: LEER, resumedOn: null, resumedAt: null },
      ],
    });
    expect(pick({ requests: [pause], commitments: [meditar(), leer()] })).toBeNull();
  });

  it("lives on the season's LATEST final week only: an older hard week is gone", () => {
    // Week 1 was hard, but by day 15 week 2 is final too, and Andrea kept all of it.
    const week2 = [...kept(meditar(), [0, 1, 2, 3, 4, 5, 6], 1), minutes(leer(), 9, "10")];
    expect(pick({ today: 15, entries: [...kept(meditar(), [0, 1]), ...week2] })).toBeNull();
  });

  it("a new hard week in the latest final week is a new case (week 2)", () => {
    const week1 = [...kept(meditar(), [0, 1, 2, 3, 4, 5, 6]), minutes(leer(), 2, "10")];
    expect(pick({ today: 15, entries: [...week1, ...kept(meditar(), [0], 1)] })).toEqual({
      targetId: ANDREA,
      week: 2,
      commitmentId: MEDITAR,
    });
  });

  it("is never offered for a season that is not active", () => {
    expect(pick({ status: "closed" })).toBeNull();
  });

  it("is never offered for a member with no commitment in the season", () => {
    expect(pick({ commitments: [victorRun()] })).toBeNull();
  });
});

describe("pickNudge: who may be suggested", () => {
  it("never the viewer: Andrea's own hard week is not offered to Andrea", () => {
    expect(pick({ viewer: "andrea", commitments: [meditar(), leer()] })).toBeNull();
  });

  it("another member is offered to the viewer (Victor's week is hard too)", () => {
    expect(pick({ viewer: "andrea" })).toEqual({ targetId: VICTOR, week: 1, commitmentId: CORRER });
  });

  it("never a member who left", () => {
    // Andrea left but Victor and Carla are active, so the circle still has two members.
    const withoutAndrea = circleFixture({
      id: feedCircle().id,
      members: [...feedCircle({ andrea: true }).members, carla()],
    });
    expect(pick({ circle: withoutAndrea, viewer: "victor" })).toBeNull();
  });

  it("never in a circle with fewer than two active members", () => {
    expect(pick({ circle: feedCircle({ victor: true }), viewer: "andrea" })).toBeNull();
  });

  it("goes by circle member order, not by who struggled most", () => {
    const circle = circleFixture({
      id: feedCircle().id,
      members: [carla(), ...feedCircle().members],
    });
    // Carla (first in the circle) kept 1 of 7; Andrea kept 0 of 8 (a worse week). Carla still goes first.
    expect(
      pick({
        circle,
        commitments: [meditar(), leer(), victorRun(), carlaRun()],
        entries: kept(carlaRun(), [0]),
      }),
    ).toMatchObject({ targetId: CARLA, week: 1 });
  });
});

describe("pickNudge: the subject is the commitment with the most unkept opportunities (D1)", () => {
  it("picks the commitment with the most unkept ones", () => {
    // Meditar kept 2 of 7 (5 unkept), Leer 0 of 1 (1 unkept).
    expect(pick()?.commitmentId).toBe(MEDITAR);
  });

  it("a tie goes to the first commitment in season order", () => {
    const other = buildCommitment({ ...leer(), id: commitmentId("commitment-other") });
    // Two weekly totals, none kept: 1 unkept each.
    expect(pick({ commitments: [leer(), other, victorRun()], entries: [] })?.commitmentId).toBe(
      LEER,
    );
    expect(pick({ commitments: [other, leer(), victorRun()], entries: [] })?.commitmentId).toBe(
      other.id,
    );
  });
});

describe("pickNudge: what has already happened (F13, F15)", () => {
  const sent = (overrides: Parameters<typeof encouragementFixture>[0] = {}) =>
    encouragementFixture({
      seasonId: seasonId("season-1"),
      senderId: VICTOR,
      recipientId: ANDREA,
      caseWeek: 1,
      sentOn: dateOf(8),
      ...overrides,
    });
  const dismissed = (overrides: Parameters<typeof nudgeDismissalFixture>[0] = {}) =>
    nudgeDismissalFixture({
      seasonId: seasonId("season-1"),
      viewerId: VICTOR,
      targetId: ANDREA,
      caseWeek: 1,
      dismissedOn: dateOf(8),
      ...overrides,
    });
  const everyone = [meditar(), leer(), victorRun(), carlaRun()];

  it("hides a case the viewer dismissed, for good (any later day)", () => {
    expect(pick({ today: 9, dismissed: [dismissed()] })).toBeNull();
  });

  it("a dismissal of another week or another member leaves the case alone", () => {
    expect(pick({ today: 9, dismissed: [dismissed({ caseWeek: 5 })] })).toMatchObject({
      targetId: ANDREA,
    });
    expect(pick({ today: 9, dismissed: [dismissed({ targetId: CARLA })] })).toMatchObject({
      targetId: ANDREA,
    });
  });

  it("hides a case the viewer already answered with an encouragement", () => {
    expect(pick({ today: 9, sent: [sent()] })).toBeNull();
  });

  it("strict daily rule: after sending to anyone today, no suggestion today", () => {
    expect(
      pick({
        circle: threeMembers(),
        commitments: everyone,
        sent: [sent({ recipientId: CARLA })],
      }),
    ).toBeNull();
  });

  it("strict daily rule: after dismissing anything today, no suggestion today; the next day the next case shows", () => {
    const circle = threeMembers();
    expect(pick({ circle, commitments: everyone, dismissed: [dismissed()] })).toBeNull();
    expect(
      pick({ circle, commitments: everyone, today: 9, dismissed: [dismissed()] }),
    ).toMatchObject({ targetId: CARLA });
  });

  it("yesterday's send does not block today", () => {
    expect(
      pick({ circle: threeMembers(), commitments: everyone, today: 9, sent: [sent()] }),
    ).toMatchObject({ targetId: CARLA });
  });

  it("is a pure function of its inputs", () => {
    expect(pick()).toEqual(pick());
  });
});
