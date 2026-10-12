import {
  type CommitmentId,
  type MemberId,
  type ScoreInput,
  scoreMember,
  seasonDay,
} from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { commitmentId } from "../commitment/commitment.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import type { EffectiveDecision } from "./effective-decision.ts";
import { toEnginePauses } from "./to-engine.ts";

const GYM = commitmentId("commitment-gym");
const READING = commitmentId("commitment-reading");
const VICTOR = "member-victor" as MemberId;
const record = (extra: Parameters<typeof pauseRequestFixture>[0] = {}) =>
  pauseRequestFixture({
    memberId: VICTOR,
    startDay: seasonDay(16),
    requestedOn: seasonDay(16),
    end: { kind: "fixed", lastDay: seasonDay(22) },
    commitments: [
      { commitmentId: GYM, resumedOn: null, resumedAt: null },
      { commitmentId: READING, resumedOn: null, resumedAt: null },
    ],
    ...extra,
  });
const approved = (on: number): EffectiveDecision => ({
  status: "approved",
  decidedAt: instant(1),
  decidedOn: seasonDay(on),
});

describe("toEnginePauses: one engine PauseRequest per Commitment (E21)", () => {
  it("expands a multi-Commitment request, carrying owner, dates and end", () => {
    const result = toEnginePauses(record(), { status: "pending" });
    expect(result).toEqual([
      {
        memberId: VICTOR,
        commitmentId: GYM,
        requestedOn: 16,
        startDay: 16,
        end: { kind: "fixed", lastDay: 22 },
        decision: { kind: "pending" },
      },
      {
        memberId: VICTOR,
        commitmentId: READING,
        requestedOn: 16,
        startDay: 16,
        end: { kind: "fixed", lastDay: 22 },
        decision: { kind: "pending" },
      },
    ]);
  });

  it("approved keeps decidedOn and each Commitment's own resumedOn", () => {
    const rec = record({
      commitments: [
        { commitmentId: GYM, resumedOn: seasonDay(19), resumedAt: instant(2) },
        { commitmentId: READING, resumedOn: null, resumedAt: null },
      ],
    });
    expect(toEnginePauses(rec, approved(18)).map((p) => p.decision)).toEqual([
      { kind: "approved", decidedOn: 18, resumedOn: 19 },
      { kind: "approved", decidedOn: 18, resumedOn: null },
    ]);
  });

  it("rejected maps to rejected{decidedOn}", () => {
    const decision: EffectiveDecision = {
      status: "rejected",
      decidedAt: instant(1),
      decidedOn: seasonDay(18),
    };
    expect(toEnginePauses(record(), decision)[0]?.decision).toEqual({
      kind: "rejected",
      decidedOn: 18,
    });
  });

  it("Q2: cancelled maps to rejected on the cancel day", () => {
    const decision: EffectiveDecision = {
      status: "cancelled",
      decidedAt: instant(1),
      decidedOn: seasonDay(17),
    };
    expect(toEnginePauses(record(), decision)[0]?.decision).toEqual({
      kind: "rejected",
      decidedOn: 17,
    });
  });
});

describe("toEnginePauses: Q6, resuming an approved pause that has not started acts as a cancel", () => {
  const MEMBER_SEASON: ScoreInput["season"] = { lengthWeeks: 8, startWeekday: 0 };
  const gym = {
    id: GYM as CommitmentId,
    weightPercent: 100,
    unit: "done",
    schedule: {
      period: "perSession",
      frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    },
  } as const;
  // Done every day through day 24: only the days the pause would cover are left empty.
  const entries = Array.from({ length: 25 }, (_, day) => ({
    commitmentId: GYM as CommitmentId,
    day: seasonDay(day),
    recordedOn: seasonDay(day),
    kind: "done" as const,
  }));
  const points = (pauses: ReturnType<typeof toEnginePauses>, today: number) =>
    scoreMember({
      season: MEMBER_SEASON,
      commitments: [gym],
      entries,
      pauses: pauses.map(({ memberId: _owner, ...pause }) => pause),
      today: seasonDay(today),
    });

  it("a future approved pause resumed today scores exactly like no pause at all", () => {
    const future = record({
      startDay: seasonDay(25),
      requestedOn: seasonDay(20),
      end: { kind: "fixed", lastDay: seasonDay(30) },
      commitments: [{ commitmentId: GYM, resumedOn: seasonDay(22), resumedAt: instant(2) }],
    });
    const resumed = points(toEnginePauses(future, approved(20)), 22);
    expect(resumed).toEqual(points([], 22));
  });

  it("triangulation: without the resume the same approved pause does change the day count", () => {
    const future = record({
      startDay: seasonDay(25),
      requestedOn: seasonDay(20),
      end: { kind: "fixed", lastDay: seasonDay(30) },
      commitments: [{ commitmentId: GYM, resumedOn: null, resumedAt: null }],
    });
    expect(points(toEnginePauses(future, approved(20)), 40)).not.toEqual(points([], 40));
  });
});
