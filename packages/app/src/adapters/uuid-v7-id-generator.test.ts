import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { createUuidV7IdGenerator } from "./uuid-v7-id-generator.ts";

const FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const clockAt = (ms: number) => ({ now: () => instant(ms) });
const allOnes = (bytes: Uint8Array) => bytes.fill(0xff);
const allZeros = (bytes: Uint8Array) => bytes.fill(0);

describe("createUuidV7IdGenerator (RFC 9562)", () => {
  it("DC-S8: 1000 ids all match the v7 layout with the default sources", () => {
    const ids = createUuidV7IdGenerator();
    for (let i = 0; i < 1000; i++) expect(ids.next()).toMatch(FORMAT);
  });

  it("sets version 7 and variant 10 even when every random bit is 1 or 0", () => {
    const ones = createUuidV7IdGenerator({ clock: clockAt(0), fill: allOnes }).next();
    const zeros = createUuidV7IdGenerator({ clock: clockAt(0), fill: allZeros }).next();
    expect(ones).toBe("00000000-0000-7fff-bfff-ffffffffffff");
    expect(zeros).toBe("00000000-0000-7000-8000-000000000000");
  });

  it("encodes the injected clock as the 48-bit big-endian millisecond prefix", () => {
    const ms = 1_759_060_800_123;
    const id = createUuidV7IdGenerator({ clock: clockAt(ms), fill: allZeros }).next();
    expect(Number.parseInt(id.replace("-", "").slice(0, 12), 16)).toBe(ms);
  });

  it("DC-S9: ids from a later millisecond sort after earlier ones", () => {
    let now = 1_759_060_800_000;
    const ids = createUuidV7IdGenerator({ clock: { now: () => instant(now) } });
    const early = ids.next();
    now += 1;
    const late = ids.next();
    expect([late, early].sort()).toEqual([early, late]);
  });

  it("10k ids are unique", () => {
    const ids = createUuidV7IdGenerator();
    expect(new Set(Array.from({ length: 10_000 }, () => ids.next())).size).toBe(10_000);
  });
});
