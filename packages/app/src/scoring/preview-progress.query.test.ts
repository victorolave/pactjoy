import { describe, expect, it } from "vitest";
import type { MeasureInput } from "../commitment/validate-commitment.ts";
import { userId } from "../shared/ids.ts";
import { previewProgress } from "./preview-progress.query.ts";

const actor = { userId: userId("andrea") };
const reach: MeasureInput = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "weeklyTotal" },
};

describe("previewProgress (SR-R3)", () => {
  it("uses the engine threshold, exact fractions and display rounding for reach", () => {
    expect(
      previewProgress(actor, { measure: reach, values: ["0", "5", "10", "20", "30", "45"] }),
    ).toEqual({
      ok: true,
      value: {
        rows: ["0", "5", "10", "20", "30", "45"].map((value, i) => ({
          value,
          progressPercent: ["0", "0", "33", "67", "100", "100"][i],
        })),
      },
    });
  });
  it("uses the limit band, including exact decimals and values over tolerance", () => {
    expect(
      previewProgress(actor, {
        measure: {
          unit: "hours",
          direction: "limit",
          ideal: "2",
          tolerance: "4",
          schedule: { period: "weeklyTotal" },
        },
        values: ["0", "2", "2.5", "4", "4.01"],
      }),
    ).toMatchObject({
      ok: true,
      value: {
        rows: [
          { value: "0", progressPercent: "100" },
          { value: "2", progressPercent: "100" },
          { value: "2.5", progressPercent: "88" },
          { value: "4", progressPercent: "50" },
          { value: "4.01", progressPercent: "0" },
        ],
      },
    });
  });
  it("reuses commitment validation for an invalid measure", () => {
    expect(
      previewProgress(actor, { measure: { ...reach, minimum: "40" }, values: ["10"] }),
    ).toEqual({ ok: false, error: { kind: "MinimumExceedsIdeal" } });
  });
  it.each(
    [[], Array(9).fill("1"), ["bad"], ["-1"], ["1.001"], ["1000000000"]].map((values) => ({
      values,
    })),
  )("rejects invalid sample values %j", ({ values }) => {
    expect(previewProgress(actor, { measure: reach, values })).toEqual({
      ok: false,
      error: { kind: "InvalidPreviewValues" },
    });
  });
  it("supports done and preserves sample order and duplicates", () => {
    expect(
      previewProgress(actor, {
        measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        values: ["1", "0", "1"],
      }),
    ).toEqual({
      ok: true,
      value: {
        rows: [
          { value: "1", progressPercent: "100" },
          { value: "0", progressPercent: "0" },
          { value: "1", progressPercent: "100" },
        ],
      },
    });
  });
});
