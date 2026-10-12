import type { CommitmentPeriodSummary } from "@pactjoy/app";
import type { Serialized } from "../../ports/wire.ts";
import { longDate } from "../../shared/format.ts";

type Weeks = { readonly first: number; readonly last: number };
type SummaryRow = Serialized<CommitmentPeriodSummary>;

const NUMBER_WORDS: Readonly<Record<number, string>> = { 2: "dos", 3: "tres" };

const count = ({ first, last }: Weeks): number => last - first + 1;

/** "Revisión privada · semanas 3 y 4" (33). */
export function periodMeta(weeks: Weeks): string {
  const n = count(weeks);
  if (n === 1) return `Revisión privada · semana ${weeks.first}`;
  const joiner = n === 2 ? "y" : "a";
  return `Revisión privada · semanas ${weeks.first} ${joiner} ${weeks.last}`;
}

/** "Así fueron tus dos últimas semanas" (33). */
export function periodHeading(weeks: Weeks): string {
  const n = count(weeks);
  if (n === 1) return "Así fue tu última semana";
  const word = NUMBER_WORDS[n];
  return word === undefined
    ? `Así fueron tus últimas ${n} semanas`
    : `Así fueron tus ${word} últimas semanas`;
}

/** "83 %", or a dash when nothing was counted. */
export const percentText = (percent: number | null): string =>
  percent === null ? "–" : `${percent} %`;

/** "+184" (the points the period added); zero has no sign. */
export const pointsLabel = (points: number): string => (points > 0 ? `+${points}` : String(points));

/** "9 de 10 · ideal 80 %" (33); a weekly commitment counts weeks: "2 de 2 semanas · ideal 72 %". */
export function commitmentFigures(row: SummaryRow): string {
  if (row.counted === 0) return "Sin oportunidades en el periodo";
  const unit = row.scheduleKind === "weeklyTotal" ? " semanas" : "";
  const kept = `${row.kept} de ${row.counted}${unit}`;
  return row.idealPercent === null ? kept : `${kept} · ideal ${row.idealPercent} %`;
}

interface DoneInput {
  readonly improvements: readonly {
    readonly commitmentId: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly nextReviewDate: string | null;
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/**
 * The body of 35b: only the commitments that improved, as "de X a Y", then the next date. With
 * no improvement it is the date alone, and nothing at all after the closing review.
 */
export function doneText(input: DoneInput, names: ReadonlyMap<string, string>): string {
  const parts: string[] = [];
  const { improvements } = input;
  if (improvements.length > 0) {
    const who = list(improvements.map((i) => names.get(i.commitmentId) ?? "Un hábito"));
    const verb =
      improvements.length === 1 ? "se siente más automático" : "se sienten más automáticos";
    const pairs = list(improvements.map((i) => `de ${i.from} a ${i.to}`));
    parts.push(`${who} ${verb} que al empezar (${pairs}).`);
  }
  if (input.nextReviewDate !== null) {
    parts.push(`La próxima revisión es el ${longDate(input.nextReviewDate, false)}.`);
  }
  return parts.join(" ");
}
