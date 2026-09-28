import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar.ts";
import type { QuantityCommitment } from "../commitment/commitment.ts";
import { fromInt, parseDecimal } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildQuantityCommitment,
  buildQuantityEntry,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { weekSessionsOf } from "./opportunity.ts";

const season: Season = { lengthWeeks: 4, startWeekday: 0 };

describe("weekSessionsOf", () => {
  it("dispatches timesPerWeek commitments to best-N session generation", () => {
    const commitment = buildDoneCommitment("gym", 25, { kind: "timesPerWeek", times: 2 });
    const sessions = weekSessionsOf(commitment, season, 0, []);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.progress.num === 0n)).toBe(true);
  });

  it("dispatches specificDays commitments to missed-day coverage generation", () => {
    const commitment = buildDoneCommitment("draw", 25, {
      kind: "specificDays",
      weekdays: [1, 3, 5],
    });
    const sessions = weekSessionsOf(commitment, season, 0, []);
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.progress.num === 0n)).toBe(true);
  });

  it("derives the target from a quantity commitment's own Target, not the done implicit one", () => {
    const commitment = buildQuantityCommitment(
      "read",
      25,
      "minutes",
      { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
      { kind: "timesPerWeek", times: 1 },
    );
    const sessions = weekSessionsOf(commitment, season, 0, []);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.consistent).toBe(false);
  });

  it("throws RangeError when the week index falls outside the season's length", () => {
    const commitment = buildDoneCommitment("gym", 25, { kind: "timesPerWeek", times: 3 });
    expect(() => weekSessionsOf(commitment, season, 99, [])).toThrow(RangeError);
  });

  it("dispatches weeklyTotal commitments to weekly accumulation, returning a single result", () => {
    const commitment: QuantityCommitment = {
      id: "ingles" as QuantityCommitment["id"],
      weightPercent: 25,
      unit: "minutes",
      target: { direction: "reach", minimum: fromInt(60), ideal: fromInt(150) },
      schedule: { period: "weeklyTotal" },
    };
    const entries = [buildQuantityEntry("ingles", 0, parseDecimal("90"))];
    const sessions = weekSessionsOf(commitment, season, 0, entries);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.progress).toEqual(fr("3/5"));
    expect(sessions[0]?.consistent).toBe(true);
  });
});
