import type { AddCommitmentCommand } from "../../../ports/pactjoy-api.ts";

export type WizardMeasure = AddCommitmentCommand["measure"];
export type QuantityUnit = Exclude<WizardMeasure["unit"], "done">;
export type Frequency = Extract<WizardMeasure, { unit: "done" }>["frequency"];

export const UNIT_STEPS: Record<QuantityUnit, bigint> = {
  minutes: 500n,
  hours: 100n,
  times: 100n,
  pages: 500n,
  km: 100n,
  glasses: 100n,
  custom: 100n,
};

// Screen 9 proposes these quantities; scoring and validation remain server-owned.
const REACH: Record<QuantityUnit, readonly [string, string, string, string]> = {
  minutes: ["10", "30", "60", "150"],
  hours: ["1", "2", "3", "6"],
  times: ["1", "3", "3", "6"],
  pages: ["10", "30", "60", "150"],
  km: ["2", "5", "8", "15"],
  glasses: ["6", "8", "40", "56"],
  custom: ["1", "3", "3", "6"],
};
const LIMIT: Record<QuantityUnit, readonly [string, string]> = {
  minutes: ["30", "60"],
  hours: ["1", "2"],
  pages: ["10", "20"],
  km: ["2", "4"],
  glasses: ["2", "4"],
  times: ["2", "4"],
  custom: ["2", "4"],
};

export function defaultMeasure(
  unit: WizardMeasure["unit"],
  direction: "reach" | "limit" = "reach",
  period: "perSession" | "weeklyTotal" = "perSession",
  frequency: Frequency = { kind: "timesPerWeek", times: 5 },
): WizardMeasure {
  if (unit === "done") return { unit, frequency };
  const schedule =
    period === "weeklyTotal"
      ? { period }
      : {
          period,
          frequency:
            direction === "limit" ? { kind: "timesPerWeek" as const, times: 7 } : frequency,
        };
  if (direction === "limit") {
    const [ideal, tolerance] = LIMIT[unit];
    return { unit, direction, ideal, tolerance, schedule };
  }
  const [minimum, ideal, weeklyMinimum, weeklyIdeal] = REACH[unit];
  return {
    unit,
    direction,
    minimum: period === "weeklyTotal" ? weeklyMinimum : minimum,
    ideal: period === "weeklyTotal" ? weeklyIdeal : ideal,
    schedule,
  };
}
