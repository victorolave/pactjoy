import { describe, expect, it } from "vitest";
import { setup } from "./harness.ts";
import { REACH } from "./season-fixture.ts";

describe("POST /scoring/preview (SR-R3)", () => {
  it("returns progress rows without any repository access", async () => {
    const { call, read, transaction } = setup();
    const result = await call("POST", "/scoring/preview", "andrea", {
      measure: REACH,
      values: ["10", "20", "30"],
    });
    expect([result.status, result.json.data]).toEqual([
      200,
      {
        rows: [
          { value: "10", progressPercent: "33" },
          { value: "20", progressPercent: "67" },
          { value: "30", progressPercent: "100" },
        ],
      },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("returns limit progress at the ideal, tolerance and beyond tolerance", async () => {
    const { call } = setup();
    const result = await call("POST", "/scoring/preview", "andrea", {
      measure: {
        unit: "hours",
        direction: "limit",
        ideal: "2",
        tolerance: "4",
        schedule: { period: "weeklyTotal" },
      },
      values: ["2", "2.5", "4", "4.01"],
    });
    expect([result.status, result.json.data]).toEqual([
      200,
      {
        rows: [
          { value: "2", progressPercent: "100" },
          { value: "2.5", progressPercent: "88" },
          { value: "4", progressPercent: "50" },
          { value: "4.01", progressPercent: "0" },
        ],
      },
    ]);
  });
  it.each([
    [{ measure: REACH, values: Array(9).fill("1") }, "InvalidRequest"],
    [{ measure: REACH, values: [] }, "InvalidPreviewValues"],
    [{ measure: REACH, values: ["bad"] }, "InvalidPreviewValues"],
    [{ measure: { ...REACH, minimum: "40" }, values: ["1"] }, "MinimumExceedsIdeal"],
  ])("rejects invalid input with 422", async (body, code) => {
    const { call, read, transaction } = setup();
    const result = await call("POST", "/scoring/preview", "andrea", body);
    expect([result.status, result.json.error.code]).toEqual([422, code]);
    expect(read).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires an authenticated actor", async () => {
    const { call } = setup();
    const result = await call("POST", "/scoring/preview", null, { measure: REACH, values: ["0"] });
    expect([result.status, result.json.error.code]).toEqual([401, "Unauthorized"]);
  });
});
