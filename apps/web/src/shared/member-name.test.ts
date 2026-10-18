import { describe, expect, it } from "vitest";
import { isLeftMember, LEFT_MEMBER_NAME, memberInitial, memberName } from "./member-name.ts";

/** The erased member's displayName is '' on the wire (ADR-0019); the feed sends null for a leaver. */

describe("memberName", () => {
  it("returns a real name untouched", () => {
    expect(memberName("Andrea")).toBe("Andrea");
    expect(memberName("Víctor O.")).toBe("Víctor O.");
  });

  it.each(["", null, "   "])("names %j as a member who left", (value) => {
    expect(memberName(value)).toBe("Miembro que salió");
    expect(LEFT_MEMBER_NAME).toBe("Miembro que salió");
  });
});

describe("isLeftMember", () => {
  it.each(["", "  ", null])("is true for %j", (value) => {
    expect(isLeftMember(value)).toBe(true);
  });

  it("is false for a real name", () => {
    expect(isLeftMember("Andrea")).toBe(false);
  });
});

describe("memberInitial", () => {
  it("is the uppercased first letter of a real name", () => {
    expect(memberInitial("andrea")).toBe("A");
    expect(memberInitial("  Victor")).toBe("V");
  });

  it.each(["", null, "  "])("is a question mark for %j: there is no name to take it from", (v) => {
    expect(memberInitial(v)).toBe("?");
  });
});
