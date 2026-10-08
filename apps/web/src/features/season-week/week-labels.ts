import type { WeekSummary } from "../../ports/wire.ts";
import { pointsText } from "../../shared/format.ts";
import { formatDecimal, targetText, unitLabel } from "../../shared/row-labels.ts";

type Row = WeekSummary["commitments"][number];

const SHORT_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** "2026-09-15" -> { day: 15, month: "sep" }, read as a calendar date (no time zone). */
function dayAndMonth(isoDate: string): { day: number; month: string } {
  const [, month = "", day = ""] = isoDate.split("-");
  return { day: Number(day), month: SHORT_MONTHS[Number(month) - 1] ?? "" };
}

/** "15–21 sep" within a month, "25 ago – 19 oct" across months (design 23a, 25b). */
export function weekRangeText(start: string, end: string): string {
  const from = dayAndMonth(start);
  const to = dayAndMonth(end);
  return from.month === to.month
    ? `${from.day}–${to.day} ${to.month}`
    : `${from.day} ${from.month} – ${to.day} ${to.month}`;
}

/** "Semana 4 de 8 · 15–21 sep" (`weekIndex` is 0-based). */
export function weekMeta(summary: WeekSummary): string {
  return `Semana ${summary.weekIndex + 1} de ${summary.season.lengthWeeks} · ${weekRangeText(summary.start, summary.end)}`;
}

/** Only verifiable facts make a headline (owner decision): the best week, or a difficult one. */
export function headlineText(headline: WeekSummary["headline"]): string | null {
  if (headline === "best") return "Tu mejor semana hasta ahora.";
  if (headline === "difficult") return "Esta semana ha costado más.";
  return null;
}

/** Under a difficult headline (25c); nothing in the season's final week. */
export function weeksLeftText(weeksLeft: number): string | null {
  if (weeksLeft <= 0) return null;
  return weeksLeft === 1
    ? "Todavía tienes oportunidades: queda 1 semana."
    : `Todavía tienes oportunidades: quedan ${weeksLeft} semanas.`;
}

const percentText = (value: number | null) => (value === null ? "—" : `${value} %`);

/** The 25a banner's second line: "+96 pts · consistencia 83 %". */
export function bannerDetail(summary: WeekSummary): string {
  return `${pointsText(summary.points)} · consistencia ${percentText(summary.consistency)}`;
}

/** One commitment's week in the 25b breakdown: "4 de 5 · +20 pts", "125 / 150 min · +26 pts". */
export function breakdownText(row: Row): string {
  const { progress, measure } = row;
  if (progress === null) return "En pausa";
  let done: string;
  if (measure.schedule.period === "perSession") {
    done = `${progress.sessionsDone} de ${progress.sessionsTarget}`;
  } else {
    const unit = unitLabel(measure);
    const suffix = unit === null || unit === "" ? "" : ` ${unit}`;
    const value = formatDecimal(progress.value ?? "0");
    done =
      progress.target.direction === "reach"
        ? `${value} / ${formatDecimal(progress.target.ideal)}${suffix}`
        : `${value}${suffix} · ${targetText(measure) ?? ""}`;
  }
  return row.points === null ? done : `${done} · ${pointsText(row.points)}`;
}

/** "En el círculo: Andrea +87 · tú +96": only for a circle of exactly two (`circle` is `null` otherwise). */
export function circleLine(summary: WeekSummary): string | null {
  if (summary.circle === null) return null;
  const points = (value: number | null) => (value === null ? "—" : `+${value}`);
  const viewer = summary.circle.find((member) => member.memberId === summary.viewerId);
  const peers = summary.circle.filter((member) => member.memberId !== summary.viewerId);
  const parts = peers.map((peer) => `${peer.displayName} ${points(peer.points)}`);
  if (viewer !== undefined) parts.push(`tú ${points(viewer.points)}`);
  return `En el círculo: ${parts.join(" · ")}`;
}
