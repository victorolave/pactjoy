/**
 * Pure domain package: scoring, pause, proration and streaks. No
 * dependencies. No Node- or Deno-specific APIs.
 *
 * This is the ONLY file `packages/app` imports from (`exports: "./src/
 * index.ts"` in `package.json`). Every re-export below is justified by an
 * actual need on the app side (high decoupling, CLAUDE.md) -- everything
 * else (opportunity generation, entry assignment, grace period, proration,
 * pause-aware-week, streak internals, per-commitment scoring helpers, and
 * test-support) stays internal to the engine. `index.test.ts` pins this
 * file's RUNTIME surface (type-only exports are erased at runtime and
 * can't appear there, so they're reviewed by hand against the list below).
 *
 * - `scoreMember` + `ScoreInput`/`MemberScore`/`CommitmentScoreEntry`/
 *   `Streak`: the engine's single entry point and everything needed to
 *   type its result.
 * - `canRequestPause` + `PauseCheck`: D9's pure pause-request cap check,
 *   called before the app records a new pause request.
 * - `rankStandings` + `StandingsParticipant`/`StandingsRow`: builds the
 *   season's Clasificación from each member's `MemberScore.points`.
 * - `displayPoints`/`displayPercent`: D10's single rounding boundary --
 *   the app must never round a `Fraction` itself.
 * - `Fraction` + `frac`/`fromInt`/`parseDecimal`: needed to build every
 *   `Entry.value`, `Target` threshold and `Commitment.weightPercent`-derived
 *   value the app hands the engine; `parseDecimal` is specifically how the
 *   app converts a Postgres `numeric` string without ever going through a
 *   `float`.
 * - `compare`/`eq`/`lt`/`lte`/`gt`/`gte`: the minimum `Fraction` comparison
 *   helpers -- e.g. showing whether a logged value already reached a
 *   commitment's `minimum`/`ideal` before the exact scored result comes
 *   back. Fraction arithmetic (`add`/`sub`/`mul`/`div`/`sum`/`mean`/
 *   `roundHalfUp`/...) stays internal: those are the engine's own
 *   computation, not something the app needs to build inputs.
 * - Domain input types -- `Commitment` (plus the `Target`/`Schedule`/
 *   `Frequency`/`Direction`/`Unit`/`QuantityUnit`/`CommitmentId` pieces
 *   needed to construct one), `Entry`, `PauseRequest` (plus `PauseEnd`/
 *   `PauseDecision`), `Season`/`Weekday`, `SeasonDay` + its `seasonDay`
 *   constructor, and `MemberId`: what the app needs to build a `ScoreInput`
 *   and a `StandingsParticipant` in the first place.
 * - `graceDeadline`: the single source of the "end of the next day" grace
 *   boundary (`sdd/app-foundation/spec/season-clock` SC-5/SC-7) -- the app
 *   must reuse this instead of duplicating `GRACE_DAYS`.
 *
 * Deliberately NOT exported (see `sdd/scoring-engine/apply-progress`,
 * slice 7b, for the full rationale): `progressOf` (single-opportunity
 * preview isn't a confirmed app need yet -- `scoreMember` already covers
 * the real use case), `DoneCommitment`/`QuantityCommitment`/`targetOf`/
 * `assertValidTarget`/`assertValidCommitments` (the `Commitment` union
 * already suffices to build inputs; validation helpers are a possible
 * future export, not a current one), and `CommitmentScore` (its shape is
 * already inlined into the exported `CommitmentScoreEntry`).
 */

export type { Season, SeasonDay, Weekday } from "./calendar/season-calendar.ts";
export { seasonDay } from "./calendar/season-calendar.ts";
export type {
  Commitment,
  CommitmentId,
  Direction,
  Frequency,
  PerSessionSchedule,
  QuantityUnit,
  Schedule,
  Target,
  Unit,
} from "./commitment/commitment.ts";

export { displayPercent, displayPoints } from "./display/display.ts";
export type { Entry } from "./entry/entry.ts";
export { graceDeadline } from "./entry/grace-period.ts";
export type { Fraction } from "./fraction/fraction.ts";
export {
  compare,
  eq,
  frac,
  fromInt,
  gt,
  gte,
  lt,
  lte,
  parseDecimal,
} from "./fraction/fraction.ts";
export type { PauseDecision, PauseEnd, PauseRequest } from "./pause/pause.ts";
export type { PauseCheck } from "./pause/pause-cap.ts";
export { canRequestPause } from "./pause/pause-cap.ts";
export type { CommitmentScoreEntry, MemberScore, ScoreInput } from "./scoring/member-score.ts";
export { scoreMember } from "./scoring/member-score.ts";
export type { Streak } from "./scoring/streak.ts";
export type { MemberId, StandingsParticipant, StandingsRow } from "./standings/standings.ts";
export { rankStandings } from "./standings/standings.ts";
