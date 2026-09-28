import type { IdGenerator } from "../ports/id-generator.ts";
import type { RandomSource } from "../ports/random-source.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import { createFixedClock } from "./fixed-clock.ts";
import {
  createInMemoryCircleRepository,
  type InMemoryCircleRepository,
} from "./in-memory-circle-repository.ts";
import {
  createInMemorySeasonGateReader,
  type InMemorySeasonGateReader,
} from "./in-memory-season-gate-reader.ts";
import { createInMemoryUnitOfWork } from "./in-memory-unit-of-work.ts";
import { createSeededRandomSource } from "./seeded-random.ts";
import { createSequentialIdGenerator } from "./sequential-ids.ts";

/**
 * The ports every use-case test wires up, composed from deterministic
 * in-memory adapters. `uow` carries the concrete `Repositories` bag
 * (ADR-0008) -- `circles` is the first repository wired here (S3); later
 * slices extend `Repositories` (`ports/repositories.ts`) and this harness
 * together as their aggregates land. `circles`/`seasonGate` are the same
 * concrete instances backing `uow` (not copies), exposed directly so tests
 * can set up GIVEN state (e.g. `app.seasonGate.setStatus(...)`) without
 * going through a use case.
 */
export interface TestApp {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly uow: UnitOfWork<Repositories>;
  readonly circles: InMemoryCircleRepository;
  readonly seasonGate: InMemorySeasonGateReader;
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
  const circles = createInMemoryCircleRepository();
  const seasonGate = createInMemorySeasonGateReader();
  const repositories: Repositories = { circles, seasonGate };

  return {
    clock: createFixedClock(options.now ?? DEFAULT_NOW),
    ids: createSequentialIdGenerator(options.idPrefix),
    random: createSeededRandomSource(options.randomSeed ?? DEFAULT_RANDOM_SEED),
    circles,
    seasonGate,
    uow: createInMemoryUnitOfWork({
      repositories,
      // `seasonGate` is purely read-only (no `save`-like port method), so
      // the scope reuses the same live instance directly -- only `circles`
      // needs its own isolated, staged-write scope (ADR-0008, D4/D5).
      beginTransaction: () => {
        const scope = circles.beginTransaction();
        return {
          repositories: { circles: scope.repository, seasonGate },
          commit: scope.commit,
        };
      },
    }),
  };
}
