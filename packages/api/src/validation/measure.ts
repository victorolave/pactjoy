import type { MeasureInput } from "@pactjoy/app";
import type { Frequency, Schedule } from "@pactjoy/engine";
import {
  array,
  fail,
  literal,
  nullable,
  number,
  object,
  oneOf,
  optional,
  type Schema,
  schema,
  string,
} from "./schema.ts";

/**
 * Structure only (RV-R4): the app owns every threshold/range/label rule. Thresholds are strings
 * so decimals stay exact (a JSON number is a type issue, D10). Types the app re-checks at
 * runtime (weekday range, precision, times) are narrowed by cast, as in the season routes.
 */

/** Picks the variant by the string at `key`; an absent/unknown tag is an `enum` issue at that key. */
const tagged = <T>(key: string, variants: Record<string, Schema<unknown>>): Schema<T> =>
  schema((v, path, sink) => {
    const at = path === "" ? key : `${path}.${key}`;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(sink, path, "type");
    const tag = Object.hasOwn(v, key) ? (v as Record<string, unknown>)[key] : undefined;
    const variant = typeof tag === "string" && Object.hasOwn(variants, tag) ? variants[tag] : null;
    if (!variant) return fail(sink, at, tag === undefined ? "required" : "enum");
    return variant.check(v, path, sink) as T;
  });

const frequency = tagged<Frequency>("kind", {
  timesPerWeek: object({ kind: literal("timesPerWeek"), times: number }),
  // 16 > 7 on purpose: duplicates and out-of-range weekdays are the app's rules, not a size limit.
  specificDays: object({ kind: literal("specificDays"), weekdays: array(number, 16) }),
});

const schedule = tagged<Schedule>("period", {
  perSession: object({ period: literal("perSession"), frequency }),
  weeklyTotal: object({ period: literal("weeklyTotal") }),
});

const unit = oneOf(["minutes", "hours", "times", "pages", "km", "glasses", "custom"]);
const quantity = {
  unit,
  customLabel: nullable(optional(string)),
  precision: optional(string),
  schedule,
};

const doneMeasure = object({ unit: literal("done"), frequency });
const reachMeasure = object({
  ...quantity,
  direction: literal("reach"),
  minimum: string,
  ideal: string,
});
const limitMeasure = object({
  ...quantity,
  direction: literal("limit"),
  ideal: string,
  tolerance: string,
});
const quantityMeasure = tagged<unknown>("direction", { reach: reachMeasure, limit: limitMeasure });

/** `unit: "done"` carries only a frequency; every other unit picks reach/limit by `direction`. */
export const measureInput: Schema<MeasureInput> = schema((v, path, sink) => {
  const done =
    typeof v === "object" && v !== null && (v as Record<string, unknown>).unit === "done";
  return (done ? doneMeasure : quantityMeasure).check(v, path, sink) as MeasureInput;
});
