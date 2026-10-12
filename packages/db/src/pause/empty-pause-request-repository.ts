import type { PauseRequestRepository } from "@pactjoy/app";

/**
 * TRANSITIONAL: keeps the pause port bound until the Postgres adapter and its
 * tables land (change `pause-workflow`, work unit S4, which replaces this file).
 * Until then production holds no pause requests: every season is scored as if
 * nobody had ever paused, and nothing can write one (no use case saves a
 * request yet). Nothing else should depend on this, and it is not exported
 * from the package.
 */
export function createEmptyPauseRequestRepository(): PauseRequestRepository {
  return {
    async get() {
      return null;
    },
    async listBySeason() {
      return [];
    },
    async listDue() {
      return [];
    },
    async save() {
      throw new Error("not implemented: the pause request tables arrive with the Postgres adapter");
    },
  };
}
