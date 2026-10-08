import { describe, expect, it } from "vitest";
import { HABIT_ICONS } from "../features/habits/index.ts";
import { ApiError } from "../ports/api-error.ts";
import { FakeSeasonProgressApi } from "./fake-season-progress.ts";
import {
  activeSeasonProgress,
  commitmentProgress,
  endedSeasonProgress,
  firstDaySeasonProgress,
  peerMemberProgress,
  weekSummary,
} from "./fixtures/season-progress.ts";

describe("FakeSeasonProgressApi", () => {
  it("returns the response scripted for exactly those arguments and counts the call", async () => {
    const api = new FakeSeasonProgressApi();
    const season = activeSeasonProgress();
    api.setSeasonProgress("season-1", season);
    api.setWeekSummary("season-1", 3, weekSummary());
    expect(await api.getSeasonProgress("season-1")).toBe(season);
    expect((await api.getWeekSummary("season-1", 3)).weekIndex).toBe(3);
    expect(api.calls).toEqual({
      getSeasonProgress: 1,
      getMemberProgress: 0,
      getCommitmentProgress: 0,
      getWeekSummary: 1,
    });
    expect(api.commands).toEqual([
      { method: "getSeasonProgress", args: ["season-1"] },
      { method: "getWeekSummary", args: ["season-1", 3] },
    ]);
  });

  it("does not invent a response that was not scripted", async () => {
    const api = new FakeSeasonProgressApi();
    api.setMemberProgress("season-1", "member-andrea", peerMemberProgress());
    await expect(api.getMemberProgress("season-1", "member-other")).rejects.toThrow(
      "getMemberProgress",
    );
    await expect(api.getCommitmentProgress("season-1", "c1")).rejects.toThrow();
  });

  it("queues failures and holds responses to test pending and error UI", async () => {
    const api = new FakeSeasonProgressApi();
    api.setCommitmentProgress("season-1", "commitment-leer", commitmentProgress());
    api.failNext("getCommitmentProgress", new ApiError("NetworkError", 0, null));
    await expect(api.getCommitmentProgress("season-1", "commitment-leer")).rejects.toMatchObject({
      code: "NetworkError",
    });
    const release = api.hold("getCommitmentProgress");
    let settled = false;
    const pending = api.getCommitmentProgress("season-1", "commitment-leer").then((view) => {
      settled = true;
      return view;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await pending).state).toBe("active");
  });
});

describe("season progress fixtures", () => {
  it("carry stored habit icon keys from the catalog, never glyph names", () => {
    const detail = commitmentProgress();
    const peer = peerMemberProgress();
    const icons = [
      ...activeSeasonProgress().own.commitments,
      ...peer.commitments.flatMap((row) => (row.kind === "detail" ? [row] : [])),
      detail.commitment,
      ...weekSummary().commitments,
    ].map((row) => row.habit.icon);
    const keys: readonly (string | null)[] = HABIT_ICONS.map((icon) => icon.key);
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(keys).toContain(icon);
  });

  it("shapes standings by circle size: solo, pair and up to six members", () => {
    for (const size of [1, 2, 3, 6] as const) {
      const view = activeSeasonProgress({ memberCount: size });
      expect(view.standings.memberCount).toBe(size);
      expect(view.standings.rows).toHaveLength(size);
      expect(view.weeks.every((week) => week.members.length === size)).toBe(true);
    }
  });

  it("leaves first-day rows unnumbered and metrics null instead of zero", () => {
    const view = firstDaySeasonProgress();
    expect(view.standings.rows.map((row) => [row.displayName, row.rank])).toEqual([
      ["Andrea", null],
      ["Victor", null],
    ]);
    expect(view.own.consistency).toBeNull();
    expect(view.own.idealCompletion).toBeNull();
  });

  it("keeps a peer's private row to exactly its reference, weight and points", () => {
    const hidden = peerMemberProgress().commitments.filter((c) => c.kind === "hidden");
    expect(hidden.map((row) => Object.keys(row).sort())).toEqual([
      ["commitmentId", "kind", "points", "weightPercent"],
    ]);
  });

  it("clamps the calendar after the end while scoring keeps the real day", () => {
    const view = endedSeasonProgress();
    expect(view.state).toBe("ended");
    expect(view.calendar.today > view.season.lastDay).toBe(true);
    expect(view.calendar.weekIndex).toBe(view.season.lengthWeeks - 1);
    expect(view.calendar.daysLeft).toBe(0);
  });
});
