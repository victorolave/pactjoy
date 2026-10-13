import { describe, expect, it } from "vitest";
import { profileSummaryFixture } from "../testing/fixtures/profile.ts";
import { isProfileSummary } from "./profile-guards.ts";

describe("isProfileSummary", () => {
  it("accepts a full payload, a null percent and no habits", () => {
    expect(isProfileSummary(profileSummaryFixture())).toBe(true);
    expect(
      isProfileSummary(
        profileSummaryFixture({
          consistency: { kept: 0, counted: 0, percent: null, closedSeasons: 0, inProgress: false },
          habits: [],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a missing or malformed consistency", () => {
    const { habits } = profileSummaryFixture();
    expect(isProfileSummary({ habits })).toBe(false);
    expect(isProfileSummary({ consistency: null, habits })).toBe(false);
    expect(isProfileSummary({ consistency: "84", habits })).toBe(false);
    expect(isProfileSummary({ consistency: { kept: 1, counted: 2 }, habits })).toBe(false);
  });

  it("rejects non-integer, negative or mistyped figures", () => {
    const base = profileSummaryFixture().consistency;
    const bad = [
      { kept: 1.5 },
      { counted: -1 },
      { kept: "1" },
      { percent: 84.5 },
      { percent: "84" },
      { closedSeasons: 0.5 },
      { inProgress: "yes" },
    ];
    for (const patch of bad) {
      const consistency = { ...base, ...patch };
      expect([patch, isProfileSummary({ ...profileSummaryFixture(), consistency })]).toEqual([
        patch,
        false,
      ]);
    }
  });

  it("rejects a missing or malformed habits list", () => {
    const { consistency } = profileSummaryFixture();
    expect(isProfileSummary({ consistency })).toBe(false);
    expect(isProfileSummary({ consistency, habits: {} })).toBe(false);
    expect(isProfileSummary({ consistency, habits: [null] })).toBe(false);
  });

  it("rejects a habit with a bad stage (graduated is never listed), id, name, icon or flag", () => {
    const [habit] = profileSummaryFixture().habits;
    const bad = [
      { stage: "graduated" },
      { stage: "bogus" },
      { habitId: "" },
      { name: 3 },
      { icon: 5 },
      { inCurrentSeason: "no" },
    ];
    for (const patch of bad) {
      const habits = [{ ...habit, ...patch }];
      expect([patch, isProfileSummary({ ...profileSummaryFixture(), habits })]).toEqual([
        patch,
        false,
      ]);
    }
  });
});
