import { describe, expect, it } from "vitest";
import { fr } from "../test-support/fraction-literal";
import type { MemberId, StandingsParticipant } from "./standings";
import { rankStandings } from "./standings";

function participant(
  memberId: string,
  points: StandingsParticipant["points"],
  status: StandingsParticipant["status"] = "active",
): StandingsParticipant {
  return { memberId: memberId as MemberId, points, status };
}

describe("rankStandings", () => {
  it("ranks participants by points, descending", () => {
    const rows = rankStandings([
      participant("andrea", fr("600")),
      participant("victor", fr("800")),
    ]);
    expect(rows.map((row) => row.memberId)).toEqual(["victor", "andrea"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
  });

  it("gives tied participants a shared rank, skipping the next position (Q2 — 1, 2, 2, 4)", () => {
    // Illustrative fixture derived from decision Q2 (spec/standings scenario "Two participants tie for 2nd place");
    // no Notion worked-example row exists for standings.
    const rows = rankStandings([
      participant("a", fr("800")),
      participant("b", fr("600")),
      participant("c", fr("600")),
      participant("d", fr("400")),
    ]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(rows.map((row) => row.memberId)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the input order among tied participants (Q2 — no secondary tiebreaker)", () => {
    const rows = rankStandings([
      participant("second-in-input", fr("500")),
      participant("first-in-input", fr("500")),
    ]);
    expect(rows.map((row) => row.memberId)).toEqual(["second-in-input", "first-in-input"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
  });

  it(
    "compares DISPLAYED rounded points, not exact fractions (R2 override) — two members " +
      "shown as 250 are tied even though their exact values differ",
    () => {
      // Engine-authored fixture for R2 (no Notion row): 249.6 and 250.4 both round half-up to 250.
      const rows = rankStandings([
        participant("rounds-up-to-250", fr("2496/10")),
        participant("rounds-down-to-250", fr("2504/10")),
      ]);
      expect(rows.map((row) => row.rank)).toEqual([1, 1]);
    },
  );

  it("excludes members who left mid-season from ranking and from rank-position counting (Q3)", () => {
    // Illustrative fixture derived from decision Q3 (spec/standings scenario "A member who left is excluded");
    // no Notion worked-example row exists for standings.
    const rows = rankStandings([
      participant("a", fr("800")),
      participant("b", fr("600"), "left"),
      participant("c", fr("500")),
      participant("d", fr("400")),
    ]);
    expect(rows.map((row) => row.memberId)).toEqual(["a", "c", "d"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("returns an empty list when every participant left", () => {
    const rows = rankStandings([participant("a", fr("800"), "left")]);
    expect(rows).toEqual([]);
  });
});
