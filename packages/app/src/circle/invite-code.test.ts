import { describe, expect, it } from "vitest";
import { createSeededRandomSource } from "../testing/seeded-random.ts";
import { instant } from "../time/instant.ts";
import { generateInviteCode, inviteCodeExpiresAt, normalizeInviteCode } from "./invite-code.ts";

const SAFE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

describe("generateInviteCode", () => {
  it("CM-3: draws 6 characters from the safe alphabet (no 0/O/1/I/L)", () => {
    const random = createSeededRandomSource(7);

    const code = generateInviteCode(random);

    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(SAFE_ALPHABET).toContain(char);
    }
  });

  it("draws a different code for a different seed (proves it uses the RandomSource, not a constant)", () => {
    const first = generateInviteCode(createSeededRandomSource(1));
    const second = generateInviteCode(createSeededRandomSource(2));

    expect(first).not.toBe(second);
  });
});

describe("inviteCodeExpiresAt", () => {
  it("CM-3: expires exactly 7 days (in ms) after it was generated", () => {
    const generatedAt = instant(1_700_000_000_000);

    const expiresAt = inviteCodeExpiresAt(generatedAt);

    expect(expiresAt).toBe(generatedAt + 7 * 24 * 60 * 60 * 1000);
  });
});

describe("normalizeInviteCode", () => {
  it("uppercases and trims for case-insensitive comparison", () => {
    expect(normalizeInviteCode(" ab23cd ")).toBe("AB23CD");
  });
});
