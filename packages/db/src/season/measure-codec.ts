import type { Measure, QuantityPrecision } from "@pactjoy/app";
import type {
  Fraction,
  PerSessionSchedule,
  QuantityUnit,
  Schedule,
  Target,
  Weekday,
} from "@pactjoy/engine";
import { frac } from "@pactjoy/engine";

/**
 * Versioned jsonb codec for a commitment `Measure` (SP-R5). Pure: no driver, no Node.
 *
 * Stored shape, version 1:
 * - done:     `{ v: 1, unit: "done", schedule }`
 * - quantity: `{ v: 1, unit, customLabel, precision, target, schedule }`
 * - fractions are `{ num: "<int>", den: "<int>" }` decimal STRINGS, never JSON numbers
 *   (a number loses precision beyond 2^53, ADR-0004).
 *
 * Decoding rebuilds every fraction through the engine's `frac`, so the result is
 * branded. A stored fraction that is not already normalized is corruption.
 */
export const MEASURE_CODEC_VERSION = 1;

/** The stored payload is corrupt or from a version this code does not know. */
export class MeasureCodecError extends Error {
  override readonly name = "MeasureCodecError";
}

const QUANTITY_UNITS: readonly QuantityUnit[] = [
  "minutes",
  "hours",
  "times",
  "pages",
  "km",
  "glasses",
  "custom",
];
const PRECISIONS: readonly QuantityPrecision[] = ["integer", "decimal"];
const INTEGER = /^-?\d+$/;

type Json = Record<string, unknown>;

export function encodeMeasure(measure: Measure): unknown {
  if (measure.unit === "done") {
    return { v: MEASURE_CODEC_VERSION, unit: "done", schedule: encodeSchedule(measure.schedule) };
  }
  return {
    v: MEASURE_CODEC_VERSION,
    unit: measure.unit,
    customLabel: measure.customLabel,
    precision: measure.precision,
    target: encodeTarget(measure.target),
    schedule: encodeSchedule(measure.schedule),
  };
}

/** @throws {MeasureCodecError} on a corrupt payload, an unknown version or an unknown variant. */
export function decodeMeasure(payload: unknown): Measure {
  const json = asObject(payload, "measure");
  if (json.v !== MEASURE_CODEC_VERSION) {
    throw new MeasureCodecError(`measure: unsupported version ${JSON.stringify(json.v)}`);
  }
  if (json.unit === "done") {
    const schedule = decodeSchedule(json.schedule);
    if (schedule.period !== "perSession") {
      throw new MeasureCodecError("measure: done requires a perSession schedule");
    }
    return { unit: "done", schedule };
  }
  const unit = oneOf(json.unit, QUANTITY_UNITS, "unit");
  const precision = oneOf(json.precision, PRECISIONS, "precision");
  if (json.customLabel !== null && typeof json.customLabel !== "string") {
    throw new MeasureCodecError("measure: customLabel must be a string or null");
  }
  return {
    unit,
    customLabel: json.customLabel,
    precision,
    target: decodeTarget(json.target),
    schedule: decodeSchedule(json.schedule),
  };
}

function encodeFraction(f: Fraction): Json {
  return { num: f.num.toString(), den: f.den.toString() };
}

function encodeTarget(t: Target): Json {
  return t.direction === "reach"
    ? {
        direction: "reach",
        minimum: encodeFraction(t.minimum),
        ideal: encodeFraction(t.ideal),
      }
    : {
        direction: "limit",
        ideal: encodeFraction(t.ideal),
        tolerance: encodeFraction(t.tolerance),
      };
}

function encodeSchedule(s: Schedule): Json {
  if (s.period === "weeklyTotal") return { period: "weeklyTotal" };
  const f = s.frequency;
  return {
    period: "perSession",
    frequency:
      f.kind === "timesPerWeek"
        ? { kind: "timesPerWeek", times: f.times }
        : { kind: "specificDays", weekdays: [...f.weekdays] },
  };
}

function decodeFraction(value: unknown, what: string): Fraction {
  const json = asObject(value, what);
  const { num, den } = json;
  if (
    typeof num !== "string" ||
    typeof den !== "string" ||
    !INTEGER.test(num) ||
    !INTEGER.test(den)
  ) {
    throw new MeasureCodecError(`measure: ${what} must be { num, den } integer strings`);
  }
  if (BigInt(den) <= 0n) throw new MeasureCodecError(`measure: ${what} denominator must be > 0`);
  const fraction = frac(BigInt(num), BigInt(den));
  if (fraction.num.toString() !== num || fraction.den.toString() !== den) {
    throw new MeasureCodecError(`measure: ${what} is not a normalized fraction`);
  }
  return fraction;
}

function decodeTarget(value: unknown): Target {
  const json = asObject(value, "target");
  switch (json.direction) {
    case "reach":
      return {
        direction: "reach",
        minimum: decodeFraction(json.minimum, "target.minimum"),
        ideal: decodeFraction(json.ideal, "target.ideal"),
      };
    case "limit":
      return {
        direction: "limit",
        ideal: decodeFraction(json.ideal, "target.ideal"),
        tolerance: decodeFraction(json.tolerance, "target.tolerance"),
      };
    default:
      throw new MeasureCodecError(
        `measure: unknown target direction ${JSON.stringify(json.direction)}`,
      );
  }
}

function decodeSchedule(value: unknown): Schedule {
  const json = asObject(value, "schedule");
  if (json.period === "weeklyTotal") return { period: "weeklyTotal" };
  if (json.period !== "perSession") {
    throw new MeasureCodecError(`measure: unknown schedule period ${JSON.stringify(json.period)}`);
  }
  const f = asObject(json.frequency, "schedule.frequency");
  const schedule = (frequency: PerSessionSchedule["frequency"]): PerSessionSchedule => ({
    period: "perSession",
    frequency,
  });
  if (f.kind === "timesPerWeek") {
    const times = f.times;
    if (typeof times !== "number" || !Number.isSafeInteger(times) || times < 1) {
      throw new MeasureCodecError("measure: schedule.frequency.times must be a positive integer");
    }
    return schedule({ kind: "timesPerWeek", times });
  }
  if (f.kind === "specificDays") {
    const days = f.weekdays;
    if (!Array.isArray(days) || !days.every(isWeekday) || new Set(days).size !== days.length) {
      throw new MeasureCodecError(
        "measure: schedule.frequency.weekdays must be unique 0-6 integers",
      );
    }
    return schedule({ kind: "specificDays", weekdays: days });
  }
  throw new MeasureCodecError(`measure: unknown frequency kind ${JSON.stringify(f.kind)}`);
}

function isWeekday(n: unknown): n is Weekday {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;
}

function asObject(value: unknown, what: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MeasureCodecError(`measure: ${what} must be an object`);
  }
  return value as Json;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find((a) => a === value);
  if (found === undefined) {
    throw new MeasureCodecError(`measure: unknown ${what} ${JSON.stringify(value)}`);
  }
  return found;
}
