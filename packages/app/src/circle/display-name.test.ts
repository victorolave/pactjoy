import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_NAME_LENGTH, normalizeDisplayName } from "./display-name.ts";

describe("normalizeDisplayName", () => {
  it("DN-S1: accepts a plain name, trims it and keeps emoji", () => {
    expect(normalizeDisplayName("Ana")).toBe("Ana");
    expect(normalizeDisplayName("  Ana  ")).toBe("Ana");
    expect(normalizeDisplayName("🔥 Ana")).toBe("🔥 Ana");
  });

  it("DN-S2: rejects blank, NUL and lone surrogates", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("A\u0000na")).toBeNull();
    expect(normalizeDisplayName("A\uD800na")).toBeNull();
  });

  it("DN-S2: counts code points, not UTF-16 units (30 ok, 31 rejected)", () => {
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(30);
    expect(normalizeDisplayName("a".repeat(30))).not.toBeNull();
    expect(normalizeDisplayName("a".repeat(31))).toBeNull();
    expect(normalizeDisplayName("🔥".repeat(30))).toBe("🔥".repeat(30));
    expect(normalizeDisplayName("🔥".repeat(31))).toBeNull();
  });
});
