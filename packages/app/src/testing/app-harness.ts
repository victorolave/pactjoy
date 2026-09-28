import { createIntlTimeZone } from "../adapters/intl-time-zone.ts";
import type { SeasonGateReader } from "../circle/season-gate.port.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { RandomSource } from "../ports/random-source.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { createSeasonGateReader } from "../season/season-gate-reader.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { createFixedClock } from "./fixed-clock.ts";
import {
  createInMemoryCircleRepository,
  type InMemoryCircleRepository,
} from "./in-memory-circle-repository.ts";
import {
  createInMemoryHabitRepository,
  type InMemoryHabitRepository,
} from "./in-memory-habit-repository.ts";
import {
  createInMemorySeasonRepository,
  type InMemorySeasonRepository,
} from "./in-memory-season-repository.ts";
import { createInMemoryUnitOfWork } from "./in-memory-unit-of-work.ts";
import { createSeededRandomSource } from "./seeded-random.ts";
import { createSequentialIdGenerator } from "./sequential-ids.ts";

/**
 * The ports every use-case test wires up, composed from deterministic
 * in-memory adapters. `uow` carries the concrete `Repositories` bag
 * (ADR-0008) -- `circles`/`habits`/`seasons` are the same concrete
 * instances backing `uow` (not copies), exposed directly so tests can set
 * up GIVEN state without going through a use case (e.g. saving a `Season`
 * fixture directly via `app.uow.transaction` to control `seasonGate`'s
 * answer, S4/B11 -- there is no more `setStatus` override: `seasonGate` is
 * now a real `createSeasonGateReader(seasons)` reading through the same
 * live `seasons` store, not a standalone settable double).
 */
export interface TestApp {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly timeZone: TimeZone;
  readonly uow: UnitOfWork<Repositories>;
  readonly circles: InMemoryCircleRepository;
  readonly habits: InMemoryHabitRepository;
  readonly seasons: InMemorySeasonRepository;
  readonly seasonGate: SeasonGateReader;
}

export interface CreateTestAppOptions {
  readonly now?: Instant;
  readonly idPrefix?: string;
  readonly randomSeed?: number;
  /** Defaults to the real `IntlTimeZone` adapter (deterministic given a fixed IANA zone). */
  readonly timeZone?: TimeZone;
}

const DEFAULT_NOW: Instant = instant(1_700_000_000_000);
const DEFAULT_RANDOM_SEED = 42;

/** Builds a fully deterministic {@link TestApp} for use-case tests. */
export function createTestApp(options: CreateTestAppOptions = {}): TestApp {
  const circles = createInMemoryCircleRepository();
  const habits = createInMemoryHabitRepository();
  const seasons = createInMemorySeasonRepository();
  const seasonGate = createSeasonGateReader(seasons);
  const repositories: Repositories = { circles, habits, seasons, seasonGate };

  return {
    clock: createFixedClock(options.now ?? DEFAULT_NOW),
    ids: createSequentialIdGenerator(options.idPrefix),
    random: createSeededRandomSource(options.randomSeed ?? DEFAULT_RANDOM_SEED),
    timeZone: options.timeZone ?? createIntlTimeZone(),
    circles,
    habits,
    seasons,
    seasonGate,
    uow: createInMemoryUnitOfWork({
      repositories,
      // `seasonGate` is purely read-only (no `save`-like port method) and
      // itself only reads through `seasons`, so it needs no isolation of
      // its own: it already sees `seasons`' scoped, staged view whenever
      // it's constructed fresh per-scope below (read-your-own-writes,
      // ADR-0008, D4/D5).
      //
      // Atomic across repositories (D5): validate EVERY scope's staged
      // writes first -- if any throws ConcurrencyConflict, nothing has
      // been mutated yet, so this whole transaction leaves no trace. Only
      // once every scope has validated cleanly do we apply any of them.
      // Splitting each scope's own commit into validate()/apply() is what
      // makes this possible without a partial commit across repositories.
      beginTransaction: () => {
        const circleScope = circles.beginTransaction();
        const habitScope = habits.beginTransaction();
        const seasonScope = seasons.beginTransaction();
        return {
          repositories: {
            circles: circleScope.repository,
            habits: habitScope.repository,
            seasons: seasonScope.repository,
            seasonGate: createSeasonGateReader(seasonScope.repository),
          },
          commit(): void {
            circleScope.validate();
            habitScope.validate();
            seasonScope.validate();
            circleScope.apply();
            habitScope.apply();
            seasonScope.apply();
          },
        };
      },
    }),
  };
}
