import type { MeasureInput, MeasureView } from "@pactjoy/app";
import type { Serialized } from "../../../ports/wire.ts";

/** Mirrors the engine's WEIGHT_STEP_PERCENT; the server still validates every pact. */
const WEIGHT_STEP = 5;

const validWeight = (weight: number): boolean =>
  Number.isInteger(weight) && weight >= 5 && weight <= 100 && weight % WEIGHT_STEP === 0;

export function changeWeight(weight: number, step: -5 | 5): number {
  if (!validWeight(weight)) {
    throw new RangeError("weight must be a multiple of 5 from 5 to 100");
  }
  return Math.min(100, Math.max(5, weight + step));
}

/** No habit cap: null says an equal split with minimum 5 is mathematically impossible. */
export function equalWeights(count: number): readonly number[] | null {
  if (!Number.isInteger(count) || count < 0 || count > 20) return null;
  if (count === 0) return [];
  const base = Math.floor(20 / count) * 5;
  const remainder = (100 - base * count) / 5;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 5 : 0));
}

export type WeightTone = "success" | "neutral";

export interface WeightSummary {
  readonly total: number;
  readonly canContinue: boolean;
  /** Design screen 11a copy; `tone` is the color the screen paints it with. */
  readonly message: string;
  readonly tone: WeightTone;
}

export function weightSummary(weights: readonly number[]): WeightSummary {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const allValid = weights.every(validWeight);
  const canContinue = weights.length > 0 && allValid && total === 100;
  let message: string;
  if (total > 100) message = `Te sobran ${total - 100} %`;
  else if (total < 100) message = `Te faltan ${100 - total} %`;
  else if (!allValid) message = "Cada peso va de 5 % a 100 %, en pasos de 5 %";
  else message = "Listo";
  return { total, canContinue, message, tone: canContinue ? "success" : "neutral" };
}

/** Converts a commitment's read model (or serialized wire format) back to the input shape required for editing. */
export function measureViewToInput(measure: Serialized<MeasureView> | MeasureView): MeasureInput {
  if (measure.unit === "done") {
    return {
      unit: "done",
      frequency: measure.schedule.frequency,
    };
  }
  if (measure.target.direction === "reach") {
    return {
      unit: measure.unit,
      customLabel: measure.customLabel,
      precision: measure.precision,
      direction: "reach",
      minimum: measure.target.minimum,
      ideal: measure.target.ideal,
      schedule: measure.schedule,
    };
  }
  return {
    unit: measure.unit,
    customLabel: measure.customLabel,
    precision: measure.precision,
    direction: "limit",
    ideal: measure.target.ideal,
    tolerance: measure.target.tolerance,
    schedule: measure.schedule,
  };
}
