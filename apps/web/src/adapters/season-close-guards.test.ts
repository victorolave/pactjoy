import { describe, expect, it } from "vitest";
import {
  carryOverFixture,
  resultsFixture,
  seasonHistoryFixture,
  submittedClosureFixture,
} from "../testing/fixtures/season-close.ts";
import {
  isCarryOver,
  isSeasonHistory,
  isSeasonResults,
  isSubmittedClosure,
} from "./season-close-guards.ts";

describe("isSeasonResults", () => {
  it("accepts the final figures, with or without a closure of the member's own", () => {
    expect(isSeasonResults(resultsFixture())).toBe(true);
    expect(
      isSeasonResults(
        resultsFixture({
          status: "closed",
          closure: {
            decidedAt: "2026-10-21T15:00:00.000Z",
            decisions: [{ commitmentId: "c-1", decision: "pause" }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("accepts a member who finished at zero: no rank, no gap, no percentages", () => {
    expect(
      isSeasonResults(
        resultsFixture({
          totals: { points: 0, consistencyPercent: null, idealPercent: null },
          standings: { rank: null, memberCount: 1, gap: null },
        }),
      ),
    ).toBe(true);
  });

  it("rejects a body missing a field the screens read", () => {
    const { closingReviewDone: _drop, ...withoutFlag } = resultsFixture();
    expect(isSeasonResults(withoutFlag)).toBe(false);
    const { closure: _closure, ...withoutClosure } = resultsFixture();
    expect(isSeasonResults(withoutClosure)).toBe(false);
    expect(isSeasonResults({ ...resultsFixture(), totals: { points: 1 } })).toBe(false);
    expect(isSeasonResults({ ...resultsFixture(), commitments: [{ commitmentId: "c" }] })).toBe(
      false,
    );
  });

  it("rejects an unknown status, stage or decision", () => {
    expect(isSeasonResults({ ...resultsFixture(), status: "archived" })).toBe(false);
    const [first, ...rest] = resultsFixture().commitments;
    expect(
      isSeasonResults({ ...resultsFixture(), commitments: [{ ...first, stage: "wise" }, ...rest] }),
    ).toBe(false);
    expect(
      isSeasonResults({
        ...resultsFixture(),
        closure: { decidedAt: "x", decisions: [{ commitmentId: "c", decision: "later" }] },
      }),
    ).toBe(false);
  });
});

describe("isSubmittedClosure", () => {
  it("accepts the stored decisions with the graduated habits", () => {
    expect(isSubmittedClosure(submittedClosureFixture())).toBe(true);
  });

  it("rejects a body missing seasonClosed or graduatedHabitIds", () => {
    const { seasonClosed: _a, ...noClosed } = submittedClosureFixture();
    const { graduatedHabitIds: _b, ...noGraduated } = submittedClosureFixture();
    expect(isSubmittedClosure(noClosed)).toBe(false);
    expect(isSubmittedClosure(noGraduated)).toBe(false);
    expect(isSubmittedClosure({ ...submittedClosureFixture(), decisions: [{}] })).toBe(false);
  });
});

describe("isCarryOver", () => {
  it("accepts no previous season and the three kept decisions", () => {
    expect(isCarryOver(carryOverFixture())).toBe(true);
    expect(
      isCarryOver(
        carryOverFixture({
          previousSeasonId: "season-0",
          items: [
            {
              habitId: "h-1",
              decision: "continue",
              previous: {
                measure: { kind: "done" } as never,
                weightPercent: 30,
                privacy: "visible",
              },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("rejects graduate (it is never carried), a missing previous or a bad privacy", () => {
    const item = {
      habitId: "h-1",
      decision: "continue",
      previous: { measure: {}, weightPercent: 30, privacy: "visible" },
    };
    expect(
      isCarryOver({ previousSeasonId: null, items: [{ ...item, decision: "graduate" }] }),
    ).toBe(false);
    expect(isCarryOver({ previousSeasonId: null, items: [{ habitId: "h-1" }] })).toBe(false);
    expect(
      isCarryOver({
        previousSeasonId: null,
        items: [{ ...item, previous: { ...item.previous, privacy: "secret" } }],
      }),
    ).toBe(false);
    expect(isCarryOver({ items: [] })).toBe(false);
  });
});

describe("isSeasonHistory", () => {
  it("accepts a list, including an empty one", () => {
    expect(isSeasonHistory(seasonHistoryFixture())).toBe(true);
    expect(isSeasonHistory({ seasons: [] })).toBe(true);
  });

  it("rejects a row missing closedByMe or with a fractional count", () => {
    const [row] = seasonHistoryFixture().seasons;
    const { closedByMe: _drop, ...partial } = row ?? ({} as never);
    expect(isSeasonHistory({ seasons: [partial] })).toBe(false);
    expect(isSeasonHistory({ seasons: [{ ...row, memberCount: 1.5 }] })).toBe(false);
    expect(isSeasonHistory({})).toBe(false);
  });
});
