import type { PauseRequestReader } from "@pactjoy/app";

/**
 * TODO(A2): TEMPORARY until change A2 (app-pause-workflow) adds the pause
 * tables. Until then pause-aware scoring (SQ-8) sees NO pauses in production:
 * every season is scored as if nobody had ever paused. A2 replaces this with a
 * table-backed reader inside `bindRepositories`; nothing else should depend on
 * this stub, and it must not be exported from the package.
 */
export function createNoPauseRequestReader(): PauseRequestReader {
  return {
    async listBySeason() {
      return [];
    },
  };
}
