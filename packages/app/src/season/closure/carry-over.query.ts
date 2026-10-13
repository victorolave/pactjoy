import { findActiveMember } from "../../circle/circle.ts";
import type { Measure } from "../../commitment/commitment.ts";
import type { Repositories } from "../../ports/repositories.ts";
import type { Actor } from "../../shared/actor.ts";
import type { HabitId, SeasonId } from "../../shared/ids.ts";
import { err, ok, type Result } from "../../shared/result.ts";
import type { ClosureDecision } from "./season-closure.ts";

export interface CarryOverDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
}

export interface CarryOverInput {
  /** The season whose pact is open: the one the defaults are for. */
  readonly seasonId: SeasonId;
}

/** What the member decided for one habit last season, with the commitment as it was (defaults). */
export interface CarryOverItem {
  readonly habitId: HabitId;
  /** Never `graduate`: a graduated habit is gone for good. */
  readonly decision: Exclude<ClosureDecision, "graduate">;
  readonly previous: {
    readonly measure: Measure;
    readonly weightPercent: number;
    readonly privacy: "visible" | "private";
  };
}

export interface CarryOverView {
  /** The circle's previous closed season, or `null` if it never had one. */
  readonly previousSeasonId: SeasonId | null;
  /** In the previous season's commitment order; empty for a member with no closure of theirs. */
  readonly items: readonly CarryOverItem[];
}

export type CarryOverError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" };

/**
 * The defaults for a member's next pact, read from their OWN closure of the circle's previous
 * closed season (decision C9). It creates nothing: no commitment, no Pause ("Pausar" is only a
 * default) and no approval; the member still adds their commitments and the pact is approved as
 * always. Graduated habits are left out, whether they were graduated by that closure or since. A
 * laggard who never closed, a first season and a peer's closure all give nothing.
 */
export async function carryOver(
  deps: CarryOverDeps,
  actor: Actor,
  input: CarryOverInput,
): Promise<Result<CarryOverView, CarryOverError>> {
  return deps.uow.read(async (repos): Promise<Result<CarryOverView, CarryOverError>> => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) return err({ kind: "SeasonNotFound" });
    const circle = await repos.circles.get(season.circleId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!circle || !member) return err({ kind: "NotAMember" });
    if (season.status !== "pactOpen") return err({ kind: "PactNotOpen" });

    const all = await repos.seasons.listByCircle(circle.id);
    const current = all.findIndex((candidate) => candidate.id === season.id);
    const previous = all.slice(current + 1).find((candidate) => candidate.status === "closed");
    if (previous === undefined) return ok({ previousSeasonId: null, items: [] });

    const closure = await repos.seasonClosures.getMine(previous.id, member.id);
    if (closure === null) return ok({ previousSeasonId: previous.id, items: [] });

    const decided = closure.decisions.flatMap((entry) => {
      const commitment = previous.commitments.find((c) => c.id === entry.commitmentId);
      return commitment === undefined || entry.decision === "graduate"
        ? []
        : [{ commitment, decision: entry.decision }];
    });
    const habits = await repos.habits.getMany(decided.map(({ commitment }) => commitment.habitId));
    const graduated = new Set(
      habits.filter((habit) => habit.graduatedAt !== null).map((habit) => habit.id),
    );
    const items = decided
      .filter(({ commitment }) => !graduated.has(commitment.habitId))
      .map(
        ({ commitment, decision }): CarryOverItem => ({
          habitId: commitment.habitId,
          decision,
          previous: {
            measure: commitment.measure,
            weightPercent: commitment.weightPercent,
            privacy: commitment.privacy,
          },
        }),
      );
    return ok({ previousSeasonId: previous.id, items });
  });
}
