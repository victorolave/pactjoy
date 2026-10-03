import { pointsText } from "../../shared/format.ts";
import { quantityText, sumQuantities } from "./row-labels.ts";
import type { DayTodayRow } from "./today-view-model.ts";

const list = (items: readonly string[]): string =>
  new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(items);

/** "Leer 30 min" for a quantity, the bare name for a done or a day marked "Hoy no salió". */
function itemOf(row: DayTodayRow, refDate: string): string {
  const quantities = row.entries.filter(
    (entry) => entry.value.kind === "quantity" && entry.forDate === refDate,
  );
  if (quantities.length === 0) return row.habitName;
  return `${row.habitName} ${quantityText(sumQuantities(quantities), row.measure)}`;
}

/**
 * The line under "N de N compromisos de hoy" (design 15b): what was logged, then the day's points
 * from the server ("Leer 30 min y Dibujar. +14 pts hoy."). The points are left out when there are
 * none to show.
 */
export function allDoneDetail(
  rows: readonly DayTodayRow[],
  refDate: string,
  pointsToday: number | undefined,
): string {
  const items = `${list(rows.map((row) => itemOf(row, refDate)))}.`;
  return pointsToday !== undefined && pointsToday > 0
    ? `${items} ${pointsText(pointsToday)} hoy.`
    : items;
}
