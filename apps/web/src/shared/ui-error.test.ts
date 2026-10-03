import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { toUiError, UI_KIND_BY_CODE, type UiKind } from "./ui-error.ts";

/** The intended behaviour of every known code, written out so a new code forces a decision. */
const EXPECTED: Readonly<Record<string, UiKind>> = {
  // Session
  Unauthorized: "sessionExpired",
  // Transient
  NetworkError: "retryable",
  Internal: "retryable",
  ServiceUnavailable: "retryable",
  // The window or the season no longer accepts this day
  WindowClosed: "closedWindow",
  SeasonNotActive: "closedWindow",
  BeforeSeasonStart: "closedWindow",
  FutureDay: "closedWindow",
  OutsideSeason: "closedWindow",
  // The entry is gone
  EntryDeleted: "entryGone",
  EntryNotFound: "entryGone",
  // Another device changed it
  ConcurrencyConflict: "conflict",
  // Field problems keep the sheet open
  InvalidQuantity: "quantityField",
  NoteTooLong: "noteField",
  InvalidNote: "noteField",
  // Stale references
  NotAMember: "generic",
  EntryNotOwned: "generic",
  CommitmentNotOwned: "generic",
  CommitmentNotFound: "generic",
  SeasonNotFound: "generic",
  // Bug class: the client should never send these
  MissedNotAllowed: "bug",
  ValueKindMismatch: "bug",
  IdempotencyKeyReused: "bug",
  InvalidClientRequestId: "bug",
  InvalidRequest: "bug",
  InvalidJson: "bug",
  RouteNotFound: "bug",
  MethodNotAllowed: "bug",
};

describe("UI_KIND_BY_CODE", () => {
  it("covers exactly the intended codes, no more and no fewer", () => {
    expect(UI_KIND_BY_CODE).toEqual(EXPECTED);
  });
});

describe("toUiError", () => {
  it.each(Object.entries(EXPECTED))("maps %s to %s", (code, kind) => {
    expect(toUiError(new ApiError(code, 400, "rid-1")).kind).toBe(kind);
  });

  it("flags which kinds invalidate Today (AC-R4)", () => {
    const invalidates = (code: string) => toUiError(new ApiError(code, 409, null)).invalidateToday;
    for (const code of ["WindowClosed", "EntryDeleted", "ConcurrencyConflict", "NotAMember"]) {
      expect(invalidates(code)).toBe(true);
    }
    for (const code of ["NetworkError", "InvalidQuantity", "NoteTooLong", "InvalidRequest"]) {
      expect(invalidates(code)).toBe(false);
    }
  });

  it("marks only the transient kinds as retryable", () => {
    expect(toUiError(new ApiError("NetworkError", 0, null)).retryable).toBe(true);
    expect(toUiError(new ApiError("Internal", 500, null)).retryable).toBe(true);
    expect(toUiError(new ApiError("WindowClosed", 409, null)).retryable).toBe(false);
  });

  it("keeps the code and requestId for diagnostics", () => {
    expect(toUiError(new ApiError("InvalidRequest", 422, "rid-7"))).toMatchObject({
      code: "InvalidRequest",
      requestId: "rid-7",
    });
  });

  it("treats an unknown API code as a bug", () => {
    expect(toUiError(new ApiError("BrandNewCode", 418, "rid-2")).kind).toBe("bug");
  });

  it("treats a non-ApiError as a bug without a code", () => {
    expect(toUiError(new Error("boom"))).toMatchObject({
      kind: "bug",
      code: "Unknown",
      requestId: null,
      retryable: false,
      invalidateToday: false,
    });
  });
});
