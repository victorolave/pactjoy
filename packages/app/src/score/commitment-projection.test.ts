import {
  type CommitmentScoreEntry,
  frac,
  fromInt,
  type MemberId,
  parseDecimal,
} from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { habitId } from "../shared/ids.ts";
import { projectCommitment } from "./commitment-projection.ts";

const OWNER = "member-owner" as MemberId;
const SCHEDULE = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 2, 4] },
} as const;
const SCORE = {
  commitmentId: commitmentId("c-1"),
  points: fromInt(100),
  consistency: null,
  idealCompletion: null,
  streak: { unit: "day", current: 0, best: 0 },
} as unknown as CommitmentScoreEntry;

describe("projectCommitment: measure thresholds as exact decimal strings", () => {
  it("renders a limit target with its ideal and tolerance", () => {
    const record = buildCommitment({
      id: commitmentId("c-1"),
      memberId: OWNER,
      habitId: habitId("habit-1"),
      weightPercent: 100,
      privacy: "visible",
      measure: {
        unit: "custom",
        customLabel: "coffees",
        precision: "decimal",
        target: { direction: "limit", ideal: parseDecimal("1.5"), tolerance: frac(4n) },
        schedule: SCHEDULE,
      },
    });

    const view = projectCommitment(record, SCORE, OWNER);

    expect(view).toMatchObject({
      kind: "detail",
      consistency: null,
      idealCompletion: null,
      measure: {
        unit: "custom",
        customLabel: "coffees",
        precision: "decimal",
        target: { direction: "limit", ideal: "1.5", tolerance: "4" },
        schedule: SCHEDULE,
      },
    });
  });
});
