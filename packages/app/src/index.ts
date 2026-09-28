/**
 * Public API of `@pactjoy/app` (`exports: "."` in `package.json`). Use
 * cases, queries and the domain/port types they need are added here as
 * each slice lands (ADR-0008). This skeleton slice (S1) exports only the
 * shared kernel: `Result`, branded ids, `Actor`, the infra error, ports,
 * and the time primitives every later slice builds on. Deterministic
 * in-memory adapters for tests live under the separate `./testing`
 * subpath (`src/testing/index.ts`), never here.
 */

export { createIntlTimeZone } from "./adapters/intl-time-zone.ts";
export { createSystemClock } from "./adapters/system-clock.ts";
export type { IdGenerator } from "./ports/id-generator.ts";
export type { RandomSource } from "./ports/random-source.ts";
export type { UnitOfWork } from "./ports/unit-of-work.ts";
export type { Actor } from "./shared/actor.ts";
export { ConcurrencyConflict } from "./shared/errors.ts";
export type { CircleId, EntryId, HabitId, SeasonId, UserId } from "./shared/ids.ts";
export { circleId, entryId, habitId, seasonId, userId } from "./shared/ids.ts";
export type { Result } from "./shared/result.ts";
export { err, ok } from "./shared/result.ts";
export type { Clock } from "./time/clock.port.ts";
export type { Instant } from "./time/instant.ts";
export { instant } from "./time/instant.ts";
export type { LocalDate } from "./time/local-date.ts";
export { localDate } from "./time/local-date.ts";
export type { SeasonDayResult } from "./time/season-calendar.ts";
export { localDateOfSeasonDay, toSeasonDay } from "./time/season-calendar.ts";
export type { TimeZone, TimeZoneId } from "./time/time-zone.port.ts";
export { timeZoneId } from "./time/time-zone.port.ts";
