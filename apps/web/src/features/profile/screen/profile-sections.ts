import type { HabitDto, SeasonHistoryItemDto } from "../../../ports/wire.ts";

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
