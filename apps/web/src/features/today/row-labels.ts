import type { MeasureView, TodayEntry } from "@pactjoy/app";

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

/** "30 min", or just the number for a done measure. */
export function quantityText(value: string, measure: MeasureView): string {
  const unit = unitLabel(measure);
  const number = formatDecimal(value);
  return unit === null || unit === "" ? number : `${number} ${unit}`;
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

/** What one logged entry reads as on its row. */
export function entryText(entry: TodayEntry, measure: MeasureView): string {
  switch (entry.value.kind) {
    case "done":
      return "Registrado hoy";
    case "missed":
      return "Hoy no salió";
    case "quantity":
      return quantityText(entry.value.value, measure);
  }
}
