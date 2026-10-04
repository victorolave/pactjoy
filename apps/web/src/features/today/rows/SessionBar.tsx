import type { TodayRow } from "@pactjoy/app";
import { fromScaled } from "../../../shared/decimal.ts";
import { loggedToday } from "../../../shared/logged-totals.ts";
import { reachMarks } from "../../../shared/row-labels.ts";
import { useTodayDates } from "../../../shared/today-date-context.tsx";
import { ProgressBar } from "../../../ui/ProgressBar.tsx";

/**
 * The bar of a per-session reach quantity (design proto, Leer): what today has so far against the
 * minimum and the ideal. Nothing else gets one: done/not done has no bar, a limit has no scale.
 */
export function SessionBar({ row }: { readonly row: TodayRow }) {
  const dates = useTodayDates();
  const { measure } = row;
  if (
    measure.unit === "done" ||
    measure.target.direction !== "reach" ||
    measure.schedule.period !== "perSession"
  ) {
    return null;
  }
  const { minimum, ideal } = measure.target;
  return (
    <ProgressBar
      name={`Cantidad de hoy en ${row.habitName}`}
      value={Number(fromScaled(loggedToday(row, dates?.refDate)))}
      max={Number(ideal)}
      minimum={Number(minimum)}
      marks={reachMarks(measure)}
    />
  );
}
