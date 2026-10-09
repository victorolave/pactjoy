import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("Lote 2 scroll and clipping CSS contract (owner bug regression)", () => {
  const weekSummaryCss = read("../season-week/WeekSummary.module.css");
  const memberSeasonCss = read("../season-member/MemberSeason.module.css");
  const overviewCss = read("./Overview.module.css");
  const commitmentCss = read("../season-commitment/CommitmentScreen.module.css");

  describe("WeekSummaryScreen (25b/25c)", () => {
    it("page uses min-height, never a fixed height, so the screen can scroll", () => {
      expect(weekSummaryCss).toMatch(/\.page\s*\{[^}]*min-height:\s*var\(--shell-height\)/);
      expect(weekSummaryCss).not.toMatch(
        /\.page\s*\{[^}]*[^i-][^n-]height:\s*var\(--shell-height\)/,
      );
    });

    it("content does not trap scrolling in an inner fixed-height container", () => {
      // Content must NOT have overflow-y: auto with min-height: 0
      expect(weekSummaryCss).not.toMatch(/\.content\s*\{[^}]*overflow-y:\s*auto/);
      expect(weekSummaryCss).not.toMatch(/\.content\s*\{[^}]*min-height:\s*0/);
    });

    it("flush habit list card does not shrink or clip overflowing content", () => {
      expect(weekSummaryCss).toMatch(
        /\.content\s*>\s*:global\(\.pj-card--flush\)\s*\{[^}]*overflow:\s*visible/,
      );
      expect(weekSummaryCss).toMatch(
        /\.content\s*>\s*:global\(\.pj-card--flush\)\s*\{[^}]*flex-shrink:\s*0/,
      );
    });

    it("content items and footer button do not shrink in flex column", () => {
      expect(weekSummaryCss).toMatch(/\.content\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/);
      expect(weekSummaryCss).toMatch(/\.footer\s*\{[^}]*flex-shrink:\s*0/);
    });
  });

  describe("MemberSeasonScreen (23d peer)", () => {
    it("commitments card does not shrink or clip overflowing rows", () => {
      expect(memberSeasonCss).toMatch(
        /\.group\s*:global\(\.pj-card--flush\)\s*\{[^}]*overflow:\s*visible/,
      );
      expect(memberSeasonCss).toMatch(
        /\.group\s*:global\(\.pj-card--flush\)\s*\{[^}]*flex-shrink:\s*0/,
      );
    });

    it("content items do not shrink in flex column", () => {
      expect(memberSeasonCss).toMatch(/\.content\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/);
    });
  });

  describe("SeasonOverview (23a)", () => {
    it("commitments card does not shrink or clip rows", () => {
      expect(overviewCss).toMatch(/\.commitmentsCard\s*\{[^}]*flex-shrink:\s*0/);
      expect(overviewCss).toMatch(/\.commitmentsCard\s*\{[^}]*overflow:\s*visible/);
    });
  });

  describe("CommitmentScreen (24 history)", () => {
    it("card and content items do not shrink or clip history grid", () => {
      expect(commitmentCss).toMatch(/\.card\s*\{[^}]*flex-shrink:\s*0/);
      expect(commitmentCss).toMatch(/\.card\s*\{[^}]*overflow:\s*visible/);
      expect(commitmentCss).toMatch(/\.content\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/);
    });
  });

  describe("global rule: no list container has overflow:hidden with fixed max-height", () => {
    const sheets = [
      ["WeekSummary.module.css", weekSummaryCss],
      ["MemberSeason.module.css", memberSeasonCss],
      ["Overview.module.css", overviewCss],
      ["CommitmentScreen.module.css", commitmentCss],
    ] as const;

    it.each(sheets)("%s has no fixed max-height on list containers", (_, css) => {
      expect(css).not.toMatch(/max-height:\s*\d+/);
    });
  });
});
