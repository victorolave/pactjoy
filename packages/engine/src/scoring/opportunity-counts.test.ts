import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar.ts";
import { div, fromInt, mul, sum } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildMissedEntry,
  buildPauseRequest,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { type ScoreInput, scoreMember, seasonSessions } from "./member-score.ts";
import { opportunityCounts } from "./opportunity-counts.ts";

const daily = buildDoneCommitment("daily", 100, { kind: "specificDays", weekdays: [0, 2] });
const weekly = buildDoneCommitment("weekly", 100, { kind: "timesPerWeek", times: 3 });
const total = buildWeeklyTotalCommitment("total", 100, "minutes", {
  direction: "reach",
  minimum: fromInt(30),
  ideal: fromInt(60),
});
const snapshot = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  season: { lengthWeeks: 4, startWeekday: 0 },
  commitments: [daily],
  entries: [],
  pauses: [],
  today: seasonDay(0),
  ...overrides,
});

describe("opportunityCounts", () => {
  it("distinguishes no counted opportunities from zero successes", () => {
    expect(opportunityCounts(daily, snapshot())).toEqual({
      kept: 0,
      counted: 0,
      total: 8,
      perOpportunityPoints: fromInt(125),
    });
    expect(opportunityCounts(daily, snapshot({ entries: [buildMissedEntry("daily", 0)] }))).toEqual(
      { kept: 0, counted: 1, total: 8, perOpportunityPoints: fromInt(125) },
    );
  });

  it("counts specific days after an entry or inclusive deadline, not the whole week", () => {
    const input = snapshot({ today: seasonDay(2), entries: [buildDoneEntry("daily", 2)] });
    expect(opportunityCounts(daily, input)).toEqual({
      kept: 1,
      counted: 2,
      total: 8,
      perOpportunityPoints: fromInt(125),
    });
  });

  it.each([weekly, total])("withholds weekly-window counts until grace for $id", (commitment) => {
    const input = snapshot({
      commitments: [commitment],
      entries: [
        commitment.unit === "done"
          ? buildDoneEntry(commitment.id, 0)
          : buildQuantityEntry(commitment.id, 0, fromInt(60)),
      ],
      today: seasonDay(6),
    });
    expect(opportunityCounts(commitment, input).counted).toBe(0);
    expect(opportunityCounts(commitment, input).kept).toBe(0);
    expect(opportunityCounts(commitment, { ...input, today: seasonDay(7) }).counted).toBe(
      commitment.unit === "done" ? 3 : 1,
    );
    expect(opportunityCounts(commitment, { ...input, today: seasonDay(7) }).kept).toBe(1);
  });

  it("excludes paused and pending opportunities, retaining exact D12 allocation", () => {
    const input = snapshot({
      commitments: [weekly],
      today: seasonDay(28),
      pauses: [
        buildPauseRequest(
          "weekly",
          0,
          { kind: "fixed", lastDay: seasonDay(6) },
          { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
        ),
        buildPauseRequest(
          "weekly",
          7,
          { kind: "fixed", lastDay: seasonDay(13) },
          { kind: "pending" },
        ),
      ],
    });
    expect(opportunityCounts(weekly, input)).toEqual({
      kept: 0,
      counted: 6,
      total: 6,
      perOpportunityPoints: fr("500/3"),
    });
  });

  it("returns zero allocation when the entire season is on hold", () => {
    const input = snapshot({
      today: seasonDay(28),
      pauses: [
        buildPauseRequest(
          "daily",
          0,
          { kind: "fixed", lastDay: seasonDay(27) },
          { kind: "pending" },
        ),
      ],
    });
    expect(opportunityCounts(daily, input)).toEqual({
      kept: 0,
      counted: 0,
      total: 0,
      perOpportunityPoints: fromInt(0),
    });
    // Pending holds exclude elapsed days only, not future opportunities.
    expect(opportunityCounts(daily, { ...input, today: seasonDay(0) }).total).toBe(7);
  });

  it.each([daily, weekly, total])(
    "matches exact scoring and pooled metrics for $id",
    (commitment) => {
      for (const today of [0, 1, 6, 7, 8, 14, 28, 40]) {
        const input = snapshot({
          commitments: [commitment],
          today: seasonDay(today),
          entries: [
            buildQuantityEntry(commitment.id, 0, fromInt(1)),
            buildQuantityEntry(commitment.id, 0, fromInt(1)),
            buildQuantityEntry(commitment.id, 1, fromInt(60)),
            buildMissedEntry(commitment.id, 2),
          ],
        });
        const counts = opportunityCounts(commitment, input);
        const walk = seasonSessions(commitment, input);
        const score = scoreMember(input);
        expect(counts.total).toBe(walk.all.length);
        expect(counts.counted).toBe(walk.soFar.length);
        expect(walk.weeks.flatMap((w) => w.opportunities.map((o) => o.session))).toEqual(walk.all);
        expect(
          walk.weeks.flatMap((w) => w.opportunities.filter((o) => o.counted).map((o) => o.session)),
        ).toEqual(walk.soFar);
        expect(score.points).toEqual(
          mul(counts.perOpportunityPoints, sum(walk.soFar.map((s) => s.progress))),
        );
        expect(score.consistency).toEqual(
          counts.counted === 0 ? null : div(fromInt(counts.kept), fromInt(counts.counted)),
        );
      }
    },
  );
});

describe("shared seasonSessions projection seam", () => {
  it("carries best-N source days through pause-aware proration without reconstructing assignment", () => {
    const input = snapshot({
      commitments: [weekly],
      today: seasonDay(7),
      entries: [
        buildDoneEntry("weekly", 0),
        buildDoneEntry("weekly", 2),
        buildDoneEntry("weekly", 3),
      ],
      pauses: [
        buildPauseRequest(
          "weekly",
          0,
          { kind: "fixed", lastDay: seasonDay(1) },
          { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
        ),
      ],
    });
    const plan = seasonSessions(weekly, input).weeks[0]?.plan;
    expect(plan?.sourceDays).toEqual([2, 3]);
    expect(opportunityCounts(weekly, input)).toMatchObject({ kept: 2, counted: 2, total: 11 });
  });

  it("retains planWeek makeup provenance and independent counted/editable/final facts", () => {
    const input = snapshot({ today: seasonDay(1), entries: [buildDoneEntry("daily", 1)] });
    const first = seasonSessions(daily, input).weeks[0];
    expect(first?.plan.activeScheduledDays).toEqual([0, 2]);
    expect(first?.plan.sourceDays).toEqual([1, null]);
    expect(first?.opportunities[0]).toMatchObject({
      day: 0,
      deadline: 1,
      counted: true,
      editable: true,
      final: false,
      session: { filledFrom: 1, consistent: true },
    });
    expect(first?.opportunities[1]).toMatchObject({
      day: 2,
      counted: false,
      editable: false,
      final: false,
    });
    expect(
      seasonSessions(daily, { ...input, today: seasonDay(2) }).weeks[0]?.opportunities[0],
    ).toMatchObject({ counted: true, editable: false, final: true });
  });

  it("keeps weekly grace-day counts editable and future weeks unopened", () => {
    const input = snapshot({ commitments: [weekly], today: seasonDay(7) });
    const walk = seasonSessions(weekly, input);
    expect(walk.weeks).toHaveLength(4);
    expect(walk.weeks[0]?.opportunities).toHaveLength(3);
    expect(walk.weeks[0]?.opportunities[0]).toMatchObject({
      day: null,
      deadline: 7,
      counted: true,
      editable: true,
      final: false,
    });
    expect(walk.weeks[2]?.opportunities[0]).toMatchObject({
      counted: false,
      editable: false,
      final: false,
    });
  });

  it("preserves rejected-pause grace extensions in the shared gate", () => {
    const input = snapshot({
      commitments: [weekly],
      today: seasonDay(7),
      pauses: [
        buildPauseRequest(
          "weekly",
          5,
          { kind: "fixed", lastDay: seasonDay(6) },
          { kind: "rejected", decidedOn: seasonDay(9) },
        ),
      ],
    });
    expect(seasonSessions(weekly, input).weeks[0]?.opportunities[0]).toMatchObject({
      deadline: 10,
      counted: false,
      editable: true,
      final: false,
    });
    expect(opportunityCounts(weekly, { ...input, today: seasonDay(10) }).counted).toBe(3);
  });

  it("retains paused versus onHold plans with no synthetic scoring opportunities", () => {
    const one = buildDoneCommitment("one", 100, { kind: "timesPerWeek", times: 1 });
    const input = snapshot({
      commitments: [one],
      today: seasonDay(28),
      pauses: [
        buildPauseRequest(
          "one",
          0,
          { kind: "fixed", lastDay: seasonDay(5) },
          { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
        ),
        buildPauseRequest("one", 7, { kind: "fixed", lastDay: seasonDay(12) }, { kind: "pending" }),
      ],
    });
    const walk = seasonSessions(one, input);
    expect(walk.weeks[0]?.plan.result.status).toBe("paused");
    expect(walk.weeks[1]?.plan.result.status).toBe("onHold");
    expect(walk.weeks[0]?.opportunities).toEqual([]);
    expect(walk.weeks[1]?.opportunities).toEqual([]);
    expect(opportunityCounts(one, input)).toMatchObject({ total: 2, counted: 2 });
  });
});
