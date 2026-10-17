import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import { habitId } from "../shared/ids.ts";
import { habitFixture } from "../testing/builders.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { LIMIT } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import { deriveFeed } from "./derive-feed.ts";
import {
  ANDREA,
  approvedPause,
  CORRER,
  correr,
  dateOf,
  entryFor,
  feedWorld,
  HABITS,
  LEER,
  leer,
  MEDITAR,
  meditar,
  minutes,
  missed,
  VICTOR,
} from "./feed-fixtures.ts";
import type { FeedRecord } from "./feed-record.ts";

function find<K extends FeedRecord["kind"]>(records: readonly FeedRecord[], kind: K) {
  return records.filter((r): r is Extract<FeedRecord, { kind: K }> => r.kind === kind);
}

const keysOf = (records: readonly FeedRecord[]) => records.map((r) => r.key).sort();

describe("deriveFeed: completed sessions (ADR-0018, F4)", () => {
  it("yields one item for a kept per-session opportunity, keyed by commitment and 1-based day", () => {
    const recordedAt = localInstant(dateOf(0), 9 * 3_600_000);
    const world = feedWorld({ entries: [minutes(meditar(), 0, "30", { recordedAt })], today: 1 });
    expect(find(deriveFeed(world), "completed")).toEqual([
      {
        kind: "completed",
        key: `session:${MEDITAR}:1`,
        onDate: dateOf(0),
        at: recordedAt,
        memberId: ANDREA,
        commitmentId: MEDITAR,
        amount: fromInt(30),
      },
    ]);
  });

  it("yields nothing below the minimum, for a zero quantity or for a missed entry", () => {
    const world = feedWorld({
      entries: [minutes(meditar(), 0, "9"), minutes(meditar(), 1, "0"), missed(meditar(), 2)],
      today: 3,
    });
    expect(find(deriveFeed(world), "completed")).toEqual([]);
  });

  it("sums same-day entries (D4) before judging, and stamps the latest recordedAt", () => {
    const early = minutes(meditar(), 0, "6", { id: "e-1", recordedAt: instant(1_000) });
    const late = minutes(meditar(), 0, "6", { id: "e-2", recordedAt: instant(5_000) });
    const [item] = find(deriveFeed(feedWorld({ entries: [early, late], today: 1 })), "completed");
    expect(item).toMatchObject({
      key: `session:${MEDITAR}:1`,
      at: instant(5_000),
      amount: fromInt(12),
    });
  });

  it("a deleted and relogged entry keeps the same key (the opportunity is the unit)", () => {
    const first = deriveFeed(feedWorld({ entries: [minutes(meditar(), 0, "30", { id: "old" })] }));
    const again = deriveFeed(feedWorld({ entries: [minutes(meditar(), 0, "40", { id: "new" })] }));
    expect(find(first, "completed")[0]?.key).toBe(find(again, "completed")[0]?.key);
  });

  it("weekly-total commitments produce no per-entry item", () => {
    const world = feedWorld({
      entries: [minutes(leer(), 0, "30"), minutes(leer(), 1, "30")],
      today: 2,
    });
    expect(find(deriveFeed(world), "completed")).toEqual([]);
  });

  it("a limit commitment completes while within the tolerance, not beyond it", () => {
    const limit = buildCommitment({
      id: commitmentId("commitment-limit"),
      memberId: ANDREA,
      habitId: habitId("habit-meditar"),
      weightPercent: 100,
      privacy: "visible",
      measure: LIMIT,
    });
    const world = feedWorld({
      commitments: [limit],
      entries: [minutes(limit, 0, "2"), minutes(limit, 1, "4"), minutes(limit, 2, "5")],
      today: 3,
    });
    expect(find(deriveFeed(world), "completed").map((r) => r.key)).toEqual([
      `session:${limit.id}:1`,
      `session:${limit.id}:2`,
    ]);
  });

  it("a done commitment completes with no amount; surplus sessions still complete", () => {
    const done = buildCommitment({
      id: CORRER,
      memberId: VICTOR,
      habitId: habitId("habit-correr"),
      weightPercent: 100,
      privacy: "visible",
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
    });
    const world = feedWorld({
      commitments: [done],
      entries: [0, 1, 2, 3].map((day) => entryFor(done, day)),
      today: 4,
    });
    const items = find(deriveFeed(world), "completed");
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.amount === null)).toBe(true);
  });

  it("carries no note, photo or entry id", () => {
    const entry = { ...minutes(meditar(), 0, "30"), note: "SENTINEL_NOTE" };
    const json = JSON.stringify(deriveFeed(feedWorld({ entries: [entry] })), (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(json).not.toContain("SENTINEL_NOTE");
    expect(json).not.toContain(entry.id);
  });
});

describe("deriveFeed: consistent week (F5)", () => {
  const fullWeek = (week: number) =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => minutes(meditar(), week * 7 + d, "30"));

  it("appears once the week is final and every counted opportunity was kept", () => {
    const world = feedWorld({ entries: [...fullWeek(0), minutes(leer(), 2, "10")], today: 8 });
    const weeks = find(deriveFeed(world), "consistentWeek");
    expect(weeks.map((w) => w.key).sort()).toEqual([`week:${LEER}:1`, `week:${MEDITAR}:1`]);
    expect(weeks.find((w) => w.commitmentId === MEDITAR)).toMatchObject({
      onDate: dateOf(8),
      at: null,
      week: 1,
      kept: 7,
      counted: 7,
      memberId: ANDREA,
    });
  });

  it("is absent while the week is still inside its grace period", () => {
    expect(
      find(deriveFeed(feedWorld({ entries: fullWeek(0), today: 7 })), "consistentWeek"),
    ).toEqual([]);
  });

  it("is absent with 6 of 7 kept", () => {
    const entries = fullWeek(0).slice(0, 6);
    expect(find(deriveFeed(feedWorld({ entries, today: 8 })), "consistentWeek")).toEqual([]);
  });
});

describe("deriveFeed: comeback (F6)", () => {
  it("is the first entry after 3 active empty days, keyed by member and 1-based day", () => {
    const entries = [
      minutes(meditar(), 0, "30"),
      minutes(meditar(), 4, "30", { recordedAt: instant(7_000) }),
    ];
    const items = find(
      deriveFeed(feedWorld({ commitments: [meditar()], entries, today: 5 })),
      "comeback",
    );
    expect(items).toEqual([
      {
        kind: "comeback",
        key: `comeback:${ANDREA}:5`,
        onDate: dateOf(4),
        at: instant(7_000),
        memberId: ANDREA,
      },
    ]);
  });

  it("does not count paused days toward the gap", () => {
    const pause = approvedPause({
      startDay: seasonDay(1),
      end: { kind: "fixed", lastDay: seasonDay(3) },
      decidedOn: seasonDay(1),
    });
    const entries = [minutes(meditar(), 0, "30"), minutes(meditar(), 4, "30")];
    const world = feedWorld({ commitments: [meditar()], entries, requests: [pause], today: 5 });
    expect(find(deriveFeed(world), "comeback")).toEqual([]);
  });

  it("two empty days are not a comeback", () => {
    const entries = [minutes(meditar(), 0, "30"), minutes(meditar(), 3, "30")];
    expect(
      find(deriveFeed(feedWorld({ commitments: [meditar()], entries, today: 4 })), "comeback"),
    ).toEqual([]);
  });

  it("comeback and completed are independent items for the same day", () => {
    const entries = [minutes(meditar(), 0, "30"), minutes(meditar(), 5, "30")];
    const records = deriveFeed(feedWorld({ commitments: [meditar()], entries, today: 6 }));
    expect(keysOf(records)).toEqual(
      expect.arrayContaining([`comeback:${ANDREA}:6`, `session:${MEDITAR}:6`]),
    );
  });
});

describe("deriveFeed: pauses (F7)", () => {
  it("an approved effective request yields a pause item and a recalculation item", () => {
    const decidedAt = localInstant(dateOf(2), 10 * 3_600_000);
    const request = approvedPause({ decidedAt, decidedOn: seasonDay(2), reason: "travel" });
    const records = deriveFeed(feedWorld({ requests: [request], today: 3 }));
    expect(find(records, "paused")).toEqual([
      {
        kind: "paused",
        key: "pause:pause-1",
        onDate: dateOf(2),
        at: decidedAt,
        memberId: ANDREA,
        commitmentIds: [MEDITAR],
        reason: "travel",
      },
    ]);
    expect(find(records, "pointsRecalculated")).toEqual([
      {
        kind: "pointsRecalculated",
        key: "recalc:pause-1",
        onDate: dateOf(2),
        at: decidedAt,
        memberId: ANDREA,
        commitmentIds: [MEDITAR],
      },
    ]);
  });

  it("a scope-all request lists every commitment it really covers", () => {
    const request = approvedPause({
      commitments: [
        { commitmentId: MEDITAR, resumedOn: null, resumedAt: null },
        { commitmentId: LEER, resumedOn: null, resumedAt: null },
      ],
    });
    expect(
      find(deriveFeed(feedWorld({ requests: [request] })), "paused")[0]?.commitmentIds,
    ).toEqual([MEDITAR, LEER]);
  });

  it("a commitment resumed on its first day is not a subject", () => {
    const request = approvedPause({
      startDay: seasonDay(2),
      decidedOn: seasonDay(2),
      commitments: [
        { commitmentId: MEDITAR, resumedOn: seasonDay(2), resumedAt: instant(1) },
        { commitmentId: LEER, resumedOn: null, resumedAt: null },
      ],
    });
    expect(
      find(deriveFeed(feedWorld({ requests: [request] })), "paused")[0]?.commitmentIds,
    ).toEqual([LEER]);
  });

  it("a request covering 0 effective days yields no item at all", () => {
    const request = approvedPause({
      startDay: seasonDay(2),
      decidedOn: seasonDay(2),
      commitments: [{ commitmentId: MEDITAR, resumedOn: seasonDay(2), resumedAt: instant(1) }],
    });
    const records = deriveFeed(feedWorld({ requests: [request] }));
    expect(find(records, "paused")).toEqual([]);
    expect(find(records, "pointsRecalculated")).toEqual([]);
  });

  it.each(["pending", "rejected", "cancelled"] as const)(
    "a %s request yields nothing",
    (status) => {
      const approved = approvedPause();
      const decision: EffectivePauseRequest["decision"] =
        status === "pending"
          ? { status }
          : { status, decidedAt: instant(5), decidedOn: seasonDay(2) };
      const records = deriveFeed(feedWorld({ requests: [{ record: approved.record, decision }] }));
      expect(find(records, "paused")).toEqual([]);
      expect(find(records, "pointsRecalculated")).toEqual([]);
    },
  );

  it("never carries the pause note", () => {
    const request = approvedPause({ note: "SENTINEL_PAUSE_NOTE" });
    expect(JSON.stringify(deriveFeed(feedWorld({ requests: [request] })))).not.toContain(
      "SENTINEL_PAUSE_NOTE",
    );
  });
});

describe("deriveFeed: graduation (F8)", () => {
  const graduatedAt = localInstant(dateOf(10), 22 * 3_600_000);
  const graduated = HABITS.map((habit) =>
    habit.id === "habit-leer" ? habitFixture({ ...habit, graduatedAt }) : habit,
  );

  it("a habit of the season with graduatedAt yields one item at that instant", () => {
    expect(find(deriveFeed(feedWorld({ habits: graduated })), "graduated")).toEqual([
      {
        kind: "graduated",
        key: "graduation:habit-leer",
        onDate: dateOf(10),
        at: graduatedAt,
        memberId: ANDREA,
        habitId: "habit-leer",
        commitmentIds: [LEER],
      },
    ]);
  });

  it("is one item per habit even when two commitments work it", () => {
    const second = buildCommitment({ ...leer(), id: commitmentId("commitment-leer-2") });
    const world = feedWorld({ commitments: [meditar(), leer(), second], habits: graduated });
    const [item] = find(deriveFeed(world), "graduated");
    expect(item?.commitmentIds).toEqual([LEER, "commitment-leer-2"]);
  });

  it("a graduated habit that is not in the season's commitments yields nothing", () => {
    const world = feedWorld({ commitments: [meditar(), correr()], habits: graduated });
    expect(find(deriveFeed(world), "graduated")).toEqual([]);
  });

  it("a habit that cannot be found yields nothing (it cannot be known as graduated)", () => {
    expect(find(deriveFeed(feedWorld({ habits: [] })), "graduated")).toEqual([]);
  });
});

describe("deriveFeed: season start and close", () => {
  it("a started season always yields its start item", () => {
    expect(find(deriveFeed(feedWorld()), "seasonStarted")).toEqual([
      {
        kind: "seasonStarted",
        key: "season-start:season-1",
        onDate: dateOf(0),
        at: null,
        lengthWeeks: 4,
      },
    ]);
    expect(find(deriveFeed(feedWorld()), "seasonClosed")).toEqual([]);
  });

  it("a closed season also yields its close item, on the day the results open", () => {
    const [item] = find(deriveFeed(feedWorld({ status: "closed" })), "seasonClosed");
    // A 4-week season: results open on the 30th season day (1-based), i.e. 0-based day 29.
    expect(item).toEqual({
      kind: "seasonClosed",
      key: "season-close:season-1",
      onDate: dateOf(29),
      at: null,
    });
  });
});

describe("deriveFeed: purity", () => {
  it("is the same on every call and does not mutate its world", () => {
    const world = feedWorld({ entries: [minutes(meditar(), 0, "30")], today: 2 });
    const before = JSON.stringify(world, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    const a = deriveFeed(world);
    const b = deriveFeed(world);
    expect(keysOf(a)).toEqual(keysOf(b));
    expect(JSON.stringify(world, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      before,
    );
  });
});
