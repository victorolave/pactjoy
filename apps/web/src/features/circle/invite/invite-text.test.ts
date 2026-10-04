import { describe, expect, it } from "vitest";
import { expiryLabel, expiryNote, inviteMessage, isExpired } from "./invite-text.ts";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

describe("invite text", () => {
  it("treats an invite as expired from the instant it expires", () => {
    expect(isExpired("2026-10-03T12:00:01.000Z", NOW)).toBe(false);
    expect(isExpired("2026-10-03T12:00:00.000Z", NOW)).toBe(true);
    expect(isExpired("2026-10-01T12:00:00.000Z", NOW)).toBe(true);
  });

  it("counts the days left and names the day it expires", () => {
    expect(expiryNote("2026-10-10T12:00:00.000Z", NOW)).toMatch(
      /^Caduca en 7 días, el [^ ]+ 10 de octubre\.$/,
    );
  });

  it("does not say '0 días' on the last day", () => {
    expect(expiryNote("2026-10-03T20:00:00.000Z", NOW)).toMatch(/^Caduca en menos de un día/);
  });

  it("writes the short label and the message that Compartir hands over", () => {
    expect(expiryLabel("2026-10-10T12:00:00.000Z")).toBe("Código · caduca el 10 de octubre");
    expect(inviteMessage("7K4Q2M", "2026-10-10T12:00:00.000Z")).toBe(
      "Te invito a mi círculo en PactJoy. Código: 7K4Q2M (válido hasta el 10 de octubre)",
    );
  });
});
