import type { CommitmentId } from "@pactjoy/engine";
import {
  commitmentWeeklySeries,
  displayPercent,
  frac,
  type HabitStage,
  type MemberId,
} from "@pactjoy/engine";
import { type Circle, findActiveMember } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Habit } from "../habit/habit.ts";
import type { Repositories } from "../ports/repositories.ts";
import { commitmentStages } from "../review/commitment-stage.query.ts";
import { hasCompletedPeriodicReview } from "../review/completed-review.ts";
import {
  loadPausesFor,
  type ScoreContext,
  type ScoreData,
  type ScoreQueryDeps,
  scoreContextOf,
} from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { HabitId, SeasonId } from "../shared/ids.ts";

export type ProfileSummaryDeps = ScoreQueryDeps;

export type ProfileHabitStage = Exclude<HabitStage, "graduated">;

/** The viewer's historical consistency, pooled exactly over the active circle's seasons. */
export interface ProfileConsistency {
  /** Opportunities that reached the minimum, summed over every own commitment and week. */
  readonly kept: number;
  /** Counted opportunities (so far, for the season in progress). */
  readonly counted: number;
  /** `displayPercent(kept / counted)`, rounded once, here (D10); `null` with nothing counted. */
  readonly percent: number | null;
  /** Closed seasons of the active circle in which the viewer held a commitment. */
  readonly closedSeasons: number;
  /** The active season (ended or not, until it is closed) contributes "so far". */
  readonly inProgress: boolean;
}

export interface ProfileHabit {
  readonly habitId: HabitId;
  readonly name: string;
  readonly icon: string | null;
  readonly stage: ProfileHabitStage;
  /** The habit is committed in the circle's latest season while it is not closed. */
  readonly inCurrentSeason: boolean;
}

export interface ProfileSummaryView {
  readonly consistency: ProfileConsistency;
  readonly habits: readonly ProfileHabit[];
}

const NO_CONSISTENCY: ProfileConsistency = {
  kept: 0,
  counted: 0,
  percent: null,
  closedSeasons: 0,
  inProgress: false,
};

/** A season the viewer took part in that has started: where its figures and stages come from. */
interface StartedSeason {
  readonly season: Season;
  readonly context: ScoreContext;
  readonly data: ScoreData;
}

/**
 * Perfil's "Consistencia historica" and "Tus habitos" (design 39): one owner-only, total read.
 *
 * - Consistency pools the INTEGER `kept` / `counted` of `commitmentWeeklySeries` over every own
 *   commitment and week of the active circle's closed seasons plus the season in progress (so far),
 *   and rounds once at the end. It never averages percents, and it equals `scoreMember`'s
 *   consistency for any single season (pinned by tests). Graduated and private commitments count,
 *   like in `scoreMember`.
 * - Each non-graduated habit shows the stage it has in the newest STARTED season where the viewer
 *   committed it. Perfil-only carry-over (owner decision): while that season is the one in
 *   progress and the viewer has completed no interim or closing review in it (the baseline does
 *   not count), the habit shows the stage it ended the latest earlier season with. Screen 17's
 *   badge (`commitmentStage`) is not affected.
 * - ONE instant per read: the clock is read once and shared with every helper, so the figures and
 *   the stages can never disagree on "today".
 *
 * Only the active circle is read (left circles are out), only the viewer's own commitments,
 * Entries and reviews are used, and nothing is written.
 */
export async function profileSummary(
  deps: ProfileSummaryDeps,
  actor: Actor,
): Promise<ProfileSummaryView> {
  return deps.uow.read(async (repos): Promise<ProfileSummaryView> => {
    const now = deps.clock.now();
    const frozen: ProfileSummaryDeps = { ...deps, clock: { now: () => now } };
    const habits = (await repos.habits.listByOwner(actor.userId)).filter(
      (habit) => habit.graduatedAt === null,
    );
    const circle = await repos.circles.findActiveByUser(actor.userId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!circle || !member) {
      return {
        consistency: NO_CONSISTENCY,
        habits: oldestFirst(habits).map((habit) => listed(habit, "new", false)),
      };
    }

    const seasons = await repos.seasons.listByCircle(circle.id);
    const started: StartedSeason[] = [];
    let kept = 0;
    let counted = 0;
    let closedSeasons = 0;
    let inProgress = false;
    for (const season of seasons) {
      const own = ownCommitments(season, member.id);
      if (own.length === 0) continue;
      const context = scoreContextOf(frozen, season, circle, actor);
      if (!context.ok || context.value.start === null) continue;
      const { actualStart, today } = context.value.start;
      const data: ScoreData = {
        entries: await repos.entries.listBySeason(season.id),
        pauses: await loadPausesFor(frozen, repos, context.value),
      };
      started.push({ season, context: context.value, data });
      for (const series of commitmentWeeklySeries(
        toScoreInput({
          season,
          actualStart,
          memberId: member.id,
          entries: data.entries,
          pauses: data.pauses,
          today,
        }),
      )) {
        for (const week of series.weeks) {
          kept += week.kept;
          counted += week.counted;
        }
      }
      if (season.status === "closed") closedSeasons += 1;
      else inProgress = true;
    }

    const latest = seasons[0];
    const current = latest !== undefined && latest.status !== "closed" ? latest : null;
    const stageOf = stageResolver(frozen, repos, circle, member.id, started);
    const rows: ProfileHabit[] = [];
    for (const habit of habits) {
      const stage = await stageOf(habit.id);
      // Unreachable while graduated habits are filtered out above; kept so a graduated stage
      // never lists the habit outside "Hábitos graduados".
      if (stage === "graduated") continue;
      rows.push(listed(habit, stage, current !== null && commits(current, member.id, habit.id)));
    }

    return {
      consistency: {
        kept,
        counted,
        percent: counted === 0 ? null : displayPercent(frac(BigInt(kept), BigInt(counted))),
        closedSeasons,
        inProgress,
      },
      habits: ordered(rows, current, member.id),
    };
  });
}

function ownCommitments(season: Season, memberId: MemberId): readonly CommitmentRecord[] {
  return season.commitments.filter((commitment) => commitment.memberId === memberId);
}

function commits(season: Season, memberId: MemberId, habit: HabitId): boolean {
  return ownCommitments(season, memberId).some((commitment) => commitment.habitId === habit);
}

function listed(habit: Habit, stage: ProfileHabitStage, inCurrentSeason: boolean): ProfileHabit {
  return {
    habitId: habit.id,
    name: habit.name,
    icon: habit.icon,
    stage,
    inCurrentSeason,
  };
}

/** `listByOwner` is newest first; the list shows creation order, oldest first. */
function oldestFirst(habits: readonly Habit[]): readonly Habit[] {
  return [...habits].reverse();
}

/**
 * In-season habits first, in the member's commitment order of the current season, then the rest
 * by creation (oldest first). `rows` arrives newest first, as the repository returns it.
 */
function ordered(
  rows: readonly ProfileHabit[],
  current: Season | null,
  memberId: MemberId,
): readonly ProfileHabit[] {
  const inSeason = rows.filter((row) => row.inCurrentSeason);
  const order = current
    ? ownCommitments(current, memberId).map((commitment) => commitment.habitId)
    : [];
  inSeason.sort((a, b) => order.indexOf(a.habitId) - order.indexOf(b.habitId));
  const rest = rows.filter((row) => !row.inCurrentSeason).reverse();
  return [...inSeason, ...rest];
}

type ResolvedStage = HabitStage;

/**
 * The stage a habit shows (see {@link profileSummary}). Stages are derived per season at most
 * once; the "has a completed review" check is made at most once per active season.
 */
function stageResolver(
  deps: ProfileSummaryDeps,
  repos: Repositories,
  circle: Circle,
  memberId: MemberId,
  started: readonly StartedSeason[],
): (habit: HabitId) => Promise<ResolvedStage> {
  const stagesBySeason = new Map<SeasonId, Promise<ReadonlyMap<CommitmentId, HabitStage>>>();
  const reviewed = new Map<SeasonId, Promise<boolean>>();
  const stagesIn = (entry: StartedSeason) => {
    let stages = stagesBySeason.get(entry.season.id);
    if (stages === undefined) {
      stages = commitmentStages(deps, repos, {
        season: entry.season,
        circle,
        memberId,
        data: entry.data,
      });
      stagesBySeason.set(entry.season.id, stages);
    }
    return stages;
  };
  const hasReview = (entry: StartedSeason) => {
    let result = reviewed.get(entry.season.id);
    if (result === undefined) {
      result = hasCompletedPeriodicReview(repos, entry.season.id, memberId);
      reviewed.set(entry.season.id, result);
    }
    return result;
  };
  const commitmentOf = (entry: StartedSeason, habit: HabitId) =>
    ownCommitments(entry.season, memberId).find((commitment) => commitment.habitId === habit);

  return async (habit) => {
    // `started` is newest first, so the first match is the newest started season with the habit.
    const committed = started.filter((entry) => commitmentOf(entry, habit) !== undefined);
    const [newest, previous] = committed;
    if (newest === undefined) return "new";
    const source =
      newest.season.status === "active" && previous !== undefined && !(await hasReview(newest))
        ? previous
        : newest;
    const commitment = commitmentOf(source, habit);
    return (commitment && (await stagesIn(source)).get(commitment.id)) ?? "new";
  };
}
