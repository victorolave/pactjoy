import { describe, expect, it } from "vitest";
import { isStorableText } from "./storable-text.ts";

describe("isStorableText", () => {
  it.each([
    ["empty", ""],
    ["ascii", "abc"],
    ["astral emoji", "😀"],
    ["emoji at the edges", "😀a😀"],
    ["adjacent pairs", "😀😀"],
  ])("accepts %s", (_name, text) => expect(isStorableText(text)).toBe(true));

  it.each([
    ["lone high", "\uD83D"],
    ["lone low", "\uDE00"],
    ["high then letter", "\uD83Da"],
    ["letter then low", "a\uDE00"],
    ["NUL", "\u0000"],
    ["NUL inside text", "a\u0000b"],
    ["NUL next to a pair", "😀\u0000"],
    ["reversed pair", "\uDE00\uD83D"],
    ["high high low", "\uD83D😀"],
    ["high low low", "😀\uDE00"],
  ])("rejects %s", (_name, text) => expect(isStorableText(text)).toBe(false));
});
