import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { closeFailure, loadFailure } from "./close-messages.ts";

const api = (code: string, status = 409, details?: Record<string, unknown>) =>
  new ApiError(code, status, null, details);

describe("closeFailure (saving the decisions)", () => {
  it("names the day the results open", () => {
    const failure = closeFailure(api("SeasonResultsNotYet", 409, { availableOn: "2026-10-21" }));
    expect(failure).toMatchObject({
      kind: "notYet",
      message: "Tus resultados estarán listos el miércoles 21 de octubre.",
      retryable: false,
    });
  });

  it("still says it is early when the day is missing", () => {
    expect(closeFailure(api("SeasonResultsNotYet"))).toMatchObject({
      kind: "notYet",
      message: "Tus resultados todavía no están listos.",
    });
  });

  it("says the season is already closed", () => {
    expect(closeFailure(api("SeasonNotActive"))).toMatchObject({
      kind: "closed",
      message: "La temporada ya se cerró.",
    });
  });

  it("sends a member without the closing review back to it", () => {
    expect(closeFailure(api("ClosingReviewRequired"))).toMatchObject({
      kind: "reviewRequired",
      message: "Antes de decidir, haz tu revisión de cierre.",
    });
  });

  it.each(["ClosureAlreadySubmitted", "ConcurrencyConflict"])(
    "treats %s as already saved: nothing to redo, refetch",
    (code) => {
      expect(closeFailure(api(code))).toMatchObject({
        kind: "alreadySubmitted",
        message: "Ya habías guardado tus decisiones.",
      });
    },
  );

  it.each(["ClosureIncomplete", "InvalidClosureDecision"])(
    "asks to review the habits on %s",
    (code) => {
      expect(closeFailure(api(code, 422))).toMatchObject({
        kind: "incomplete",
        message: "Falta alguna decisión. Revisa cada hábito.",
      });
    },
  );

  it("offers a retry when the network failed", () => {
    expect(closeFailure(new ApiError("NetworkError", 0, null))).toMatchObject({
      kind: "retry",
      message: "No pudimos guardar tus decisiones. Revisa tu conexión.",
      retryable: true,
    });
  });

  it.each(["NothingToClose"])("says there is nothing to decide on %s", (code) => {
    expect(closeFailure(api(code))).toMatchObject({
      kind: "nothing",
      message: "No tenías compromisos esta temporada, así que no hay nada que decidir.",
    });
  });

  it.each(["SeasonNotFound", "NotAMember"])("does not find the season on %s", (code) => {
    expect(closeFailure(api(code, 404))).toMatchObject({
      kind: "notFound",
      message: "No encontramos esta temporada.",
    });
  });

  it("falls back to a plain message for anything else", () => {
    expect(closeFailure(new Error("boom"))).toMatchObject({
      kind: "generic",
      message: "Algo salió mal.",
      retryable: false,
    });
  });
});

describe("loadFailure (reading the results)", () => {
  it("uses its own wording for a lost connection", () => {
    expect(loadFailure(new ApiError("NetworkError", 0, null))).toEqual({
      kind: "retry",
      message: "No pudimos cargar tus resultados. Revisa tu conexión.",
      retryable: true,
    });
  });

  it("keeps the date and the other verdicts as they are", () => {
    expect(
      loadFailure(api("SeasonResultsNotYet", 409, { availableOn: "2026-10-21" })),
    ).toMatchObject({ kind: "notYet", retryable: false });
    expect(loadFailure(api("SeasonNotActive"))).toMatchObject({ kind: "closed" });
    expect(loadFailure(api("NotAMember", 403))).toMatchObject({ kind: "notFound" });
  });
});
