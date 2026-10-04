import type { DayTodayRow, WeekTodayRow } from "../today-view-model.ts";

/** Monday first, as the engine numbers weekdays. */
const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DAYS_PER_WEEK = 7;

/** Monday-first weekday (0..6) of a calendar date, read in UTC so no time zone moves it. */
function weekdayOf(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % DAYS_PER_WEEK;
}

/** The next weekday after `isoDate` on which one of `weekdays` falls: "martes". */
export function nextWeekdayName(weekdays: readonly number[], isoDate: string): string {
  const today = weekdayOf(isoDate);
  const next =
    weekdays.filter((day) => day > today).sort((a, b) => a - b)[0] ??
    Math.min(...weekdays) + DAYS_PER_WEEK;
  return WEEKDAY_NAMES[next % DAYS_PER_WEEK] ?? "";
}

/**
 * What a day with nothing scheduled says (design 15c): where each "N times a week" habit stands and
 * when each day-bound habit comes back. Weekly totals have no sessions to rank, so they stay out.
 */
export function dayOffText(
  week: readonly WeekTodayRow[],
  otherDays: readonly DayTodayRow[],
  isoDate: string,
): string {
  const sentences: string[] = [];
  for (const row of week) {
    const { schedule } = row.measure;
    if (row.progress === null || schedule.period !== "perSession") continue;
    const { sessionsDone, sessionsTarget } = row.progress;
    if (sessionsDone < sessionsTarget) {
      sentences.push(`${row.habitName} va ${sessionsDone} de ${sessionsTarget} esta semana.`);
    } else {
      sentences.push(
        `${row.habitName} ya va ${sessionsDone} de ${sessionsTarget} esta semana. Si lo haces hoy, cuentan tus ${sessionsTarget} mejores sesiones: una más larga puede sustituir a la más corta y sumar puntos.`,
      );
    }
  }
  for (const row of otherDays) {
    const { schedule } = row.measure;
    if (schedule.period !== "perSession" || schedule.frequency.kind !== "specificDays") continue;
    sentences.push(
      `${row.habitName} vuelve el ${nextWeekdayName(schedule.frequency.weekdays, isoDate)}.`,
    );
  }
  return sentences.join(" ");
}
