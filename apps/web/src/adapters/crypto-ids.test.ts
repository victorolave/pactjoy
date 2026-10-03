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

  // Safari exposes randomUUID only on secure origins (https or localhost), so a phone on the
  // local network over plain http only has getRandomValues.
  describe("without randomUUID (non-secure origin)", () => {
    const insecure = {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(array),
    };

    it("still issues UUID v4 values", () => {
      expect(new CryptoIds(insecure).newId()).toMatch(UUID_V4);
    });

    it("builds the id from getRandomValues, setting the version and variant bits", () => {
      const zeros = {
        getRandomValues: (array: Uint8Array<ArrayBuffer>) => array,
      };
      expect(new CryptoIds(zeros).newId()).toBe("00000000-0000-4000-8000-000000000000");
    });

    it("still never repeats", () => {
      const ids = new CryptoIds(insecure);
      const seen = new Set(Array.from({ length: 50 }, () => ids.newId()));
      expect(seen.size).toBe(50);
    });
  });
});
