import { describe, expect, it } from "vitest";
import { isWellFormed } from "./well-formed.ts";

describe("isWellFormed", () => {
  it.each([
    ["empty", ""],
    ["ascii", "abc"],
    ["astral emoji", "😀"],
    ["emoji at the edges", "😀a😀"],
    ["adjacent pairs", "😀😀"],
  ])("accepts %s", (_name, text) => expect(isWellFormed(text)).toBe(true));

  it.each([
    ["lone high", "\uD83D"],
    ["lone low", "\uDE00"],
    ["high then letter", "\uD83Da"],
    ["letter then low", "a\uDE00"],
    ["reversed pair", "\uDE00\uD83D"],
    ["high high low", "\uD83D😀"],
    ["high low low", "😀\uDE00"],
  ])("rejects %s", (_name, text) => expect(isWellFormed(text)).toBe(false));
});
