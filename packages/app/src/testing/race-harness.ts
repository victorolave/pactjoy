import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Result } from "../shared/result.ts";
import type { TestApp } from "./app-harness.ts";

/**
 * Deterministic two-way race (D5) for use-case tests, independent of how
 * many `await`s each use case happens to perform.
 *
 * Both calls run against the same in-memory stores. Each transaction is
 * paused right after its first season read (`seasons.get` or
 * `seasons.findLatestByCircle`) until BOTH
 * transactions have read -- so both hold a pre-race view of the season.
 * Then `winner` is released and runs to completion (commit); only after its
 * transaction has settled is `loser` released, so the loser always commits
 * second, against a stale view, and the outcome is fixed rather than
 * timing-dependent.
 *
 * Every transaction of both calls MUST read a season, or this never resolves.
 */
export async function raceTransactions<W, L>(
  app: TestApp,
  winner: (app: TestApp) => Promise<W>,
  loser: (app: TestApp) => Promise<L>,
): Promise<{ readonly winner: PromiseSettledResult<W>; readonly loser: PromiseSettledResult<L> }> {
  let arrived = 0;
  let releaseBoth!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  let winnerSettled!: () => void;
  const winnerDone = new Promise<void>((resolve) => {
    winnerSettled = resolve;
  });

  function wrap(isWinner: boolean): TestApp {
    const uow: UnitOfWork<Repositories> = {
      read: (work) => app.uow.read(work),
      transaction<T, E>(
        work: (repositories: Repositories) => Promise<Result<T, E>>,
      ): Promise<Result<T, E>> {
        const run = app.uow.transaction((repos) => {
          let paused = false;
          async function pauseAfterFirstSeasonRead<R>(value: R): Promise<R> {
            if (paused) return value;
            paused = true;
            arrived += 1;
            if (arrived === 2) releaseBoth();
            await bothRead;
            if (!isWinner) await winnerDone;
            return value;
          }
          return work({
            ...repos,
            seasons: {
              ...repos.seasons,
              get: async (id) => pauseAfterFirstSeasonRead(await repos.seasons.get(id)),
              findLatestByCircle: async (circleId) =>
                pauseAfterFirstSeasonRead(await repos.seasons.findLatestByCircle(circleId)),
            },
          });
        });
        return isWinner ? run.finally(winnerSettled) : run;
      },
    };
    return { ...app, uow };
  }

  const [winnerResult, loserResult] = await Promise.allSettled([
    winner(wrap(true)),
    loser(wrap(false)),
  ]);
  return { winner: winnerResult, loser: loserResult };
}
