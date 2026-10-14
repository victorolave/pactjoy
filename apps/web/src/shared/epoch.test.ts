import { describe, expect, it } from "vitest";
import { epochMs } from "./epoch.ts";

describe("epochMs", () => {
  it("keeps epoch milliseconds as they are", () => {
    expect(epochMs(1_760_000_000_000)).toBe(1_760_000_000_000);
  });

  it("reads an ISO instant", () => {
    expect(epochMs("2026-10-13T12:00:00.000Z")).toBe(Date.parse("2026-10-13T12:00:00.000Z"));
  });

  it("an unreadable string is NaN (callers treat that as expired)", () => {
    expect(Number.isNaN(epochMs("later"))).toBe(true);
  });
});
