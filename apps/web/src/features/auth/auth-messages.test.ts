import { describe, expect, it } from "vitest";
import type { AuthErrorCode } from "../../ports/auth.ts";
import { authMessage } from "./auth-messages.ts";

describe("authMessage", () => {
  const codes: AuthErrorCode[] = [
    "InvalidEmail",
    "InvalidCode",
    "InvalidSession",
    "RateLimited",
    "Network",
    "Unknown",
  ];

  it("has a distinct Spanish message for every failure the sign-in screens can meet", () => {
    const messages = codes.map((code) => authMessage(code));
    expect(new Set(messages).size).toBe(codes.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
  });

  it("explains an invalid or expired code in one message", () => {
    expect(authMessage("InvalidCode")).toBe("El código no es válido o venció. Pide uno nuevo.");
  });

  it("says when there is no connection", () => {
    expect(authMessage("Network")).toContain("conexión");
  });

  it("falls back to a generic message for anything that is not an AuthError", () => {
    expect(authMessage(new TypeError("boom"))).toBe(authMessage("Unknown"));
    expect(authMessage(undefined)).toBe(authMessage("Unknown"));
  });

  it("reads the code off an AuthError", async () => {
    const { AuthError } = await import("../../ports/auth.ts");
    expect(authMessage(new AuthError("RateLimited"))).toBe(authMessage("RateLimited"));
  });
});
