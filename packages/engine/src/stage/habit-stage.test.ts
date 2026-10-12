import { describe, expect, it } from "vitest";
import { frac, fromInt } from "../fraction/fraction.ts";
import { fr } from "../test-support/fraction-literal.ts";
import {
  deriveHabitStage,
  HABIT_STAGE_THRESHOLDS,
  type HabitStageInput,
  type StageCounts,
} from "./habit-stage.ts";

const week = (kept: number, counted: number): StageCounts => ({ kept, counted });
const high = week(5, 5);
const input = (overrides: Partial<HabitStageInput> = {}): HabitStageInput => ({
  finalWeeks: [],
  lastPeriod: null,
  automaticity: null,
  graduated: false,
  ...overrides,
});

describe("deriveHabitStage (REQ-H1..H9)", () => {
  it("is new with no completed period (SC-90, REQ-H5)", () => {
    expect(deriveHabitStage(input())).toBe("new");
    expect(deriveHabitStage(input({ finalWeeks: [week(1, 2)], lastPeriod: week(5, 10) }))).toBe(
      "new",
    );
  });

  it("developing is inclusive at exactly 60 %, new just below (SC-91, REQ-H4)", () => {
    expect(deriveHabitStage(input({ lastPeriod: week(6, 10) }))).toBe("developing");
    expect(deriveHabitStage(input({ lastPeriod: week(59, 100) }))).toBe("new");
  });

  it("a last period with nothing counted gives no developing evidence (REQ-H6)", () => {
    expect(deriveHabitStage(input({ lastPeriod: week(0, 0) }))).toBe("new");
  });

  it("integrated needs 4 weeks each at or above 80 % and automaticity 5 (SC-92)", () => {
    const finalWeeks = [week(4, 5), week(4, 5), high, high];
    const lastPeriod = week(18, 20);
    expect(deriveHabitStage(input({ finalWeeks, lastPeriod, automaticity: fromInt(5) }))).toBe(
      "integrated",
    );
    expect(deriveHabitStage(input({ finalWeeks, lastPeriod, automaticity: fr("19/4") }))).toBe(
      "developing",
    );
  });

  it("sustained means EACH of the last 4 counted weeks, not the pooled rate (SC-93)", () => {
    // 3 weeks at 100 % and one at 70 %: pooled is 93 %, but the run is broken.
    const finalWeeks = [high, high, high, week(7, 10)];
    const lastPeriod = week(37, 40);
    expect(deriveHabitStage(input({ finalWeeks, lastPeriod, automaticity: fromInt(6) }))).toBe(
      "developing",
    );
    // The run restarts: 4 good weeks after the dip are integrated again.
    expect(
      deriveHabitStage(
        input({
          finalWeeks: [...finalWeeks, high, high, high, high],
          lastPeriod,
          automaticity: fromInt(6),
        }),
      ),
    ).toBe("integrated");
  });

  it("fewer than 4 counted weeks cannot be integrated", () => {
    expect(
      deriveHabitStage(
        input({ finalWeeks: [high, high, high], lastPeriod: high, automaticity: fromInt(7) }),
      ),
    ).toBe("developing");
  });

  it("regresses to new when the last period falls below 60 % (SC-94)", () => {
    const finalWeeks = [high, high, high, high, week(2, 5), week(2, 5)];
    expect(
      deriveHabitStage(input({ finalWeeks, lastPeriod: week(4, 10), automaticity: fromInt(6) })),
    ).toBe("new");
  });

  it("regresses to developing when automaticity falls below 5 with consistency kept (SC-94)", () => {
    const finalWeeks = [high, high, high, high];
    expect(
      deriveHabitStage(input({ finalWeeks, lastPeriod: high, automaticity: fromInt(4) })),
    ).toBe("developing");
  });

  it("paused weeks (nothing counted) are neutral: they neither count nor break the run (SC-95)", () => {
    const finalWeeks = [high, high, week(0, 0), high, high];
    expect(
      deriveHabitStage(input({ finalWeeks, lastPeriod: high, automaticity: fromInt(5) })),
    ).toBe("integrated");
  });

  it("without any automaticity score the best is developing (SC-99, REQ-H7)", () => {
    const finalWeeks = [high, high, high, high];
    expect(deriveHabitStage(input({ finalWeeks, lastPeriod: high }))).toBe("developing");
  });

  it("graduated wins over everything, and only through the flag (SC-97)", () => {
    expect(deriveHabitStage(input({ graduated: true }))).toBe("graduated");
    expect(
      deriveHabitStage(
        input({ graduated: true, finalWeeks: [high, high, high, high], automaticity: fromInt(7) }),
      ),
    ).toBe("graduated");
    expect(deriveHabitStage(input({ finalWeeks: [high, high, high, high] }))).not.toBe("graduated");
  });
});

describe("HABIT_STAGE_THRESHOLDS (REQ-H9, SC-98)", () => {
  it("holds every threshold in one constant", () => {
    expect(HABIT_STAGE_THRESHOLDS).toEqual({
      developingConsistency: frac(3n, 5n),
      integratedConsistency: frac(4n, 5n),
      integratedWeeks: 4,
      integratedAutomaticity: fromInt(5),
    });
  });

  it("substituting the constant changes the result with no data change (SC-98)", () => {
    const data = input({
      finalWeeks: [high, high, high, high],
      lastPeriod: high,
      automaticity: fromInt(5),
    });
    expect(deriveHabitStage(data)).toBe("integrated");
    expect(
      deriveHabitStage(data, { ...HABIT_STAGE_THRESHOLDS, integratedAutomaticity: fromInt(6) }),
    ).toBe("developing");
    expect(deriveHabitStage(data, { ...HABIT_STAGE_THRESHOLDS, integratedWeeks: 5 })).toBe(
      "developing",
    );
    expect(
      deriveHabitStage(data, { ...HABIT_STAGE_THRESHOLDS, developingConsistency: fr("2") }),
    ).toBe("integrated");
  });
});
