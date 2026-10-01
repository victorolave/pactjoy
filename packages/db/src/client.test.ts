import { describe, expect, it, vi } from "vitest";
import { clientOptions, executorOver } from "./client.ts";

describe("clientOptions", () => {
  it("DC-R2: turns prepared statements off (transaction poolers break them)", () => {
    expect(clientOptions({ max: 3 })).toMatchObject({ prepare: false, max: 3 });
  });

  it("wires the codecs onto the OIDs of timestamptz, date and int8", () => {
    const { types } = clientOptions({});

    expect(types.timestamptz).toMatchObject({ to: 1184, from: [1184] });
    expect(types.timestamptz.parse("2026-09-30 16:49:48.789123+00")).toBe(
      Date.UTC(2026, 8, 30, 16, 49, 48, 789),
    );
    expect(types.date).toMatchObject({ to: 1082, from: [1082] });
    expect(types.date.parse("2026-09-30")).toBe("2026-09-30");
    expect(types.int8).toMatchObject({ to: 20, from: [20] });
    expect(types.int8.parse("9007199254740993")).toBe(9007199254740993n);
  });

  it("silences server notices", () => {
    expect(() => clientOptions({}).onnotice()).not.toThrow();
  });
});

describe("executorOver", () => {
  it("runs parameterized text through unsafe and reports rows and the affected count", async () => {
    const unsafe = vi.fn(async () => Object.assign([{ id: 1 }, { id: 2 }], { count: 2 }));

    const result = await executorOver({ unsafe }).query("select id from t where a = $1", ["x"]);

    expect(unsafe).toHaveBeenCalledWith("select id from t where a = $1", ["x"]);
    expect(result).toEqual({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
  });

  it("reports the affected count of a statement that returns no rows", async () => {
    const unsafe = async () => Object.assign([], { count: 3 });

    expect((await executorOver({ unsafe }).query("delete from t", [])).rowCount).toBe(3);
  });
});
