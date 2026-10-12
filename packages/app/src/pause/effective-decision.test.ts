import { type MemberId, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { pauseRequestFixture } from "../testing/builders.ts";
import { createFixedOffsetTimeZone } from "../testing/fixed-time-zone.ts";
import { type Instant, instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { type DecisionContext, effectiveDecision } from "./effective-decision.ts";
import type { PauseRequestRecord, PauseResponse } from "./pause-request.ts";

/** Spec fixture: season tz America/Bogota (UTC-5, no DST), season day 0 = Mon 2026-09-28 local. */
const bogota = createFixedOffsetTimeZone({ offsetMinutes: -300 });
const SEASON_START = localDate("2026-09-28");
const dayOfIn =
  (zone: typeof bogota, start = SEASON_START) =>
  (at: Instant) => {
    const day = toSeasonDay(zone.localDateAt(at, timeZoneId("season-zone")), start);
    if (day.kind === "beforeStart") throw new Error("before start");
    return day.day;
  };

const ANDREA = "member-andrea" as MemberId;
const SOFIA = "member-sofia" as MemberId;
const R1_AT = instant(1_791_987_120_000); // 2026-10-14T14:12:00Z (Wed 09:12 local)
const R1_DEADLINE = instant(1_792_159_920_000); // 2026-10-16T14:12:00Z (Fri 09:12 local)
const DAY_16 = seasonDay(18); // Fri 2026-10-16 local
const DAY_14 = seasonDay(16);

const r1 = (overrides: Partial<PauseRequestRecord> = {}) =>
  pauseRequestFixture({ requestedAt: R1_AT, requestedOn: DAY_14, startDay: DAY_14, ...overrides });
const answer = (
  member: MemberId,
  response: PauseResponse["response"],
  at: number,
): PauseResponse => ({
  memberId: member,
  response,
  respondedAt: instant(at),
});
const ctx = (now: number, approverIds: readonly MemberId[] = [ANDREA, SOFIA]): DecisionContext => ({
  approverIds,
  now: instant(now),
  dayOf: dayOfIn(bogota),
});

describe("effectiveDecision: stored decisions are final (Q3)", () => {
  it.each(["approved", "rejected", "cancelled"] as const)("a stored %s decision wins", (status) => {
    const record = r1({ status, decidedAt: instant(R1_AT + 1000), decidedOn: DAY_14 });
    expect(effectiveDecision(record, ctx(R1_DEADLINE + 1))).toEqual({
      status,
      decidedAt: R1_AT + 1000,
      decidedOn: DAY_14,
    });
  });

  it("a stored rejection is not overturned by responses that would approve", () => {
    const record = r1({
      status: "rejected",
      decidedAt: instant(R1_AT + 1000),
      decidedOn: DAY_14,
      responses: [answer(ANDREA, "approve", R1_AT + 10), answer(SOFIA, "approve", R1_AT + 20)],
    });
    expect(effectiveDecision(record, ctx(R1_AT + 5000)).status).toBe("rejected");
  });
});

describe("effectiveDecision: Q1, nobody can approve", () => {
  it("approves at requestedAt, decidedOn the request day", () => {
    expect(effectiveDecision(r1(), ctx(R1_AT, []))).toEqual({
      status: "approved",
      decidedAt: R1_AT,
      decidedOn: DAY_14,
    });
  });
});

describe("effectiveDecision: all approvers answered (D3 step 3)", () => {
  it("all approve: approved at the latest response, decidedOn that day", () => {
    const record = r1({
      responses: [
        answer(ANDREA, "approve", 1_792_058_400_000), // 2026-10-15T10:00Z
        answer(SOFIA, "approve", 1_792_065_600_000), // 2026-10-15T12:00Z
      ],
    });
    expect(effectiveDecision(record, ctx(1_792_065_600_000 + 1))).toEqual({
      status: "approved",
      decidedAt: 1_792_065_600_000,
      decidedOn: seasonDay(17),
    });
  });

  it("any reject once everyone answered: rejected at the latest response (PL-S6 second reading)", () => {
    const record = r1({
      responses: [answer(ANDREA, "approve", R1_AT + 1000), answer(SOFIA, "reject", R1_AT + 5000)],
    });
    expect(effectiveDecision(record, ctx(R1_AT + 6000))).toEqual({
      status: "rejected",
      decidedAt: R1_AT + 5000,
      decidedOn: DAY_14,
    });
  });

  it("PL-S10: a change of mind counts only as the current response", () => {
    const record = r1({
      // Andrea's current response is approve (her earlier reject was replaced).
      responses: [
        answer(ANDREA, "approve", 1_792_062_000_000),
        answer(SOFIA, "approve", 1_792_065_600_000),
      ],
    });
    expect(effectiveDecision(record, ctx(1_792_065_600_001)).status).toBe("approved");
  });

  it("ignores responses of members who are not (or no longer) approvers", () => {
    const record = r1({ responses: [answer(ANDREA, "approve", R1_AT + 1000)] });
    // Sofia left: Andrea is the only approver left and she has answered.
    expect(effectiveDecision(record, ctx(R1_AT + 2000, [ANDREA]))).toMatchObject({
      status: "approved",
      decidedAt: R1_AT + 1000,
    });
    // A response from the requester or a leaver never decides anything.
    const stray = r1({ responses: [answer("member-leaver" as MemberId, "reject", R1_AT + 1000)] });
    expect(effectiveDecision(stray, ctx(R1_AT + 2000)).status).toBe("pending");
  });
});

describe("effectiveDecision: Q4, the 48 h auto-approval, exact to the millisecond", () => {
  it("one millisecond before autoApproveAt: still pending", () => {
    expect(effectiveDecision(r1(), ctx(R1_DEADLINE - 1))).toEqual({ status: "pending" });
  });

  it("at autoApproveAt exactly: approved", () => {
    expect(effectiveDecision(r1(), ctx(R1_DEADLINE))).toEqual({
      status: "approved",
      decidedAt: R1_DEADLINE,
      decidedOn: DAY_16,
    });
  });

  it("PL-S6: one minute before, a lone reject does not decide", () => {
    const record = r1({ responses: [answer(SOFIA, "reject", R1_DEADLINE - 60_000)] });
    expect(effectiveDecision(record, ctx(R1_DEADLINE - 60_000))).toEqual({ status: "pending" });
  });

  it("PL-S7: partial approvals plus silence approve at the deadline", () => {
    const record = r1({ responses: [answer(ANDREA, "approve", R1_AT + 1000)] });
    expect(effectiveDecision(record, ctx(R1_DEADLINE + 60_000))).toMatchObject({
      status: "approved",
      decidedAt: R1_DEADLINE,
      decidedOn: DAY_16,
    });
  });

  it("PL-S9: a standing reject with a silent approver rejects at the deadline", () => {
    const record = r1({ responses: [answer(ANDREA, "reject", 1_792_058_400_000)] });
    expect(effectiveDecision(record, ctx(R1_DEADLINE))).toEqual({
      status: "rejected",
      decidedAt: R1_DEADLINE,
      decidedOn: DAY_16,
    });
  });

  it("PL-S13: the first read days later still reports the deadline's own day", () => {
    const decision = effectiveDecision(r1(), ctx(1_792_483_200_000)); // 2026-10-20T08:00Z
    expect(decision).toEqual({ status: "approved", decidedAt: R1_DEADLINE, decidedOn: DAY_16 });
  });

  it("PL-S12: decidedOn is the season-tz day of autoApproveAt across a day boundary", () => {
    const requestedAt = instant(1_792_031_400_000); // 2026-10-15T02:30Z = Wed 21:30 local
    const record = pauseRequestFixture({ requestedAt, autoApproveAt: instant(1_792_204_200_000) });
    expect(effectiveDecision(record, ctx(1_792_204_200_000))).toEqual({
      status: "approved",
      decidedAt: 1_792_204_200_000,
      decidedOn: DAY_16, // Fri 2026-10-16 local, not Sat 10-17 UTC
    });
  });

  it("decidedOn follows the season's own zone: the same instant lands a day later at UTC+9", () => {
    const tokyo = createFixedOffsetTimeZone({ offsetMinutes: 540 });
    const requestedAt = instant(1_792_031_400_000);
    const record = pauseRequestFixture({ requestedAt, autoApproveAt: instant(1_792_204_200_000) });
    const decision = effectiveDecision(record, {
      approverIds: [ANDREA],
      now: instant(1_792_204_200_000),
      dayOf: dayOfIn(tokyo),
    });
    // 2026-10-17T02:30Z is 11:30 on 10-17 in Tokyo; season day 0 = 2026-09-28 there too.
    expect(decision).toMatchObject({ status: "approved", decidedOn: seasonDay(19) });
  });
});
