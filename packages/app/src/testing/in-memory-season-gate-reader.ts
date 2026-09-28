import type { SeasonGateReader, SeasonGateStatus } from "../circle/season-gate.port.ts";
import type { CircleId } from "../shared/ids.ts";

export interface InMemorySeasonGateReader extends SeasonGateReader {
  /** Test-only: configures the status a subsequent `statusForCircle` call returns. */
  setStatus(circleId: CircleId, status: SeasonGateStatus): void;
}

/**
 * Deterministic in-memory {@link SeasonGateReader} for tests: defaults to
 * `"noSeason"` (ADR-0008). Purely read-only (no `save`-like method on the
 * port), so unlike `in-memory-circle-repository.ts` it needs no
 * `beginTransaction()`/staged-write isolation: every read always reflects
 * the live store, transaction or not.
 */
export function createInMemorySeasonGateReader(): InMemorySeasonGateReader {
  const store = new Map<CircleId, SeasonGateStatus>();

  return {
    async statusForCircle(circleId: CircleId): Promise<SeasonGateStatus> {
      return store.get(circleId) ?? "noSeason";
    },

    setStatus(circleId: CircleId, status: SeasonGateStatus): void {
      store.set(circleId, status);
    },
  };
}
