import type { SeasonDto } from "../../ports/wire.ts";

export type PactScreen = "review" | "waiting" | "closed" | "today";

/** Navigation only; the server remains the authority on unanimity and season dates. */
export function pactFlow(
  season: Pick<SeasonDto, "status" | "approvals">,
  viewerId: string,
  closedSeen = false,
): PactScreen {
  if (season.status === "pactOpen") {
    return season.approvals.some((approval) => approval.memberId === viewerId)
      ? "waiting"
      : "review";
  }
  return season.status === "closed" || closedSeen ? "today" : "closed";
}
