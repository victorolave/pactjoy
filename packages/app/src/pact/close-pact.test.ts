import type { MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { circleId, seasonId } from "../shared/ids.ts";
import { seasonFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { closeSeason, computeActualStart, isUnanimouslyApproved } from "./close-pact.ts";

function memberIdFor(value: string): MemberId {
  return value as MemberId;
}

function approvalFor(memberId: string, approvedAt = instant(1_700_000_000_000)) {
  return { memberId: memberIdFor(memberId), approvedAt };
}

describe("isUnanimouslyApproved", () => {
  it("PA-1: true once every active member has an approval recorded", () => {
    const activeMemberIds = [memberIdFor("m1"), memberIdFor("m2"), memberIdFor("m3")];
    const approvals = [approvalFor("m1"), approvalFor("m2"), approvalFor("m3")];

    expect(isUnanimouslyApproved(activeMemberIds, approvals)).toBe(true);
  });

  it("false while at least one active member has not approved", () => {
    const activeMemberIds = [memberIdFor("m1"), memberIdFor("m2"), memberIdFor("m3")];
    const approvals = [approvalFor("m1"), approvalFor("m2")];

    expect(isUnanimouslyApproved(activeMemberIds, approvals)).toBe(false);
  });

  it("new PA-11 (B4): a solo circle's single active member closes their own pact", () => {
    const activeMemberIds = [memberIdFor("m1")];
    const approvals = [approvalFor("m1")];

    expect(isUnanimouslyApproved(activeMemberIds, approvals)).toBe(true);
  });

  it("false when there are no active members at all (nothing to be unanimous about)", () => {
    expect(isUnanimouslyApproved([], [])).toBe(false);
  });
});

describe("computeActualStart (B3, corrected)", () => {
  it("PA-7-corrected: closing on the nominal start date starts the season that same day", () => {
    const nominalStart = localDate("2026-10-01");
    const closingDate = localDate("2026-10-01");

    expect(computeActualStart(nominalStart, closingDate)).toBe("2026-10-01");
  });

  it("B3: closing before the nominal start date still starts on the nominal start date", () => {
    const nominalStart = localDate("2026-10-01");
    const closingDate = localDate("2026-09-28");

    expect(computeActualStart(nominalStart, closingDate)).toBe("2026-10-01");
  });

  it("PA-7-corrected: closing after the nominal start date shifts the start to the next day", () => {
    const nominalStart = localDate("2026-10-01");
    const closingDate = localDate("2026-10-04");

    expect(computeActualStart(nominalStart, closingDate)).toBe("2026-10-05");
  });
});

describe("closeSeason", () => {
  it("PA-1/PA-7: closes the pact, sets pactClosedAt and the corrected actualStart, keeps lengthWeeks (A6)", () => {
    const nominalStart = localDate("2026-10-01");
    const closingInstant = instant(1_800_000_000_000);
    const closingDate = localDate("2026-10-04");
    const season = seasonFixture({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      nominalStart,
      lengthWeeks: 8,
      version: 3,
    });

    const closed = closeSeason(season, [approvalFor("m1")], closingInstant, closingDate);

    expect(closed.status).toBe("active");
    expect(closed.pactClosedAt).toBe(closingInstant);
    expect(closed.actualStart).toBe("2026-10-05");
    expect(closed.lengthWeeks).toBe(8);
    expect(closed.version).toBe(4);
    expect(closed.approvals).toEqual([approvalFor("m1")]);
  });
});
