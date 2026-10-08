import type { CommitmentProgress } from "../../ports/wire.ts";
import { scheduleText, targetPhrase } from "../../shared/row-labels.ts";

type Started = Extract<CommitmentProgress, { state: "active" | "ended" }>;
type Row = Started["commitment"];
type Cell = Started["weeks"][number]["cells"][number];

const isLimit = (row: Row) =>
  row.measure.unit !== "done" && row.measure.target.direction === "limit";

/** "5 veces por semana · mínimo 10 min, ideal 30 min · peso 25 %" (design 24a, 24b). */
export function commitmentSubtitle(row: Row): string {
  const target = row.measure.unit === "done" ? "hecho / no hecho" : targetPhrase(row.measure);
  return `${scheduleText(row.measure)} · ${target} · peso ${row.weightPercent} %`;
}

/** "19 de 22 oportunidades"; nothing while no opportunity has counted. */
export function opportunitiesText(opportunities: Row["opportunities"]): string | null {
  const { kept, counted } = opportunities;
  if (counted === 0) return null;
  return `${kept} de ${counted} ${counted === 1 ? "oportunidad" : "oportunidades"}`;
}

/** "0 semanas" / "1 semana" / "12 días": the engine's streak, in its own unit. */
export function streakCount(streak: Row["streak"]): { current: string; best: string } {
  const [one, many] = streak.unit === "week" ? ["semana", "semanas"] : ["día", "días"];
  const text = (count: number) => `${count} ${count === 1 ? one : many}`;
  return { current: text(streak.current), best: text(streak.best) };
}

/** What keeps the streak going (design 24a for N a week; owner-approved for the rest). */
export function streakRule(
  row: Row,
  thisWeek: { readonly sessionsDone: number; readonly sessionsTarget: number } | null,
): string {
  const { schedule } = row.measure;
  if (schedule.period === "perSession" && schedule.frequency.kind === "timesPerWeek") {
    const times = schedule.frequency.times;
    const rule =
      times === 1
        ? "Una semana suma a la racha cuando cumples la 1 de 1."
        : `Una semana suma a la racha cuando cumples las ${times} de ${times}.`;
    return thisWeek === null
      ? rule
      : `${rule} Esta semana llevas ${thisWeek.sessionsDone} de ${thisWeek.sessionsTarget}.`;
  }
  const unit = schedule.period === "weeklyTotal" ? "Una semana" : "Un día";
  const keeps = isLimit(row) ? "no pasas de la tolerancia" : "llegas al mínimo";
  return `${unit} suma a la racha cuando ${keeps}.`;
}

/** "Cada celda es una de tus 5 oportunidades de la semana."; a weekly total is one cell a week. */
export function cellsHint(row: Row): string | null {
  const { schedule } = row.measure;
  if (schedule.period === "weeklyTotal") return null;
  const count =
    schedule.frequency.kind === "timesPerWeek"
      ? schedule.frequency.times
      : schedule.frequency.weekdays.length;
  return count === 1
    ? "Cada celda es tu oportunidad de la semana."
    : `Cada celda es una de tus ${count} oportunidades de la semana.`;
}

const LEGEND: Record<Cell["status"], string | null> = {
  ideal: "Ideal",
  minimum: "Mínimo",
  below: "No salió",
  missed: "No salió",
  unrecorded: "No salió",
  pending: null,
  future: null,
  paused: "Pausa",
  onHold: "En espera",
};

/** A history cell's name, in the legend's words; `null` for a cell that says nothing yet. */
export function cellLabel(cell: Pick<Cell, "status" | "late">, isToday: boolean): string | null {
  const label = cell.status === "pending" && isToday ? "Hoy" : LEGEND[cell.status];
  if (label === null) return null;
  return cell.late ? `${label}, registrado posteriormente` : label;
}

/** "Cada oportunidad vale hasta 6 pts." from the engine's two-decimal value, rounded to show. */
export function perOpportunityText(points: string | null): string | null {
  if (points === null) return null;
  const whole = Math.round(Number(points));
  return `Cada oportunidad vale hasta ${whole} ${whole === 1 ? "pt" : "pts"}.`;
}
