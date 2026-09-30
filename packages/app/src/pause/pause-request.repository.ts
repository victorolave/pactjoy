import type { MemberId, PauseRequest } from "@pactjoy/engine";
import type { SeasonId } from "../shared/ids.ts";

/** A {@link PauseRequest} plus the member who owns it (design, D6). */
export type MemberPauseRequest = PauseRequest & { readonly memberId: MemberId };

/**
 * READ-ONLY port over pause requests (design, D6). The request and approval
 * lifecycle ships in a later change (A2 `app-pause-workflow`); until then
 * this only lets score queries apply the engine's pause-aware scoring
 * (SQ-8). Adapters seed data out of band (tests: `InMemoryPauseRequestReader.add`).
 */
export interface PauseRequestReader {
  listBySeason(seasonId: SeasonId): Promise<readonly MemberPauseRequest[]>;
}
