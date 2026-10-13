import type { MemberId } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { ReviewDay } from "../../review/review-schedule.ts";
import { circleId, seasonId } from "../../shared/ids.ts";
import { seasonFixture } from "../../testing/builders.ts";
import { finalizeSeason, type MoveOnState, moveOnState } from "./move-on.ts";

const A = "member-andrea" as MemberId;
const B = "member-beto" as MemberId;
const C = "member-clara" as MemberId;

const season = seasonFixture({
  id: seasonId("season-1"),
  circleId: circleId("circle-1"),
  status: "active",
  lengthWeeks: 4,
});
const day = (n: number): ReviewDay => ({ kind: "day", day: n });
const BLOCKED: MoveOnState = { kind: "blocked", resultsFrom: 30, staleFrom: 36 };

describe("moveOnState (L=4: results from day 30, stale from day 36)", () => {
  it.each([
    ["the last season day", 28],
    ["the grace day", 29],
  ])("%s: never complete, even when everybody has closed", (_label, n) => {
    expect(moveOnState(season, [A, B], [A, B], day(n))).toEqual(BLOCKED);
  });

  it("before the start: blocked", () => {
    expect(moveOnState(season, [A], [A], { kind: "beforeStart" })).toEqual(BLOCKED);
  });

  it("complete once results opened and every participant closed", () => {
    expect(moveOnState(season, [A, B], [B, A], day(30))).toEqual({ kind: "complete" });
    expect(moveOnState(season, [A, B], [A, B], day(35))).toEqual({ kind: "complete" });
  });

  it("partial closures stay blocked until the stale day", () => {
    expect(moveOnState(season, [A, B], [A], day(30))).toEqual(BLOCKED);
    expect(moveOnState(season, [A, B], [A], day(35))).toEqual(BLOCKED);
  });

  it("stale from day 36 with laggards", () => {
    expect(moveOnState(season, [A, B], [A], day(36))).toEqual({ kind: "stale" });
    expect(moveOnState(season, [A, B], [], day(50))).toEqual({ kind: "stale" });
  });

  it("complete wins over stale when everybody did close", () => {
    expect(moveOnState(season, [A, B], [A, B], day(40))).toEqual({ kind: "complete" });
  });

  it("no participants: complete from the results day (nobody to wait for)", () => {
    expect(moveOnState(season, [], [], day(30))).toEqual({ kind: "complete" });
    expect(moveOnState(season, [], [], day(29))).toEqual(BLOCKED);
  });

  it("a closure by someone who is not a participant (left, or 0 commitments) does not count or block", () => {
    expect(moveOnState(season, [A], [A, C], day(30))).toEqual({ kind: "complete" });
    expect(moveOnState(season, [A, B], [A, C], day(30))).toEqual(BLOCKED);
  });

  it("reports the calendar days of the season length in the blocked state", () => {
    const eight = { ...season, lengthWeeks: 8 as const };
    expect(moveOnState(eight, [A], [], day(58))).toEqual({
      kind: "blocked",
      resultsFrom: 58,
      staleFrom: 64,
    });
  });
});

describe("finalizeSeason", () => {
  it("closes an active season and bumps its version", () => {
    expect(finalizeSeason({ ...season, version: 3 })).toEqual({
      ...season,
      status: "closed",
      version: 4,
    });
  });

  it("is idempotent on a closed season (REQ-F13)", () => {
    const closed = { ...season, status: "closed" as const, version: 4 };
    expect(finalizeSeason(closed)).toBe(closed);
  });
});
