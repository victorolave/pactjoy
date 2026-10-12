import type { PauseReasonCode } from "../../ports/pactjoy-api.ts";
import { dayMonth } from "../../shared/format.ts";

/** The design's reason chips (screen 26), in order. The codes are the API's; the labels are UI copy. */
export const PAUSE_REASON_OPTIONS: readonly {
  readonly value: PauseReasonCode;
  readonly label: string;
}[] = [
  { value: "health", label: "Salud o lesión" },
  { value: "travel", label: "Viaje" },
  { value: "work", label: "Trabajo" },
  { value: "other", label: "Otro" },
];

export function reasonLabel(reason: PauseReasonCode): string {
  return PAUSE_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? "Otro";
}

/**
 * "viernes 16 a las 9:12": the day and clock time of an instant in the SEASON's zone, not the
 * device's (PS-6). Built from parts, so the locale's punctuation cannot change the sentence.
 */
export function autoApproveText(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("es", {
    timeZone,
    weekday: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} a las ${part("hour")}:${part("minute")}`;
}

/** "del 5 al 9 de octubre", "solo hoy", "desde hoy, hasta que la reanudes". */
export function periodText(
  startDate: string,
  endDate: string | null,
  today: string,
  /** Who resumes an open pause: "la reanudes" to its owner, "la reanude" to anyone else. */
  openEnd = "hasta que la reanudes",
): string {
  const from = startDate === today ? "hoy" : `el ${dayMonth(startDate)}`;
  if (endDate === null) return `desde ${from}, ${openEnd}`;
  if (startDate === endDate) return startDate === today ? "solo hoy" : from;
  const [startMonth, endMonth] = [dayMonth(startDate), dayMonth(endDate)];
  const sameMonth = startMonth.split(" de ")[1] === endMonth.split(" de ")[1];
  return sameMonth
    ? `del ${Number(startDate.slice(8))} al ${endMonth}`
    : `del ${startMonth} al ${endMonth}`;
}

/** "en 48 h", "en 20 min", "en unos instantes": how long until the request approves itself. */
export function remainingApprovalText(autoApproveAt: string, nowMs: number): string {
  const ms = Date.parse(autoApproveAt) - nowMs;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "en unos instantes";
  if (minutes < 60) return `en ${minutes} min`;
  return `en ${Math.round(ms / 3_600_000)} h`;
}

/** "A", "A y B", "A, B y C". */
export function commitmentList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}
