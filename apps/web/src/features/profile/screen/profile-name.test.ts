import { describe, expect, it } from "vitest";
import { profileName } from "./profile-name.ts";

describe("the name on Perfil", () => {
  it("is the displayName in the circle when there is one", () => {
    expect(profileName({ memberName: "Victor", draft: "Vic", email: "victor@example.com" })).toBe(
      "Victor",
    );
  });

  it("is the name draft without a circle", () => {
    expect(profileName({ memberName: null, draft: "Vic", email: "victor@example.com" })).toBe(
      "Vic",
    );
  });

  it("is the part of the email before the @ without a circle or a draft", () => {
    expect(profileName({ memberName: null, draft: null, email: "victor@example.com" })).toBe(
      "victor",
    );
  });

  it("ignores a blank draft", () => {
    expect(profileName({ memberName: null, draft: "  ", email: "victor@example.com" })).toBe(
      "victor",
    );
  });

  it("falls back to Tú with nothing to go on", () => {
    expect(profileName({ memberName: null, draft: null, email: null })).toBe("Tú");
  });
});
