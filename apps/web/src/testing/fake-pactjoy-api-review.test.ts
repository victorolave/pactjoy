import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";
import {
  baselineFixture,
  interimFullFixture,
  stageFixture,
  submittedFixture,
} from "./fixtures/review.ts";
import { activeTodayFixture } from "./fixtures/today.ts";

const command = {
  reflection: { helped: null, hard: null },
  automaticity: [{ commitmentId: "c-1", items: [5, 4, 5, 4] as const }],
};

describe("FakePactJoyApi review methods", () => {
  it("serves the scripted draft per season and period and counts the read", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    api.setReview("season-1", 2, interimFullFixture());
    api.setReview("season-1", 0, baselineFixture());
    await expect(api.getReview("season-1", 2)).resolves.toEqual(interimFullFixture());
    await expect(api.getReview("season-1", 0)).resolves.toEqual(baselineFixture());
    expect(api.calls.getReview).toBe(2);
  });

  it("answers ReviewPeriodNotFound for a period that was not scripted", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    await expect(api.getReview("season-1", 9)).rejects.toMatchObject({
      code: "ReviewPeriodNotFound",
    });
  });

  it("records the submitted command and answers the scripted result", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    api.setSubmitResult(submittedFixture({ nextReviewDate: "2026-10-20" }));
    await expect(api.submitReview("season-1", 2, command)).resolves.toMatchObject({
      nextReviewDate: "2026-10-20",
    });
    expect(api.reviewCommands).toEqual([
      { method: "submitReview", args: ["season-1", 2, command] },
    ]);
  });

  it("clears the offer on Today after a submit or a skip, like the server", async () => {
    const today = activeTodayFixture();
    const api = new FakePactJoyApi({
      ...today,
      baselineOffer: { seasonId: "season-1", periodIndex: 0, offeredUntil: "2026-10-04" },
    } as typeof today);
    await api.skipBaseline("season-1");
    expect((await api.getToday()).state === "active" && (await api.getToday())).toMatchObject({
      baselineOffer: null,
      pendingReview: null,
    });
    expect(api.reviewCommands).toEqual([{ method: "skipBaseline", args: ["season-1"] }]);
  });

  it("fails the next call when scripted and waits on a held gate", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    api.failNext("submitReview", new ApiError("ReviewAlreadySubmitted", 409, null));
    await expect(api.submitReview("season-1", 2, command)).rejects.toMatchObject({
      code: "ReviewAlreadySubmitted",
    });
    const release = api.hold("submitReview");
    let done = false;
    const pending = api.submitReview("season-1", 2, command).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
  });

  it("serves a stage per commitment, new by default", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    api.setStage(stageFixture("c-1", "integrated"));
    await expect(api.getCommitmentStage("season-1", "c-1")).resolves.toEqual(
      stageFixture("c-1", "integrated"),
    );
    await expect(api.getCommitmentStage("season-1", "c-2")).resolves.toEqual(
      stageFixture("c-2", "new"),
    );
  });
});
