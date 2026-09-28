import type { IdGenerator } from "../ports/id-generator.ts";
import type { RandomSource } from "../ports/random-source.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import { createFixedClock } from "./fixed-clock.ts";
import { createSeededRandomSource } from "./seeded-random.ts";
import { createSequentialIdGenerator } from "./sequential-ids.ts";

/**
 * The ports every use-case test wires up, composed from deterministic
 * in-memory adapters. Concrete repositories (circle/habit/season/entry)
 * are not part of this yet -- they are added by the slice that first
 * defines them, alongside their own `UnitOfWork<Repositories>` wiring
 * (ADR-0008).
 */
export interface TestApp {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
}

export interface CreateTestAppOptions {
  readonly now?: Instant;
  readonly idPrefix?: string;
  readonly randomSeed?: number;
}

const DEFAULT_NOW: Instant = instant(1_700_000_000_000);
const DEFAULT_RANDOM_SEED = 42;

/** Builds a fully deterministic {@link TestApp} for use-case tests. */
export function createTestApp(options: CreateTestAppOptions = {}): TestApp {
  return {
    clock: createFixedClock(options.now ?? DEFAULT_NOW),
    ids: createSequentialIdGenerator(options.idPrefix),
    random: createSeededRandomSource(options.randomSeed ?? DEFAULT_RANDOM_SEED),
  };
}
