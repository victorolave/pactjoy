import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { QueuedDelete, QueuedEdit, QueuedRecord } from "../../../ports/outbox-store.ts";
import { type KnownCode, UI_KIND_BY_CODE } from "../../../shared/ui-error.ts";
import { classify, type Outcome } from "./classify.ts";

const record: QueuedRecord = {
  kind: "record",
  localId: "a",
  attempted: true,
  habitName: "Dibujar",
  command: {
    seasonId: "s1",
    commitmentId: "c1",
    forDate: "2026-10-13",
    value: { kind: "done" },
    note: null,
    clientRequestId: "req-a",
  },
};
const edit: QueuedEdit = {
  kind: "edit",
  id: "e1",
  target: "entry-1",
  habitName: "Dibujar",
  forDate: "2026-10-13",
  value: { kind: "done" },
  note: null,
};
const remove: QueuedDelete = {
  kind: "delete",
  id: "d1",
  target: "entry-1",
  habitName: "Dibujar",
  forDate: "2026-10-13",
};

const error = (code: string) => new ApiError(code, 400, "req");

/** Compile-checked: a new `KnownCode` without a class here is a type error. */
const OUTCOME_BY_CODE = {
  Unauthorized: "session",
  NetworkError: "retryable",
  Internal: "retryable",
  ServiceUnavailable: "retryable",
  ConcurrencyConflict: "conflict",
  WindowClosed: "terminal",
  SeasonNotActive: "terminal",
  BeforeSeasonStart: "terminal",
  FutureDay: "terminal",
  OutsideSeason: "terminal",
  OpportunityOnHold: "terminal",
  OpportunityPaused: "terminal",
  EntryDeleted: "terminal",
  EntryNotFound: "terminal",
  InvalidQuantity: "terminal",
  NoteTooLong: "terminal",
  InvalidNote: "terminal",
  NotAMember: "terminal",
  EntryNotOwned: "terminal",
  CommitmentNotOwned: "terminal",
  CommitmentNotFound: "terminal",
  SeasonNotFound: "terminal",
  InvalidPhoto: "terminal",
  PhotoNotFound: "terminal",
  PhotoNotUploaded: "terminal",
  PhotoUploadExpired: "terminal",
  PhotoNotAvailable: "terminal",
  TooManyPhotoUploads: "terminal",
  PhotoNotAllowedOnMissed: "terminal",
  MissedNotAllowed: "terminal",
  ValueKindMismatch: "terminal",
  IdempotencyKeyReused: "terminal",
  InvalidClientRequestId: "terminal",
  InvalidRequest: "terminal",
  InvalidJson: "terminal",
  RouteNotFound: "terminal",
  MethodNotAllowed: "terminal",
} as const satisfies Record<KnownCode, Outcome>;

describe("classify (OE-R4)", () => {
  it("covers every known code", () => {
    expect(Object.keys(OUTCOME_BY_CODE).sort()).toEqual(Object.keys(UI_KIND_BY_CODE).sort());
  });

  it.each(Object.entries(OUTCOME_BY_CODE))("a record answered %s is %s", (code, outcome) => {
    expect(classify(record, error(code), { dependentDelete: false })).toBe(outcome);
  });

  it.each(
    Object.entries(OUTCOME_BY_CODE).filter(
      ([code]) => code !== "EntryDeleted" && code !== "EntryNotFound",
    ),
  )("an edit answered %s is %s", (code, outcome) => {
    expect(classify(edit, error(code), { dependentDelete: false })).toBe(outcome);
  });

  it("an edit of an entry deleted elsewhere is rejected, not sent (OE-R4.S9)", () => {
    expect(classify(edit, error("EntryDeleted"), { dependentDelete: false })).toBe("terminal");
    expect(classify(edit, error("EntryNotFound"), { dependentDelete: false })).toBe("terminal");
  });

  it("a delete of an entry that is already gone counts as sent", () => {
    expect(classify(remove, error("EntryDeleted"), { dependentDelete: false })).toBe("sent");
    expect(classify(remove, error("EntryNotFound"), { dependentDelete: false })).toBe("sent");
  });

  it("a delete answered anything else follows the table", () => {
    expect(classify(remove, error("NetworkError"), { dependentDelete: false })).toBe("retryable");
    expect(classify(remove, error("WindowClosed"), { dependentDelete: false })).toBe("terminal");
  });

  it("a record replay answering EntryDeleted, with a queued delete of it, settles both", () => {
    expect(classify(record, error("EntryDeleted"), { dependentDelete: true })).toBe("sentAll");
  });

  it("a record answering EntryDeleted with no queued delete is rejected", () => {
    expect(classify(record, error("EntryDeleted"), { dependentDelete: false })).toBe("terminal");
  });

  // The status speaks first: a server or gateway in trouble never drops an item, whatever code it
  // carries (one outside the table today, or a terminal one sent with a 5xx).
  it.each([
    [0, "SomethingNew"],
    [429, "TooManyJoinAttempts"],
    [429, "WindowClosed"],
    [500, "InviteCodeGenerationFailed"],
    [502, "BadGateway"],
    [503, "IdentityUnavailable"],
    [504, "WindowClosed"],
  ])("an answer with status %i (%s) is retryable for every kind of item", (status, code) => {
    const failure = new ApiError(code, status, "req");
    for (const item of [record, edit, remove]) {
      expect(classify(item, failure, { dependentDelete: false })).toBe("retryable");
    }
  });

  it.each([400, 404, 409, 410, 422])("a %i with an unknown code is still terminal", (status) => {
    expect(
      classify(record, new ApiError("SomethingNew", status, "req"), { dependentDelete: false }),
    ).toBe("terminal");
  });

  it("anything that is not an ApiError is terminal: never retried forever, never silent", () => {
    expect(classify(record, new TypeError("boom"), { dependentDelete: false })).toBe("terminal");
  });
});
