import type { HabitDto, ProfileSummaryDto, SeasonHistoryItemDto } from "../../../ports/wire.ts";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-08-25" -> "25 ago" (a civil date: no time zone can move the day). */
function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? isoDate : `${Number(day)} ${name}`;
}

/** Derived copy (owner review): the closed season row has no design. */
export function seasonRowTitle(season: SeasonHistoryItemDto): string {
  return `Temporada de ${season.lengthWeeks} semanas`;
}

/**
 * "25 ago – 19 oct · Puesto 2 de 2 · 792 pts"; a season closed without the member's own decisions
 * says so instead of the rank (a laggard has no standing line to show).
 */
export function seasonRowSubtitle(season: SeasonHistoryItemDto): string {
  const dates = `${shortDate(season.actualStart)} – ${shortDate(season.lastDay)}`;
  if (!season.closedByMe) return `${dates} · Cerrada sin tus decisiones`;
  const parts = [dates];
  if (season.rank !== null) parts.push(`Puesto ${season.rank} de ${season.memberCount}`);
  parts.push(`${season.points} pts`);
  return parts.join(" · ");
}

/** The graduated habits, the most recently graduated first. */
export function graduatedHabits(
  habits: readonly HabitDto[],
): readonly (HabitDto & { readonly graduatedAt: string })[] {
  return habits
    .flatMap((habit) =>
      habit.graduatedAt === null ? [] : [{ ...habit, graduatedAt: habit.graduatedAt }],
    )
    .sort((a, b) => b.graduatedAt.localeCompare(a.graduatedAt));
}

type Consistency = ProfileSummaryDto["consistency"];

/** "84 %" from the server's rounded percent: the web never rounds or recomputes it. */
export function consistencyPercentText(percent: number): string {
  return `${percent} %`;
}

/**
 * The card's right-hand text (design 39: "1 temporada" over "en curso"). The count is every season
 * that contributed. With closed seasons behind it, "en curso" would read as if all of them were in
 * progress, so the second line says how many are: "3 temporadas" over "1 en curso".
 */
export function consistencySeasonLines(consistency: Consistency): readonly string[] {
  const total = consistency.closedSeasons + (consistency.inProgress ? 1 : 0);
  if (total === 0) return [];
  const head = `${total} ${total === 1 ? "temporada" : "temporadas"}`;
  if (!consistency.inProgress) return [head];
  return [head, consistency.closedSeasons === 0 ? "en curso" : "1 en curso"];
}

/** No figure yet: the existing wording, minus the promise of a closed season when one is running. */
export function CONSISTENCY_EMPTY({ inProgress }: { readonly inProgress: boolean }): string {
  return inProgress
    ? "Aún sin datos."
    : "Aún sin datos. La verás cuando cierres tu primera temporada.";
}

export const CONSISTENCY_ERROR = "No pudimos cargar tu consistencia.";
export const HABITS_ERROR = "No pudimos cargar tus hábitos.";
export const HABITS_EMPTY =
  "Aún no hay hábitos. Los verás aquí cuando tu círculo empiece una temporada.";
/** A habit with no commitment in the circle's current season (owner decision, 2026-10-13). */
export const OUT_OF_SEASON_NOTE = "Fuera de esta temporada";
