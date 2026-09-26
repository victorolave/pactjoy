import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar";
import { graceDeadline, isOnTime } from "../entry/grace-period";
import { fromInt } from "../fraction/fraction";
import { pauseAwareWeekSessions } from "../pause/pause-aware-week";
import {
  buildPauseRequest,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";

/**
 * Decision Q5 (engine-authored — Notion has no exact-value row combining
 * both mechanics): the grace period only decides whether an entry is on
 * time; proration only scales targets. Both tests below call ONLY
 * `pauseAwareWeekSessions` — the same production function every other
 * pause-related acceptance row uses — with a real 3-day pause (matching
 * row E7's own 4-active-day setup) and entries that differ only in
 * *timing*, proving the combination produces the right number without
 * this file computing proration or grace itself.
 */
describe("acceptance: grace and proration are independent (Q5)", () => {
  const weeklyIngles = buildWeeklyTotalCommitment("ingles", 25, "minutes", {
    direction: "reach",
    minimum: fromInt(60),
    ideal: fromInt(150),
  });
  // Days 0-2 paused, days 3-6 active -> minimum 34 / ideal 86, same numbers row E7 already proves.
  const pauses = [
    buildPauseRequest(
      "ingles",
      0,
      { kind: "fixed", lastDay: seasonDay(2) },
      {
        kind: "approved",
        decidedOn: seasonDay(0),
        resumedOn: null,
      },
    ),
  ];

  it("a late-but-in-grace entry is accepted purely on timing, then scored against the already-prorated target", () => {
    const result = pauseAwareWeekSessions(
      weeklyIngles,
      0,
      pauses,
      [
        buildQuantityEntry("ingles", 3, fromInt(50)),
        // week 0's deadline is graceDeadline(6)=7 — recorded exactly on it
        buildQuantityEntry("ingles", 6, fromInt(36), seasonDay(7)),
      ],
      seasonDay(10),
    );
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions[0]?.progress).toEqual(fr("1")); // 50+36=86=prorated ideal, row E7's own "total 86 -> 1"
    expect(result.sessions[0]?.consistent).toBe(true);
  });

  it("the same late entry logged outside grace is rejected — same prorated target, different sum", () => {
    const result = pauseAwareWeekSessions(
      weeklyIngles,
      0,
      pauses,
      [
        buildQuantityEntry("ingles", 3, fromInt(50)),
        // grace deadline was day 7 — recorded day 8 is outside it, discarded regardless of proration
        buildQuantityEntry("ingles", 6, fromInt(36), seasonDay(8)),
      ],
      seasonDay(10),
    );
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions[0]?.progress).toEqual(fr("25/43")); // 50/86, row E7's own "total 50 -> 25/43"
  });

  it("grace acceptance is unaffected by the entry's own value — huge or tiny, only timing decides (isOnTime itself, a production primitive)", () => {
    const deadline = graceDeadline(seasonDay(6));
    expect(isOnTime(buildQuantityEntry("ingles", 6, fromInt(1), seasonDay(7)), deadline)).toBe(
      true,
    );
    expect(
      isOnTime(buildQuantityEntry("ingles", 6, fromInt(999_999), seasonDay(7)), deadline),
    ).toBe(true);
    expect(isOnTime(buildQuantityEntry("ingles", 6, fromInt(1), seasonDay(8)), deadline)).toBe(
      false,
    );
    expect(
      isOnTime(buildQuantityEntry("ingles", 6, fromInt(999_999), seasonDay(8)), deadline),
    ).toBe(false);
  });
});
