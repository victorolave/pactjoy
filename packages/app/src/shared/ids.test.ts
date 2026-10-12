import { describe, expect, it } from "vitest";
import { circleId, entryId, habitId, pauseRequestId, reviewId, seasonId, userId } from "./ids.ts";

describe("userId", () => {
  it("brands a non-empty string as a UserId", () => {
    const id = userId("user-1");

    expect(id).toBe("user-1");
  });

  it("rejects an empty string", () => {
    expect(() => userId("")).toThrow(RangeError);
  });
});

describe("pauseRequestId", () => {
  it("brands a non-empty string and rejects an empty one", () => {
    expect(pauseRequestId("pause-1")).toBe("pause-1");
    expect(() => pauseRequestId("")).toThrow(RangeError);
  });
});

describe("reviewId", () => {
  it("brands a non-empty string and rejects an empty one", () => {
    expect(reviewId("review-1")).toBe("review-1");
    expect(() => reviewId("")).toThrow(RangeError);
  });
});

describe("circleId / seasonId / habitId / entryId", () => {
  it("each brands its own non-empty string value", () => {
    expect(circleId("circle-1")).toBe("circle-1");
    expect(seasonId("season-1")).toBe("season-1");
    expect(habitId("habit-1")).toBe("habit-1");
    expect(entryId("entry-1")).toBe("entry-1");
  });

  it("each rejects an empty string with a RangeError", () => {
    expect(() => circleId("")).toThrow(RangeError);
    expect(() => seasonId("")).toThrow(RangeError);
    expect(() => habitId("")).toThrow(RangeError);
    expect(() => entryId("")).toThrow(RangeError);
  });
});
