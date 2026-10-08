import type { MeasureView } from "@pactjoy/app";
import type { Serialized } from "../../ports/wire.ts";
import { weekdaysText } from "../../shared/row-labels.ts";

type Measure = Serialized<MeasureView>;

const EVERY_DAY = 7;

/** "3 veces/sem", "Todos los días", "No exceder"... (design 23d, generalized with owner approval). */
function frequencyText(measure: Measure): string {
  if (measure.unit !== "done" && measure.target.direction === "limit") return "No exceder";
  const { schedule } = measure;
  if (schedule.period === "weeklyTotal") return "Total de la semana";
  const { frequency } = schedule;
  if (frequency.kind === "timesPerWeek") {
    return frequency.times === 1 ? "1 vez/sem" : `${frequency.times} veces/sem`;
  }
  return frequency.weekdays.length === EVERY_DAY
    ? "Todos los días"
    : weekdaysText(frequency.weekdays);
}

/** What one counted opportunity is called: a session, a day or a week. */
function opportunityNoun(measure: Measure, count: number): string {
  const { schedule } = measure;
  const [one, many] =
    schedule.period === "weeklyTotal"
      ? ["semana", "semanas"]
      : schedule.frequency.kind === "timesPerWeek"
        ? ["sesión", "sesiones"]
        : ["día", "días"];
  return count === 1 ? one : many;
}

/** "3 veces/sem · 11 de 13 sesiones": the frequency, then how many counted opportunities were kept. */
export function commitmentSubtitle(
  measure: Measure,
  opportunities: { readonly kept: number; readonly counted: number },
): string {
  const frequency = frequencyText(measure);
  if (opportunities.counted === 0) return frequency;
  const { kept, counted } = opportunities;
  return `${frequency} · ${kept} de ${counted} ${opportunityNoun(measure, counted)}`;
}

/** A private commitment seen by another member: only its weight. */
export function hiddenSubtitle(weightPercent: number): string {
  return `Peso ${weightPercent} %`;
}

/** "120 / 300": points over what the commitment can give (its weight of the 1,000). */
export function pointsOfPossible(points: number, weightPercent: number): string {
  return `${points} / ${weightPercent * 10}`;
}
