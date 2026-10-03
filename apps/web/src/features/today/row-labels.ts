import type { MeasureView, TodayEntry } from "@pactjoy/app";
import { fromScaled, toScaled } from "../../shared/decimal.ts";
import { weekdayName } from "../../shared/format.ts";

/** Decimal strings come from the server with a dot; Spanish writes a comma. */
export const formatDecimal = (value: string): string => value.replace(".", ",");

const UNIT_LABELS = {
  minutes: "min",
  hours: "h",
  times: "veces",
  pages: "págs.",
  km: "km",
  glasses: "vasos",
} as const;

export function unitLabel(measure: MeasureView): string | null {
  if (measure.unit === "done") return null;
  if (measure.unit === "custom") return measure.customLabel ?? "";
  return UNIT_LABELS[measure.unit];
}

const SINGULAR: Readonly<Record<string, string>> = { veces: "vez", vasos: "vaso", "págs.": "pág." };

/** "30 min", "1 vez", or just the number for a done measure. */
export function quantityText(value: string, measure: MeasureView): string {
  const label = unitLabel(measure);
  const unit = value === "1" && label !== null ? (SINGULAR[label] ?? label) : label;
  const number = formatDecimal(value);
  return unit === null || unit === "" ? number : `${number} ${unit}`;
}

/** The exact sum of the quantities among `entries`, as a decimal string ("5.5"). */
export function sumQuantities(entries: readonly TodayEntry[]): string {
  const total = entries.reduce(
    (sum, entry) =>
      entry.value.kind === "quantity" ? sum + (toScaled(entry.value.value) ?? 0n) : sum,
    0n,
  );
  return fromScaled(total);
}

/** The commitment's thresholds: "mín. 10 · ideal 30 min". Nothing for done/not done. */
export function targetText(measure: MeasureView): string | null {
  if (measure.unit === "done") return null;
  const { target } = measure;
  const unit = unitLabel(measure);
  const suffix = unit === null || unit === "" ? "" : ` ${unit}`;
  return target.direction === "reach"
    ? `mín. ${formatDecimal(target.minimum)} · ideal ${formatDecimal(target.ideal)}${suffix}`
    : `ideal hasta ${formatDecimal(target.ideal)} · tolerancia ${formatDecimal(target.tolerance)}${suffix}`;
}

/** Monday first, as the engine numbers weekdays. */
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

export function weekdaysText(weekdays: readonly number[]): string {
  const names = weekdays.map((day) => WEEKDAYS[day] ?? "");
  const [first = "", ...rest] = names;
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(" · ");
}

export function scheduleText(measure: MeasureView): string {
  const { schedule } = measure;
  if (schedule.period === "weeklyTotal") return "Total de la semana";
  return schedule.frequency.kind === "specificDays"
    ? weekdaysText(schedule.frequency.weekdays)
    : `${schedule.frequency.times} veces por semana`;
}

/**
 * What one logged entry reads as on its row. An entry can belong to yesterday (grace period): then
 * it says the weekday instead of "hoy". Without `today` every entry reads as today's.
 */
export function entryText(entry: TodayEntry, measure: MeasureView, today?: string): string {
  const day = today === undefined || entry.forDate === today ? null : weekdayName(entry.forDate);
  switch (entry.value.kind) {
    case "done":
      return day === null ? "Registrado hoy" : `Registrado el ${day}`;
    case "missed":
      return day === null ? "Hoy no salió" : `No salió el ${day}`;
    case "quantity": {
      const amount = quantityText(entry.value.value, measure);
      return day === null ? amount : `${amount} · ${day}`;
    }
  }
}
