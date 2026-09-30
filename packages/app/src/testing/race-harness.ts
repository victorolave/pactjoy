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
 * A transaction that settles without reading a season still counts as
 * arrived, so the other one is never left waiting.
 *
 * `pauseOn: "entries"` moves the pause point to the first idempotency
 * lookup (`entries.findByClientRequest`) instead, so two duplicate
 * `recordEntry` calls both miss before either commits (T1).
 */
export async function raceTransactions<W, L>(
  app: TestApp,
  winner: (app: TestApp) => Promise<W>,
  loser: (app: TestApp) => Promise<L>,
  pauseOn: "seasons" | "entries" = "seasons",
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

  // Resolves once the loser has reached its pause point or settled. A winner
  // that never pauses itself (e.g. a leave) holds its commit until then, so
  // the loser is guaranteed to have read the pre-race state.
  let loserReached!: () => void;
  const loserArrived = new Promise<void>((resolve) => {
    loserReached = resolve;
  });

  function wrap(isWinner: boolean): TestApp {
    const uow: UnitOfWork<Repositories> = {
      read: (work) => app.uow.read(work),
      transaction<T, E>(
        work: (repositories: Repositories) => Promise<Result<T, E>>,
      ): Promise<Result<T, E>> {
        let counted = false;
        function countArrival(): void {
          if (counted) return;
          counted = true;
          arrived += 1;
          if (!isWinner) loserReached();
          if (arrived === 2) releaseBoth();
        }
        const run = app.uow.transaction(async (repos) => {
          const result = await runWork(repos);
          if (isWinner) await loserArrived;
          return result;
        });
        function runWork(repos: Repositories): Promise<Result<T, E>> {
          let paused = false;
          async function pauseAfterFirstSeasonRead<R>(value: R): Promise<R> {
            if (paused) return value;
            paused = true;
            countArrival();
            await bothRead;
            if (!isWinner) await winnerDone;
            return value;
          }
          if (pauseOn === "entries") {
            return work({
              ...repos,
              entries: {
                ...repos.entries,
                findByClientRequest: async (memberId, commitmentId, clientRequestId) =>
                  pauseAfterFirstSeasonRead(
                    await repos.entries.findByClientRequest(
                      memberId,
                      commitmentId,
                      clientRequestId,
                    ),
                  ),
              },
            });
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
        }
        // A transaction that settles (err or throw) without ever reading a
        // season still counts as arrived, so the other side is never left
        // waiting on a barrier that can no longer fill.
        return run.finally(() => {
          countArrival();
          if (isWinner) winnerSettled();
        });
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
