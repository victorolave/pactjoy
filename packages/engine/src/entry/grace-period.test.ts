import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar";
import { buildDoneEntry } from "../test-support/builders";
import { graceDeadline, isOnTime } from "./grace-period";

describe("graceDeadline", () => {
  it("is the day after the period ends", () => {
    expect(graceDeadline(seasonDay(6))).toBe(7);
  });

  it("advances by one day regardless of where the period ends", () => {
    expect(graceDeadline(seasonDay(13))).toBe(14);
  });
});

describe("isOnTime", () => {
  it("accepts an entry recorded exactly on the deadline", () => {
    const entry = buildDoneEntry("read", 6, 7);
    expect(isOnTime(entry, graceDeadline(seasonDay(6)))).toBe(true);
  });

  it("accepts an entry recorded before the deadline", () => {
    const entry = buildDoneEntry("read", 6, 6);
    expect(isOnTime(entry, graceDeadline(seasonDay(6)))).toBe(true);
  });

  it("rejects an entry recorded after the deadline", () => {
    const entry = buildDoneEntry("read", 6, 8);
    expect(isOnTime(entry, graceDeadline(seasonDay(6)))).toBe(false);
  });
});
