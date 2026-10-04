import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { ALREADY_IN_THIS_CIRCLE, CIRCLE_FAILURES, circleFailure } from "./circle-messages.ts";

const fail = (code: string) => circleFailure(new ApiError(code, 409, null));

describe("circleFailure", () => {
  it("has Spanish copy for every known code, and no empty message", () => {
    for (const [code, expected] of Object.entries(CIRCLE_FAILURES)) {
      expect(fail(code)).toEqual(expected);
      expect(expected.message.length).toBeGreaterThan(10);
    }
  });

  it("puts name conflicts under the name field and code errors under the code field", () => {
    expect(fail("DisplayNameTaken").field).toBe("displayName");
    expect(fail("InvalidDisplayName").field).toBe("displayName");
    expect(fail("InviteExpired").field).toBe("code");
  });

  it("mentions the 6 people limit, the ongoing season and asking for a new code", () => {
    expect(fail("CircleFull").message).toContain("6 personas");
    expect(fail("SeasonNotJoinable").message).toContain("temporada");
    expect(fail("InviteExpired").message).toContain("nuevo");
  });

  it("makes only network and server failures retryable", () => {
    const retryable = Object.keys(CIRCLE_FAILURES).filter((code) => fail(code).retryable);
    expect(retryable.sort()).toEqual(
      ["ConcurrencyConflict", "Internal", "NetworkError", "ServiceUnavailable"].sort(),
    );
  });

  it("falls back to the generic message for unknown codes and non-API errors", () => {
    expect(fail("Whatever")).toEqual({ message: "Algo salió mal.", field: null, retryable: false });
    expect(circleFailure(new TypeError("x")).message).toBe("Algo salió mal.");
    expect(fail("toString").message).toBe("Algo salió mal.");
  });

  it("keeps the 'already in this circle' wording apart from the 'leave first' one", () => {
    expect(ALREADY_IN_THIS_CIRCLE).toBe("Ya formas parte de este círculo.");
    expect(fail("AlreadyInActiveCircle").message).not.toBe(ALREADY_IN_THIS_CIRCLE);
  });
});
