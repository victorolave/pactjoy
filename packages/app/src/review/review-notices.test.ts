import { describe, expect, it } from "vitest";
import { createTestApp } from "../testing/app-harness.ts";
import { reviewFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { localDate } from "../time/local-date.ts";
import { interimReviewDueFrom, isReviewDue } from "./review-notices.ts";

/**
 * The review side of `reviewDue` (ADR-0017): which interim review opens on a date (the closing one
 * is announced by `seasonClosed` instead), and whether a member's review is still due, read through
 * the owner-only review module (`review-guard.test.ts`).
 */

async function given() {
  const app = createTestApp({ timeZone: fixtureTimeZone });
  // 4 weeks, cadence 2: interim review 1 from day 15 (2026-10-15), closing review 2 from day 29.
  const world = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, ...world };
}

describe("interimReviewDueFrom", () => {
  it("names the interim period whose window opens on the date", async () => {
    const { season } = await given();
    expect(interimReviewDueFrom(season, localDate("2026-10-15"))).toBe(1);
  });

  it("is null on any other day, and for the closing review's first day", async () => {
    const { season } = await given();
    expect(interimReviewDueFrom(season, localDate("2026-10-14"))).toBeNull();
    expect(interimReviewDueFrom(season, localDate("2026-10-16"))).toBeNull();
    expect(interimReviewDueFrom(season, localDate("2026-10-29"))).toBeNull();
  });

  it("is null for a season without a start day", async () => {
    const { season } = await given();
    expect(interimReviewDueFrom({ ...season, actualStart: null }, dayOf(14))).toBeNull();
  });
});

describe("isReviewDue", () => {
  it("is true inside the window while the member has not answered", async () => {
    const { app, season, circle } = await given();
    const andrea = circle.members[0]?.id;
    if (!andrea) throw new Error("fixture");
    const due = await app.uow.read((repos) =>
      isReviewDue(repos, season, andrea, 1, localDate("2026-10-16")),
    );
    expect(due).toBe(true);
  });

  it("is false once the member completed it, before the window, and for another period", async () => {
    const { app, season, circle } = await given();
    const andrea = circle.members[0]?.id;
    if (!andrea) throw new Error("fixture");
    const check = (period: number, date: string) =>
      app.uow.read((repos) => isReviewDue(repos, season, andrea, period, localDate(date)));
    expect(await check(1, "2026-10-14")).toBe(false);
    expect(await check(2, "2026-10-16")).toBe(false);
    await app.reviews.save(
      reviewFixture({ seasonId: season.id, memberId: andrea, periodIndex: 1 }),
      null,
    );
    expect(await check(1, "2026-10-16")).toBe(false);
  });
});
