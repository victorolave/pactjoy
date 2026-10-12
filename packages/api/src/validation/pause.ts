import { forDate, uuid } from "./formats.ts";
import { literal, nullable, object, oneOf, optional, string, tagged } from "./schema.ts";

/**
 * Structure only (ADR-0011): the reason is a plain string here because the app owns the closed
 * list (`InvalidPauseReason`); the scope is a tagged union, so an unknown kind is an `enum` issue.
 */
export const pauseScope = tagged<{ kind: "all" } | { kind: "commitment"; commitmentId: string }>(
  "kind",
  {
    all: object({ kind: literal("all") }),
    commitment: object({ kind: literal("commitment"), commitmentId: uuid }),
  },
);

// Both ends are required (`endDate: null` is an open pause, `note: null` no note), so nothing is
// silently defaulted. The member and the season come from the token and the path, never the body.
export const requestPauseBody = object({
  scope: pauseScope,
  reason: string,
  note: nullable(string),
  startDate: forDate,
  endDate: nullable(forDate),
});

// No `expectedVersion` (D2): an answer is "set my answer", idempotent while pending.
export const respondBody = object({ decision: oneOf(["approve", "reject"] as const) });

// Omitted means every Commitment still running ("Todos", PL-33).
export const resumeBody = object({ commitmentId: optional(uuid) });
