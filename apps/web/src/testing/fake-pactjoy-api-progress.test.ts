import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";
import { activeSeasonProgress, weekSummary } from "./fixtures/season-progress.ts";

describe("FakePactJoyApi progress reads", () => {
  it("delegates to the standalone progress fake and counts the calls on both", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    const season = activeSeasonProgress();
    api.progress.setSeasonProgress("season-1", season);
    api.progress.setWeekSummary("season-1", 3, weekSummary());

    expect(await api.getSeasonProgress("season-1")).toBe(season);
    expect((await api.getWeekSummary("season-1", 3)).weekIndex).toBe(3);
    expect(api.calls.getSeasonProgress).toBe(1);
    expect(api.calls.getWeekSummary).toBe(1);
    expect(api.progress.calls.getSeasonProgress).toBe(1);
    expect(api.calls.getMemberProgress + api.calls.getCommitmentProgress).toBe(0);
  });

  it("never invents a view and fails the way it was scripted", async () => {
    const api = new FakePactJoyApi({ state: "noCircle" });
    await expect(api.getMemberProgress("season-1", "member-andrea")).rejects.toThrow(
      "getMemberProgress",
    );
    api.failNext("getCommitmentProgress", new ApiError("NotAMember", 403, null));
    await expect(api.getCommitmentProgress("season-1", "c1")).rejects.toMatchObject({
      code: "NotAMember",
    });
  });
});
