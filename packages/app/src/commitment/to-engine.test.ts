import {
  fromInt,
  isLimitIdealWithinTolerance,
  isPositiveReachMinimum,
  isReachMinimumWithinIdeal,
  isValidWeightPercent,
} from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { habitId } from "../shared/ids.ts";
import { buildCommitment, commitmentId } from "./commitment.ts";
import { commitmentToEngine } from "./to-engine.ts";
import { validateCommitment } from "./validate-commitment.ts";

const MEMBER_ID = "member-1" as never;

describe("commitmentToEngine", () => {
  it("maps a done commitment 1:1, dropping habitId and privacy", () => {
    const record = buildCommitment({
      id: commitmentId("commitment-1"),
      memberId: MEMBER_ID,
      habitId: habitId("habit-run"),
      weightPercent: 20,
      privacy: "private",
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
    });

    const mapped = commitmentToEngine(record);

    expect(mapped).toEqual({
      id: "commitment-1",
      weightPercent: 20,
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    });
    // Round-trip drops app-only fields (habitId, privacy) -- neither key exists on the mapped value.
    expect(mapped).not.toHaveProperty("habitId");
    expect(mapped).not.toHaveProperty("privacy");
  });

  it("maps a quantity commitment 1:1, dropping customLabel/habitId/privacy but keeping the exact target Fraction", () => {
    const record = buildCommitment({
      id: commitmentId("commitment-2"),
      memberId: MEMBER_ID,
      habitId: habitId("habit-water"),
      weightPercent: 15,
      privacy: "visible",
      measure: {
        unit: "glasses",
        customLabel: null,
        target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
        schedule: {
          period: "perSession",
          frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
        },
      },
    });

    const mapped = commitmentToEngine(record);

    expect(mapped).toEqual({
      id: "commitment-2",
      weightPercent: 15,
      unit: "glasses",
      target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    expect(mapped).not.toHaveProperty("customLabel");
    expect(mapped).not.toHaveProperty("habitId");
    expect(mapped).not.toHaveProperty("privacy");
  });

  it("maps a custom-label quantity commitment, dropping the label itself", () => {
    const record = buildCommitment({
      id: commitmentId("commitment-3"),
      memberId: MEMBER_ID,
      habitId: habitId("habit-journal"),
      weightPercent: 10,
      privacy: "visible",
      measure: {
        unit: "custom",
        customLabel: "páginas",
        target: { direction: "reach", minimum: fromInt(1), ideal: fromInt(3) },
        schedule: { period: "weeklyTotal" },
      },
    });

    const mapped = commitmentToEngine(record);

    expect(mapped).toEqual({
      id: "commitment-3",
      weightPercent: 10,
      unit: "custom",
      target: { direction: "reach", minimum: fromInt(1), ideal: fromInt(3) },
      schedule: { period: "weeklyTotal" },
    });
    expect(mapped).not.toHaveProperty("customLabel");
  });

  it("round-trips validateCommitment -> commitmentToEngine and stays valid per the engine's own predicates (fresh-review fix: single source of truth)", () => {
    const validated = validateCommitment({
      weightPercent: 25,
      measure: {
        unit: "minutes",
        direction: "reach",
        minimum: "10",
        ideal: "30",
        schedule: { period: "weeklyTotal" },
      },
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const record = buildCommitment({
      id: commitmentId("commitment-round-trip"),
      memberId: MEMBER_ID,
      habitId: habitId("habit-run"),
      weightPercent: 25,
      privacy: "visible",
      measure: validated.value,
    });

    const mapped = commitmentToEngine(record);

    expect(isValidWeightPercent(mapped.weightPercent)).toBe(true);
    expect(mapped.unit).not.toBe("done");
    if (mapped.unit === "done") return;
    expect(mapped.target.direction).toBe("reach");
    if (mapped.target.direction !== "reach") return;
    expect(isPositiveReachMinimum(mapped.target.minimum)).toBe(true);
    expect(isReachMinimumWithinIdeal(mapped.target.minimum, mapped.target.ideal)).toBe(true);
  });

  it("round-trips a limit commitment and stays valid per isLimitIdealWithinTolerance", () => {
    const validated = validateCommitment({
      weightPercent: 15,
      measure: {
        unit: "glasses",
        direction: "limit",
        ideal: "2",
        tolerance: "4",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
      },
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const record = buildCommitment({
      id: commitmentId("commitment-round-trip-limit"),
      memberId: MEMBER_ID,
      habitId: habitId("habit-water"),
      weightPercent: 15,
      privacy: "visible",
      measure: validated.value,
    });

    const mapped = commitmentToEngine(record);

    expect(isValidWeightPercent(mapped.weightPercent)).toBe(true);
    if (mapped.unit === "done") return;
    expect(mapped.target.direction).toBe("limit");
    if (mapped.target.direction !== "limit") return;
    expect(isLimitIdealWithinTolerance(mapped.target.ideal, mapped.target.tolerance)).toBe(true);
  });
});
