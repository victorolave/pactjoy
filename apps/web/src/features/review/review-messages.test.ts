import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { loadFailure, reviewFailure } from "./review-messages.ts";

const fail = (code: string, status = 409, details?: Record<string, unknown>) =>
  reviewFailure(new ApiError(code, status, null, details));

describe("reviewFailure", () => {
  it("says a review that is not yet due is not available yet", () => {
    expect(fail("ReviewNotDue", 409, { reason: "notYet" })).toMatchObject({
      kind: "notDue",
      message: "Esta revisión todavía no está disponible.",
    });
  });

  it("says a lapsed review is over and does not offer a retry", () => {
    expect(fail("ReviewNotDue", 409, { reason: "lapsed" })).toMatchObject({
      kind: "lapsed",
      message: "Esta revisión ya pasó. La próxima te llegará a su hora.",
      retryable: false,
    });
  });

  it("treats ReviewNotDue without a known reason as not due yet", () => {
    expect(fail("ReviewNotDue")).toMatchObject({ kind: "notDue" });
  });

  it("maps a second submission and a lost race to the saved state, not to an error", () => {
    expect(fail("ReviewAlreadySubmitted")).toMatchObject({ kind: "alreadySubmitted" });
    expect(fail("ConcurrencyConflict")).toMatchObject({ kind: "alreadySubmitted" });
  });

  it("maps a missing period or one that cannot be skipped to not found", () => {
    expect(fail("ReviewPeriodNotFound", 404)).toMatchObject({ kind: "notFound" });
    expect(fail("ReviewNotSkippable")).toMatchObject({ kind: "notFound" });
  });

  it("sends missing or invalid answers back to the questions", () => {
    expect(fail("AutomaticityIncomplete", 422)).toMatchObject({ kind: "answers" });
    expect(fail("InvalidAutomaticity", 422)).toMatchObject({ kind: "answers" });
  });

  it("points a too long or invalid reflection at its field", () => {
    expect(fail("NoteTooLong", 422, { field: "helped" })).toMatchObject({
      kind: "reflection",
      field: "helped",
      message: "Es demasiado largo. Acórtalo un poco.",
    });
    expect(fail("InvalidNote", 422, { field: "hard" })).toMatchObject({
      kind: "reflection",
      field: "hard",
    });
  });

  it("keeps the reflection kind without a field when the server names none", () => {
    expect(fail("NoteTooLong", 422)).toMatchObject({ kind: "reflection", field: null });
  });

  it("says the season is not active", () => {
    expect(fail("SeasonNotActive")).toMatchObject({ kind: "notDue" });
  });

  it("is retryable on a network failure and generic on anything else", () => {
    expect(fail("NetworkError", 0)).toMatchObject({ kind: "retry", retryable: true });
    expect(reviewFailure(new Error("boom"))).toMatchObject({ kind: "generic", retryable: false });
    expect(fail("Surprise", 500)).toMatchObject({ kind: "generic", message: "Algo salió mal." });
  });
});

describe("loadFailure", () => {
  it("asks to retry a dropped connection and does not blame a save", () => {
    expect(loadFailure(new ApiError("NetworkError", 0, null))).toEqual({
      message: "No pudimos cargar tu revisión. Revisa tu conexión.",
      retryable: true,
    });
  });

  it("says a missing period is not found, without a retry", () => {
    expect(loadFailure(new ApiError("ReviewPeriodNotFound", 404, null))).toEqual({
      message: "No encontramos esta revisión.",
      retryable: false,
    });
    expect(loadFailure(new ApiError("NotAMember", 403, null)).retryable).toBe(false);
  });

  it("is generic for anything else", () => {
    expect(loadFailure(new ApiError("Surprise", 500, null))).toEqual({
      message: "Algo salió mal.",
      retryable: false,
    });
  });
});
