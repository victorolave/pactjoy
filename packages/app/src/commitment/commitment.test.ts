import { fromInt, type MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { habitId } from "../shared/ids.ts";
import { buildCommitment, commitmentId, commitmentsSumToFullWeight } from "./commitment.ts";

function memberIdFor(value: string): MemberId {
  return value as MemberId;
}

describe("commitmentId", () => {
  it("brands a plain string, same pattern as circle.ts's memberId", () => {
    const id = commitmentId("commitment-1");

    expect(id).toBe("commitment-1");
  });
});

describe("buildCommitment", () => {
  it("SS-7: assembles a done commitment, always reach + perSession by construction (engine R3)", () => {
    const commitment = buildCommitment({
      id: commitmentId("commitment-1"),
      memberId: memberIdFor("member-1"),
      habitId: habitId("habit-1"),
      weightPercent: 20,
      privacy: "visible",
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
    });

    expect(commitment.measure.unit).toBe("done");
    if (commitment.measure.unit === "done") {
      expect(commitment.measure.schedule.period).toBe("perSession");
    }
    expect(commitment.weightPercent).toBe(20);
    expect(commitment.privacy).toBe("visible");
  });

  it("assembles a quantity commitment carrying a parsed target and optional custom label", () => {
    const commitment = buildCommitment({
      id: commitmentId("commitment-2"),
      memberId: memberIdFor("member-1"),
      habitId: habitId("habit-2"),
      weightPercent: 15,
      privacy: "private",
      measure: {
        unit: "km",
        customLabel: null,
        precision: "decimal",
        target: { direction: "reach", minimum: fromInt(3), ideal: fromInt(5) },
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(commitment.measure.unit).toBe("km");
    expect(commitment.privacy).toBe("private");
  });
});

function commitmentWithWeight(weightPercent: number) {
  return buildCommitment({
    id: commitmentId(`commitment-${weightPercent}`),
    memberId: memberIdFor("member-1"),
    habitId: habitId("habit-1"),
    weightPercent,
    privacy: "visible",
    measure: {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    },
  });
}

describe("commitmentsSumToFullWeight", () => {
  it("B5: true when a member's commitment weights sum to exactly 100", () => {
    const commitments = [commitmentWithWeight(60), commitmentWithWeight(40)];

    expect(commitmentsSumToFullWeight(commitments)).toBe(true);
  });

  it("B5: false when the weights sum to less than 100", () => {
    const commitments = [commitmentWithWeight(60), commitmentWithWeight(30)];

    expect(commitmentsSumToFullWeight(commitments)).toBe(false);
  });

  it("B5: false for a member with zero commitments (sum is 0, not 100)", () => {
    expect(commitmentsSumToFullWeight([])).toBe(false);
  });
});
