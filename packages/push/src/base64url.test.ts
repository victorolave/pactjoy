import { describe, expect, it } from "vitest";
import { fromBase64Url, isBase64Url, toBase64Url } from "./base64url.ts";

describe("base64url (RFC 4648 section 5, no padding)", () => {
  it.each([
    [[], ""],
    [[0xfb], "-w"],
    [[0xfb, 0xff], "-_8"],
    [[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], "Zm9vYmFy"],
  ])("encodes %j as %j and back", (bytes, text) => {
    expect(toBase64Url(new Uint8Array(bytes))).toBe(text);
    expect([...fromBase64Url(text)]).toEqual(bytes);
  });

  it("accepts padded input from browsers that add it", () => {
    expect([...fromBase64Url("-w==")]).toEqual([0xfb]);
  });

  it("rejects characters outside the url-safe alphabet", () => {
    expect(() => fromBase64Url("a+b/")).toThrow(RangeError);
    expect(isBase64Url("a+b/")).toBe(false);
    expect(isBase64Url("ab_-")).toBe(true);
  });
});
