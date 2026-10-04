import { fromScaled } from "../../shared/decimal.ts";
import { formatDecimal } from "../../shared/row-labels.ts";

/**
 * What the sheet says about a value that is still being typed (design 17, 17b, 22).
 *
 * This is a PREVIEW of an unsaved draft, nothing more: saved points, the confirmation's "+N pts"
 * and every number on Today come from the server. The only server figure used is the value of one
 * opportunity (`points.perOpportunity`); the rule applied to the draft is the one the Mechanics
 * page states (0 below the minimum, value / ideal from it, capped at 1). All arithmetic is exact
 * BigInt over values scaled x100, never a float; `fill` and `before` are bar geometry only.
 */

export interface DailyDraft {
  /** Scaled x100. */
  readonly minimum: bigint;
  readonly ideal: bigint;
  /** Already logged in this opportunity, scaled x100. */
  readonly before: bigint;
  /** What the sheet would add, scaled x100. */
  readonly draft: bigint;
  readonly unit: string;
  /**
   * Points of one opportunity at 100 %, EXACT (BigInt strings from the engine); `null` when the server
   * gave none. Rounding the 2-decimal display value instead would round twice and disagree by a point.
   */
  readonly perOpportunityExact: { readonly numerator: string; readonly denominator: string } | null;
}

export interface DraftPreview {
  /** "20 / 30 min", "25 + 10 = 35 / 30 min" or "90 → 120 / 150 min". */
  readonly label: string;
  /** Points this draft adds; `null` when none are shown (weekly total, or no value from the server). */
  readonly gain: number | null;
  /** Whether the total reaches the minimum (the bar turns from neutral to gradient). */
  readonly reached: boolean;
  /** Bar geometry, 0..1: the total over the ideal. */
  readonly fill: number;
  /** Bar geometry, 0..1: what was already there (the weekly bar's second layer). */
  readonly before: number;
  readonly lines: readonly string[];
}

const HUNDRED = 100n;

const text = (scaled: bigint): string => formatDecimal(fromScaled(scaled));
const share = (value: bigint, ideal: bigint): number =>
  ideal === 0n ? 0 : Math.min(1, Number(value) / Number(ideal));

/** round-half-up of `numerator / denominator` for non-negative values. */
const roundDiv = (numerator: bigint, denominator: bigint): bigint =>
  (2n * numerator + denominator) / (2n * denominator);

const percentOf = (value: bigint, ideal: bigint): bigint =>
  ideal === 0n ? 0n : roundDiv(HUNDRED * (value < ideal ? value : ideal), ideal);

/** Whole points one opportunity pays for `total`: 0 below the minimum, then value / ideal, capped. */
function pointsAt(
  perOpportunity: { readonly numerator: bigint; readonly denominator: bigint },
  total: bigint,
  minimum: bigint,
  ideal: bigint,
): bigint {
  if (ideal === 0n || total < minimum) return 0n;
  const capped = total < ideal ? total : ideal;
  // (numerator / denominator) points x (capped / ideal) of the way: one rounding, half up.
  return roundDiv(perOpportunity.numerator * capped, perOpportunity.denominator * ideal);
}

export function dailyPreview(input: DailyDraft): DraftPreview {
  const { minimum, ideal, before, draft, unit } = input;
  const total = before + draft;
  const reached = total >= minimum;
  const label =
    before > 0n
      ? `${text(before)} + ${text(draft)} = ${text(total)} / ${text(ideal)} ${unit}`
      : `${text(total)} / ${text(ideal)} ${unit}`;
  const lines: string[] = [];
  if (!reached) {
    lines.push(
      `${text(minimum - total)} ${unit} más para el mínimo. Aún no cuenta para tu consistencia.`,
    );
  } else if (total < ideal) {
    lines.push(`Mínimo cumplido · ${percentOf(total, ideal)} % del ideal`);
  } else if (total === ideal) {
    lines.push("Ideal alcanzado · 100 %");
  } else {
    lines.push(`Ideal alcanzado. Por encima de ${text(ideal)} ${unit} no suma más puntos.`);
  }
  const exact = input.perOpportunityExact;
  const perOpportunity =
    exact === null
      ? null
      : { numerator: BigInt(exact.numerator), denominator: BigInt(exact.denominator) };
  const gain =
    perOpportunity === null
      ? null
      : Number(
          pointsAt(perOpportunity, total, minimum, ideal) -
            pointsAt(perOpportunity, before, minimum, ideal),
        );
  return {
    label,
    gain,
    reached,
    fill: share(total, ideal),
    before: share(before, ideal),
    lines,
  };
}

export type WeeklyDraft = Omit<DailyDraft, "perOpportunityExact">;

/** A weekly total shows progress only: the week's points are assigned when it closes (design 17b). */
export function weeklyPreview(input: WeeklyDraft): DraftPreview {
  const { minimum, ideal, before, draft, unit } = input;
  const total = before + draft;
  const reached = total >= minimum;
  const lines: string[] = [];
  if (!reached) {
    lines.push(`${text(minimum - total)} ${unit} más para el mínimo de la semana`);
  } else if (total < ideal) {
    lines.push(
      `${percentOf(total, ideal)} % del ideal semanal · te faltarían ${text(ideal - total)} ${unit}`,
    );
  } else {
    lines.push("Ideal semanal alcanzado");
  }
  return {
    label: `${text(before)} → ${text(total)} / ${text(ideal)} ${unit}`,
    gain: null,
    reached,
    fill: share(total, ideal),
    before: share(before, ideal),
    lines,
  };
}
