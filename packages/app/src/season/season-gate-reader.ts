import type { SeasonGateReader, SeasonGateStatus } from "../circle/season-gate.port.ts";
import type { CircleId } from "../shared/ids.ts";
import type { SeasonRepository } from "./season.repository.ts";

/**
 * {@link SeasonGateReader} backed by the real {@link SeasonRepository}
 * (B11, replaces S3's standalone `InMemorySeasonGateReader`). The mapping
 * is 1:1: `Season.status` and `SeasonGateStatus` share the same three
 * literal members (`"pactOpen" | "active" | "closed"`) by construction
 * (`season.ts`'s `SeasonStatus`); the only extra case is `"noSeason"`,
 * returned when the circle has never had one.
 *
 * Least-churn choice (ADR-0008): kept `SeasonGateReader`/`SeasonGateStatus`
 * exactly as S3 defined them (already B11-correct) and added this one
 * adapter function instead of touching the port or every call site
 * (`join-circle.ts` needs zero changes) -- swapping which adapter backs
 * the port only means rewiring `testing/app-harness.ts`'s composition.
 */
export function createSeasonGateReader(seasons: SeasonRepository): SeasonGateReader {
  return {
    async statusForCircle(circleId: CircleId): Promise<SeasonGateStatus> {
      const latest = await seasons.findLatestByCircle(circleId);
      return latest?.status ?? "noSeason";
    },
  };
}
