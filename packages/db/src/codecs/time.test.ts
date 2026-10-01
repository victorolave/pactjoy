import { describe, expect, it } from "vitest";
import { formatInstant, parseDate, parseTimestamptz } from "./time.ts";

const MS = Date.UTC(2026, 8, 30, 16, 49, 48, 789);

describe("parseTimestamptz", () => {
  it("parses UTC with a short offset", () => {
    expect(parseTimestamptz("2026-09-30 16:49:48.789+00")).toBe(MS);
  });

  it("applies positive and negative offsets, with and without minutes", () => {
    expect(parseTimestamptz("2026-09-30 21:49:48.789+05")).toBe(MS);
    expect(parseTimestamptz("2026-09-30 22:19:48.789+05:30")).toBe(MS);
    expect(parseTimestamptz("2026-09-30 11:49:48.789-05")).toBe(MS);
    expect(parseTimestamptz("2026-09-30 11:19:48.789-05:30")).toBe(MS);
    expect(parseTimestamptz("2026-10-01 06:49:48.789+14")).toBe(MS);
  });

  it("truncates 0 to 6 fraction digits to whole milliseconds, never rounds", () => {
    const base = Date.UTC(2026, 8, 30, 16, 49, 48);
    expect(parseTimestamptz("2026-09-30 16:49:48+00")).toBe(base);
    expect(parseTimestamptz("2026-09-30 16:49:48.7+00")).toBe(base + 700);
    expect(parseTimestamptz("2026-09-30 16:49:48.78+00")).toBe(base + 780);
    expect(parseTimestamptz("2026-09-30 16:49:48.789123+00")).toBe(base + 789);
    expect(parseTimestamptz("2026-09-30 16:49:48.789999+00")).toBe(base + 789);
    expect(parseTimestamptz("2026-09-30 16:49:48.000999+00")).toBe(base);
  });

  it("parses the epoch", () => {
    expect(parseTimestamptz("1970-01-01 00:00:00+00")).toBe(0);
  });

  it.each([
    "",
    "infinity",
    "-infinity",
    "2026-09-30",
    "2026-09-30T16:49:48.789+00",
    "2026-09-30 16:49:48.789",
    "2026-09-30 16:49:48.1234567+00",
    "2026-13-30 16:49:48+00",
    "2026-02-30 16:49:48+00",
    "2026-09-30 24:00:00+00",
    "0044-03-15 12:00:00+00 BC",
    "1969-12-31 23:59:59+00",
    "0070-01-01 00:00:00+00",
    "2026-09-30 16:49:48+99:99",
    "2026-09-30 16:49:48+16",
    "2026-09-30 16:49:48+05:60",
  ])("throws on invalid or unsupported input %j", (text) => {
    expect(() => parseTimestamptz(text)).toThrow();
  });
});

describe("formatInstant", () => {
  it("serializes to an ISO string that round-trips through the parser", () => {
    const iso = formatInstant(MS as never);
    expect(iso).toBe("2026-09-30T16:49:48.789Z");
    expect(parseTimestamptz(iso.replace("T", " ").replace("Z", "+00"))).toBe(MS);
  });
});

describe("parseDate", () => {
  it("returns the raw string, untouched by any time zone", () => {
    expect(parseDate("2026-09-30")).toBe("2026-09-30");
  });

  it("throws on a non-calendar value", () => {
    expect(() => parseDate("infinity")).toThrow();
  });
});
