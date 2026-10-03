import { describe, expect, it } from "vitest";
import { CryptoIds } from "./crypto-ids.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("CryptoIds", () => {
  it("issues UUID v4 values", () => {
    expect(new CryptoIds().newId()).toMatch(UUID_V4);
  });

  it("never repeats", () => {
    const ids = new CryptoIds();
    const seen = new Set(Array.from({ length: 50 }, () => ids.newId()));
    expect(seen.size).toBe(50);
  });
});
