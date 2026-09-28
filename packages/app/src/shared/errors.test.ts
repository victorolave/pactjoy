import { describe, expect, it } from "vitest";
import { ConcurrencyConflict, InviteCodeGenerationFailed } from "./errors.ts";

describe("ConcurrencyConflict", () => {
  it("is a real Error with a default message naming the concurrency conflict", () => {
    const error = new ConcurrencyConflict();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConcurrencyConflict");
    expect(error.message).toMatch(/concurrency conflict/i);
  });

  it("accepts a custom message describing which aggregate conflicted", () => {
    const error = new ConcurrencyConflict("Circle circle-1 was modified by another write");

    expect(error.message).toBe("Circle circle-1 was modified by another write");
    expect(error.name).toBe("ConcurrencyConflict");
  });
});

describe("InviteCodeGenerationFailed", () => {
  it("is a real Error with a default message naming the exhausted attempts", () => {
    const error = new InviteCodeGenerationFailed();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InviteCodeGenerationFailed");
    expect(error.message).toMatch(/invite code/i);
  });

  it("accepts a custom message", () => {
    const error = new InviteCodeGenerationFailed("exhausted 5 attempts for circle circle-1");

    expect(error.message).toBe("exhausted 5 attempts for circle circle-1");
    expect(error.name).toBe("InviteCodeGenerationFailed");
  });
});
