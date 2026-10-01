import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSeededRandomSource } from "../testing/seeded-random.ts";
import { instant } from "../time/instant.ts";
import {
  generateInviteCode,
  inviteCodeExpiresAt,
  isInviteCodeFormat,
  normalizeInviteCode,
} from "./invite-code.ts";

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

describe("isInviteCodeFormat", () => {
  it("accepts a well-formed code, trimmed and case-insensitive", () => {
    expect(isInviteCodeFormat(" ab3d7k ")).toBe(true);
    expect(isInviteCodeFormat("AB3D7K")).toBe(true);
  });

  it("accepts every code generateInviteCode can produce", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 }), (seed) =>
        isInviteCodeFormat(generateInviteCode(createSeededRandomSource(seed))),
      ),
    );
  });

  it("rejects the ambiguous characters 0 O 1 I L", () => {
    for (const c of "01OIL") expect(isInviteCodeFormat(`AB3D7${c}`)).toBe(false);
  });

  it("rejects wrong lengths, empty and lone surrogates", () => {
    expect(isInviteCodeFormat("AB3D7")).toBe(false);
    expect(isInviteCodeFormat("AB3D7KK")).toBe(false);
    expect(isInviteCodeFormat("")).toBe(false);
    expect(isInviteCodeFormat("AB3D7\ud800")).toBe(false);
  });

  it("rejects any 6-char string containing a character outside the alphabet", () => {
    fc.assert(
      fc.property(
        fc
          .string({ unit: "binary", minLength: 1, maxLength: 1 })
          .filter((c) => !SAFE_ALPHABET.includes(c.toUpperCase())),
        fc.integer({ min: 0, max: 5 }),
        (bad, at) => {
          const chars = [..."AB3D7K"];
          chars.splice(at, 1, bad);
          return !isInviteCodeFormat(chars.join(""));
        },
      ),
    );
  });
});
