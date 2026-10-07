import type { MyCircle } from "../../ports/pactjoy-api.ts";
import type { SeasonDto } from "../../ports/wire.ts";

export type PactScreen = "review" | "waiting" | "closed" | "today";

export function commitmentCount(count: number): string {
  return `${count} ${count === 1 ? "compromiso" : "compromisos"}`;
}

/**
 * Approvals are keyed by circle member id, never by the auth user id. The season read carries no
 * viewer field, so the member id comes from the viewer's own circle row (`isYou`).
 */
export function viewerMemberId(myCircle: Pick<MyCircle, "circle">): string | null {
  return myCircle.circle?.members.find((member) => member.isYou)?.id ?? null;
}

/** Navigation only; the server remains the authority on unanimity and season dates. */
export function pactFlow(
  season: Pick<SeasonDto, "status" | "approvals">,
  viewerMemberId: string,
  closedSeen = false,
): PactScreen {
  if (season.status === "pactOpen") {
    return season.approvals.some((approval) => approval.memberId === viewerMemberId)
      ? "waiting"
      : "review";
  }
  return season.status === "closed" || closedSeen ? "today" : "closed";
}
