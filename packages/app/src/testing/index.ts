/**
 * Deterministic in-memory adapters for tests (`exports: "./testing"` in
 * `package.json`). Never imported from `src/index.ts` or from any
 * production use case -- only from this package's own tests and from
 * consumers writing tests against `@pactjoy/app` (ADR-0008).
 */

export type { CreateTestAppOptions, TestApp } from "./app-harness.ts";
export { createTestApp } from "./app-harness.ts";
export type {
  CircleFixtureOptions,
  HabitFixtureOptions,
  MemberFixtureOptions,
} from "./builders.ts";
export { circleFixture, habitFixture, memberFixture } from "./builders.ts";
export { createFixedClock } from "./fixed-clock.ts";
export type { FixedOffsetTimeZoneOptions } from "./fixed-time-zone.ts";
export { createFixedOffsetTimeZone } from "./fixed-time-zone.ts";
export type { InMemoryCircleRepository } from "./in-memory-circle-repository.ts";
export { createInMemoryCircleRepository } from "./in-memory-circle-repository.ts";
export type { InMemoryHabitRepository } from "./in-memory-habit-repository.ts";
export { createInMemoryHabitRepository } from "./in-memory-habit-repository.ts";
export type { InMemorySeasonGateReader } from "./in-memory-season-gate-reader.ts";
export { createInMemorySeasonGateReader } from "./in-memory-season-gate-reader.ts";
export type { InMemoryUnitOfWorkOptions } from "./in-memory-unit-of-work.ts";
export { createInMemoryUnitOfWork } from "./in-memory-unit-of-work.ts";
export { createSeededRandomSource } from "./seeded-random.ts";
export { createSequentialIdGenerator } from "./sequential-ids.ts";
