/**
 * Deterministic in-memory adapters for tests (`exports: "./testing"` in
 * `package.json`). Never imported from `src/index.ts` or from any
 * production use case -- only from this package's own tests and from
 * consumers writing tests against `@pactjoy/app` (ADR-0008).
 */

export type { CreateTestAppOptions, TestApp } from "./app-harness.ts";
export { createTestApp } from "./app-harness.ts";
export { createFixedClock } from "./fixed-clock.ts";
export type { InMemoryUnitOfWorkOptions } from "./in-memory-unit-of-work.ts";
export { createInMemoryUnitOfWork } from "./in-memory-unit-of-work.ts";
export { createSeededRandomSource } from "./seeded-random.ts";
export { createSequentialIdGenerator } from "./sequential-ids.ts";
