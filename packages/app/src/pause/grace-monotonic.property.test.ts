import { type MemberId, type Schedule, seasonDay } from "@pactjoy/engine";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { entryWindowDeadline } from "../entry/entry-window.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { effectiveDecision } from "./effective-decision.ts";
import { AUTO_APPROVE_AFTER_MS, type PauseRequestRecord } from "./pause-request.ts";
import { toEnginePauses } from "./to-engine.ts";

/**
 * D8 / EW-S3: no pause lock is taken by Entry writes, which is only safe because, for any
 * opportunity, the effective Entry deadline never DECREASES as time passes: pending ->
 * rejected extends it, pending -> approved changes nothing, and a decision is final. So a
 * stale read can only produce a false WindowClosed (the retry succeeds), never accept an
 * Entry past a deadline.
 */
const DAY_MS = 86_400_000;
const REQUESTED_AT = 20 * DAY_MS;
const APPROVERS = ["a1", "a2", "a3"] as MemberId[];

const SCHEDULES: readonly Schedule[] = [
  { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] } },
  { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  { period: "weeklyTotal" },
];

/** Season day 5 is the request day; every instant used here is at or after it. */
const dayOf = (at: number) => {
  const sinceRequest = at - REQUESTED_AT;
  return seasonDay(5 + (sinceRequest - (sinceRequest % DAY_MS)) / DAY_MS);
};

const responseArb = fc.record({
  memberIndex: fc.integer({ min: 0, max: 2 }),
  choice: fc.constantFrom("approve" as const, "reject" as const),
  offsetMs: fc.integer({ min: 0, max: AUTO_APPROVE_AFTER_MS - 1 }),
});

const recordArb = fc
  .tuple(fc.array(responseArb, { maxLength: 6 }), fc.integer({ min: 5, max: 9 }), fc.boolean())
  .map(([raw, lastDay, open]): PauseRequestRecord => {
    // One current response per member: the latest one.
    const latest = new Map<number, (typeof raw)[number]>();
    for (const r of [...raw].sort((a, b) => a.offsetMs - b.offsetMs)) latest.set(r.memberIndex, r);
    return pauseRequestFixture({
      memberId: "requester" as MemberId,
      requestedAt: instant(REQUESTED_AT),
      requestedOn: seasonDay(5),
      startDay: seasonDay(5),
      end: open ? { kind: "open" } : { kind: "fixed", lastDay: seasonDay(lastDay) },
      autoApproveAt: instant(REQUESTED_AT + AUTO_APPROVE_AFTER_MS),
      responses: [...latest.values()].map((r) => ({
        memberId: APPROVERS[r.memberIndex] as MemberId,
        response: r.choice,
        respondedAt: instant(REQUESTED_AT + r.offsetMs),
      })),
    });
  });

describe("the effective Entry deadline never decreases over time (D8, EW-S3)", () => {
  it("holds for every schedule kind, approver set and answer history", () => {
    fc.assert(
      fc.property(
        recordArb,
        fc.integer({ min: 0, max: 3 }),
        fc.array(fc.integer({ min: 0, max: 4 * DAY_MS }), { minLength: 2, maxLength: 8 }),
        fc.integer({ min: 5, max: 9 }),
        (record, approverCount, offsets, day) => {
          const approverIds = APPROVERS.slice(0, approverCount);
          // A response only exists once it has been given: the record as seen at `now`.
          const seenAt = (now: number): PauseRequestRecord => ({
            ...record,
            responses: record.responses.filter((r) => r.respondedAt <= now),
          });
          for (const schedule of SCHEDULES) {
            let previous = -1;
            for (const offset of [...offsets].sort((a, b) => a - b)) {
              const now = REQUESTED_AT + offset;
              const decision = effectiveDecision(seenAt(now), {
                approverIds,
                now: instant(now),
                dayOf: (at) => dayOf(at),
              });
              const deadline = entryWindowDeadline(
                schedule,
                seasonDay(day),
                toEnginePauses(record, decision),
              );
              expect(deadline).toBeGreaterThanOrEqual(previous);
              previous = deadline;
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("a decision, once derived, never changes as the clock advances (decisions are final)", () => {
    fc.assert(
      fc.property(
        recordArb,
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 4 * DAY_MS }),
        fc.integer({ min: 0, max: 4 * DAY_MS }),
        (record, approverCount, a, b) => {
          const [t1, t2] = a <= b ? [a, b] : [b, a];
          const approverIds = APPROVERS.slice(0, approverCount);
          const at = (offset: number) =>
            effectiveDecision(
              {
                ...record,
                responses: record.responses.filter((r) => r.respondedAt <= REQUESTED_AT + offset),
              },
              { approverIds, now: instant(REQUESTED_AT + offset), dayOf: (x) => dayOf(x) },
            );
          const first = at(t1);
          if (first.status !== "pending") expect(at(t2)).toEqual(first);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("meaningful: some lifecycles do extend the deadline, and some do not", () => {
    const rejected = pauseRequestFixture({
      memberId: "requester" as MemberId,
      requestedAt: instant(REQUESTED_AT),
      startDay: seasonDay(5),
      end: { kind: "fixed", lastDay: seasonDay(5) },
      responses: [
        {
          memberId: APPROVERS[0] as MemberId,
          response: "reject",
          respondedAt: instant(REQUESTED_AT + DAY_MS),
        },
      ],
    });
    const ctx = (now: number) => ({
      approverIds: [APPROVERS[0] as MemberId],
      now: instant(now),
      dayOf: (at: number) => dayOf(at),
    });
    const schedule = SCHEDULES[0] as Schedule;
    const before = entryWindowDeadline(
      schedule,
      seasonDay(5),
      toEnginePauses(
        rejected,
        effectiveDecision({ ...rejected, responses: [] }, ctx(REQUESTED_AT)),
      ),
    );
    const after = entryWindowDeadline(
      schedule,
      seasonDay(5),
      toEnginePauses(rejected, effectiveDecision(rejected, ctx(REQUESTED_AT + DAY_MS))),
    );
    expect(before).toBe(6);
    expect(after).toBe(7);
  });
});
