import type { MeasureView } from "@pactjoy/app";
import { addScaled, fromScaled, roundToMultiple, toScaled } from "../../shared/decimal.ts";

type Quantity = Exclude<MeasureView, { unit: "done" }>;
export type ReachQuantity = Quantity & {
  readonly target: Extract<Quantity["target"], { direction: "reach" }>;
};

/** The measure when it is a reach quantity (the stepper sheet); null for done and limit. */
export function quantityMeasureOf(measure: MeasureView): ReachQuantity | null {
  if (measure.unit === "done" || measure.target.direction !== "reach") return null;
  return measure as ReachQuantity;
}

export type LimitQuantity = Quantity & {
  readonly target: Extract<Quantity["target"], { direction: "limit" }>;
};

/** The measure when it is a limit quantity (the grid sheet); null for done and reach. */
export function limitMeasureOf(measure: MeasureView): LimitQuantity | null {
  if (measure.unit === "done" || measure.target.direction !== "limit") return null;
  return measure as LimitQuantity;
}

const STEP_BY_UNIT: Partial<Record<Quantity["unit"], string>> = {
  minutes: "5",
  pages: "5",
};

/** How far one press of + or - moves the value. Exact, as a decimal string. */
export function stepFor(measure: Quantity): string {
  const byUnit = STEP_BY_UNIT[measure.unit];
  if (byUnit !== undefined) return byUnit;
  const halves =
    (measure.unit === "hours" || measure.unit === "km") && measure.precision === "decimal";
  return halves ? "0.5" : "1";
}

const stepScaled = (measure: Quantity): bigint => toScaled(stepFor(measure)) ?? 100n;

const unique = (values: readonly bigint[]): bigint[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Shortcuts under the stepper. Per session: minimum, midpoint, ideal (design: 10, 20, 30). Weekly
 * total: 10 %, 20 % and 30 % of the ideal (design: 15, 30, 45). Always positive and distinct.
 */
export function presetsFor(measure: ReachQuantity): string[] {
  const step = stepScaled(measure);
  const ideal = toScaled(measure.target.ideal) ?? 0n;
  const snap = (value: bigint): bigint => {
    const rounded = roundToMultiple(value, step);
    return rounded < step ? step : rounded;
  };
  if (measure.schedule.period === "weeklyTotal") {
    return unique([10n, 20n, 30n].map((percent) => snap((ideal * percent) / 100n))).map(fromScaled);
  }
  const minimum = toScaled(measure.target.minimum) ?? 0n;
  return unique([minimum, snap((minimum + ideal) / 2n), ideal]).map(fromScaled);
}

/** Where the stepper starts: the middle shortcut (design: 20 min, or 30 for the weekly total). */
export function initialValue(measure: ReachQuantity): string {
  const presets = presetsFor(measure);
  return presets[1] ?? presets[0] ?? "0";
}

/** One + or - press on whatever is typed. Unreadable text counts as zero. */
export function nudge(raw: string, direction: 1 | -1, measure: Quantity): string {
  const current = toScaled(raw) ?? 0n;
  return fromScaled(addScaled(current, stepScaled(measure) * BigInt(direction)));
}

/**
 * The decimal string to send, or null when the text cannot be sent: unreadable, more places than the
 * precision allows (integer takes none, decimal two), or zero unless `allowZero` (a limit's 0).
 */
export function toSubmitValue(
  raw: string,
  precision: Quantity["precision"],
  { allowZero = false }: { readonly allowZero?: boolean } = {},
): string | null {
  const scaled = toScaled(raw);
  if (scaled === null) return null;
  if (precision === "integer" && scaled % 100n !== 0n) return null;
  if (scaled === 0n && !allowZero) return null;
  return fromScaled(scaled);
}

export function isSubmittable(raw: string, precision: Quantity["precision"]): boolean {
  return toSubmitValue(raw, precision) !== null;
}
