import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { type TodayView, today } from "./today.query.ts";

const ANDREA = memberId("member-andrea");

/** Day 0 is 2026-10-01; the season has 28 days, so the cap is 14 natural days per Commitment. */
async function setup(day: number) {
  const app = createTestApp({ now: localInstant(dayOf(day)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, given };
}

type Seed = {
  start: number;
  end: number | "open";
  decision: "pending" | "approved" | "rejected";
  resumedOn?: number;
};

function seed(
  { app, given }: Awaited<ReturnType<typeof setup>>,
  { start, end, decision, resumedOn }: Seed,
) {
  const request: MemberPauseRequest = {
    memberId: ANDREA,
    commitmentId: given.andreaCommitment,
    requestedOn: seasonDay(start),
    startDay: seasonDay(start),
    end: end === "open" ? { kind: "open" } : { kind: "fixed", lastDay: seasonDay(end) },
    decision:
      decision === "pending"
        ? { kind: "pending" }
        : decision === "approved"
          ? {
              kind: "approved",
              decidedOn: seasonDay(start),
              resumedOn: resumedOn === undefined ? null : seasonDay(resumedOn),
            }
          : { kind: "rejected", decidedOn: seasonDay(start) },
  };
  app.pauses.seed(given.season.id, request);
}

function pauseOf(view: TodayView) {
  if (view.state !== "active" && view.state !== "ended") throw new Error(`state ${view.state}`);
  return view.rows[0]?.pause;
}

const readAt = async (ctx: Awaited<ReturnType<typeof setup>>, day: number) =>
  pauseOf(await today(atInstant(ctx.app, localInstant(dayOf(day))), ctx.given.andrea));

describe("today rows: the nested pause object (PA-9, TR-1..TR-3)", () => {
  it("is null when the Commitment has no pause", async () => {
    const ctx = await setup(3);
    expect(await readAt(ctx, 3)).toBeNull();
  });

  it("a pending request can be cancelled, not resumed, and never ends tomorrow", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 3, end: 4, decision: "pending" });
    expect(await readAt(ctx, 3)).toEqual({
      pauseRequestId: "seeded-pause-1",
      status: "pending",
      reason: "other",
      endDate: dayOf(4),
      endsTomorrow: false,
      canResume: false,
      canCancel: true,
    });
  });

  it("an approved running request can be resumed and flags its last day tomorrow", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 3, end: 5, decision: "approved" });
    expect(await readAt(ctx, 3)).toMatchObject({
      status: "approved",
      endDate: dayOf(5),
      endsTomorrow: false,
      canResume: true,
      canCancel: false,
    });
    expect(await readAt(ctx, 4)).toMatchObject({ endsTomorrow: true, canResume: true });
    expect(await readAt(ctx, 5)).toMatchObject({ endsTomorrow: false, canResume: true });
    expect(await readAt(ctx, 6)).toBeNull();
  });

  it("an approved request that has not started is resumable (it acts as a cancel) and not ending", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 6, end: 7, decision: "approved" });
    expect(await readAt(ctx, 3)).toMatchObject({
      status: "approved",
      endsTomorrow: false,
      canResume: true,
      canCancel: false,
    });
  });

  it("a one-day request starting tomorrow does not end tomorrow", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 4, end: 4, decision: "approved" });
    expect(await readAt(ctx, 3)).toMatchObject({ endsTomorrow: false });
  });

  it("an open pause flags the day before the cap would end it (Q12)", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 3, end: "open", decision: "approved" });
    expect(await readAt(ctx, 3)).toMatchObject({
      endDate: null,
      endsTomorrow: false,
      canResume: true,
    });
    expect(await readAt(ctx, 14)).toMatchObject({ endsTomorrow: false });
    expect(await readAt(ctx, 15)).toMatchObject({ endsTomorrow: true, canResume: true });
    expect(await readAt(ctx, 16)).toMatchObject({ endsTomorrow: false, canResume: true });
    expect(await readAt(ctx, 17)).toBeNull();
  });

  it("is null once resumed, rejected or cancelled", async () => {
    const resumed = await setup(5);
    seed(resumed, { start: 3, end: 9, decision: "approved", resumedOn: 5 });
    expect(await readAt(resumed, 5)).toBeNull();

    const rejected = await setup(3);
    seed(rejected, { start: 3, end: 9, decision: "rejected" });
    expect(await readAt(rejected, 3)).toBeNull();
  });

  it("picks the request that covers today over a later one", async () => {
    const ctx = await setup(3);
    seed(ctx, { start: 10, end: 11, decision: "approved" });
    seed(ctx, { start: 3, end: 4, decision: "approved" });
    expect(await readAt(ctx, 3)).toMatchObject({ pauseRequestId: "seeded-pause-2" });
    expect(await readAt(ctx, 6)).toMatchObject({ pauseRequestId: "seeded-pause-1" });
  });
});
