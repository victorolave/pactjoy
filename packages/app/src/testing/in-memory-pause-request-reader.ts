import type { MemberPauseRequest, PauseRequestReader } from "../pause/pause-request.repository.ts";
import type { SeasonId } from "../shared/ids.ts";

export interface InMemoryPauseRequestReader extends PauseRequestReader {
  /** Test-only seeding: the real request lifecycle does not exist yet (A2). */
  add(seasonId: SeasonId, pause: MemberPauseRequest): void;
}

/** Deterministic in-memory {@link PauseRequestReader}. Read-only port, so no transaction scope is needed. */
export function createInMemoryPauseRequestReader(): InMemoryPauseRequestReader {
  const store: { readonly seasonId: SeasonId; readonly pause: MemberPauseRequest }[] = [];
  return {
    async listBySeason(seasonId) {
      return store.filter((row) => row.seasonId === seasonId).map((row) => row.pause);
    },
    add(seasonId, pause) {
      store.push({ seasonId, pause });
    },
  };
}
