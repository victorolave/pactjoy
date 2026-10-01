import type { Measure } from "@pactjoy/app";
import type { Fraction, QuantityUnit, Schedule, Weekday } from "@pactjoy/engine";
import { frac, fromInt } from "@pactjoy/engine";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeMeasure, encodeMeasure, MeasureCodecError } from "./measure-codec.ts";

const UNITS = "minutes hours times pages km glasses custom".split(" ") as QuantityUnit[];

const bigNum = fc.oneof(
  fc.bigInt({ min: 0n, max: 10n ** 12n }),
  fc.bigInt({ min: 2n ** 53n, max: 2n ** 80n }),
);
const positiveDen = fc.oneof(
  fc.bigInt({ min: 1n, max: 1000n }),
  fc.bigInt({ min: 2n ** 53n, max: 2n ** 70n }),
);
// Unreduced on purpose: frac() normalizes, so the arbitrary yields only valid Fractions.
const fraction: fc.Arbitrary<Fraction> = fc.tuple(bigNum, positiveDen).map(([n, d]) => frac(n, d));
const positiveFraction = fraction.filter((f) => f.num > 0n);

const lessOrEqual = (a: Fraction, b: Fraction) => a.num * b.den <= b.num * a.den;
const sorted = (a: Fraction, b: Fraction): [Fraction, Fraction] =>
  lessOrEqual(a, b) ? [a, b] : [b, a];

const weekday = fc.constantFrom<Weekday>(0, 1, 2, 3, 4, 5, 6);
const perSession = fc.oneof(
  fc.integer({ min: 1, max: 7 }).map((times) => ({
    period: "perSession" as const,
    frequency: { kind: "timesPerWeek" as const, times },
  })),
  fc.uniqueArray(weekday, { minLength: 1, maxLength: 7 }).map((weekdays) => ({
    period: "perSession" as const,
    frequency: { kind: "specificDays" as const, weekdays },
  })),
);
const schedule: fc.Arbitrary<Schedule> = fc.oneof(
  perSession,
  fc.constant({ period: "weeklyTotal" as const }),
);

const target = fc.oneof(
  fc.tuple(positiveFraction, positiveFraction).map(([a, b]) => {
    const [minimum, ideal] = sorted(a, b);
    return { direction: "reach" as const, minimum, ideal };
  }),
  fc.tuple(fraction, fraction).map(([a, b]) => {
    const [ideal, tolerance] = sorted(a, b);
    return { direction: "limit" as const, ideal, tolerance };
  }),
);

const doneMeasure: fc.Arbitrary<Measure> = perSession.map((s) => ({
  unit: "done" as const,
  schedule: s,
}));
const quantityMeasure: fc.Arbitrary<Measure> = fc
  .record({
    unit: fc.constantFrom(...UNITS),
    label: fc.string({ minLength: 1, maxLength: 20 }),
    precision: fc.constantFrom("integer" as const, "decimal" as const),
    target,
    schedule,
  })
  .map(({ unit, label, ...rest }) => ({
    unit,
    customLabel: unit === "custom" ? label : null,
    ...rest,
  }));
const measure = fc.oneof(doneMeasure, quantityMeasure);

const sample: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: frac(1n, 2n), ideal: fromInt(3) },
  schedule: { period: "weeklyTotal" },
};

// What jsonb does to the payload: text out, parsed back.
const viaJson = (m: Measure): unknown => JSON.parse(JSON.stringify(encodeMeasure(m)));

describe("measure codec round-trip", () => {
  it("decode(encode(m)) equals m for every valid Measure", () => {
    fc.assert(
      fc.property(measure, (m) => {
        expect(decodeMeasure(viaJson(m))).toEqual(m);
      }),
    );
  });

  it("keeps fractions beyond 2^53 exact", () => {
    const big = frac(2n ** 70n + 1n, 3n);
    const m: Measure = { ...sample, target: { direction: "reach", minimum: big, ideal: big } };
    expect(decodeMeasure(viaJson(m))).toEqual(m);
  });

  it("preserves precision, custom label and limit targets", () => {
    const m: Measure = {
      unit: "custom",
      customLabel: "cups",
      precision: "integer",
      target: { direction: "limit", ideal: fromInt(0), tolerance: fromInt(2) },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 6] } },
    };
    const back = decodeMeasure(viaJson(m));
    expect(back).toEqual(m);
    expect("precision" in back && back.precision).toBe("integer");
  });
});

describe("measure codec stored shape", () => {
  it("tags the version and writes fractions as decimal strings, never numbers", () => {
    const stored = viaJson(sample) as { v: number; target: unknown };
    expect(stored.v).toBe(1);
    expect(stored.target).toEqual({
      direction: "reach",
      minimum: { num: "1", den: "2" },
      ideal: { num: "3", den: "1" },
    });
  });
});

describe("measure codec corruption", () => {
  // Corrupt one dotted path of the stored sample; `undefined` removes the key.
  const bad = (path: string, value: unknown) => () => {
    const json = viaJson(sample) as Record<string, unknown>;
    const keys = path.split(".");
    const last = keys.pop() as string;
    // biome-ignore lint/suspicious/noExplicitAny: walking an arbitrary JSON shape on purpose
    const holder = keys.reduce<any>((o, k) => o[k], json);
    if (value === undefined) delete holder[last];
    else holder[last] = value;
    return decodeMeasure(json);
  };
  const doneWith = (frequency: unknown) => () =>
    decodeMeasure({ v: 1, unit: "done", schedule: { period: "perSession", frequency } });
  const throws = (fn: () => unknown) => expect(fn).toThrow(MeasureCodecError);

  it("throws on an unknown, missing or mistyped version, naming it", () => {
    for (const v of [2, undefined, "1"]) throws(bad("v", v));
    expect(bad("v", 9)).toThrow(/version/);
  });

  it("throws on non-object payloads", () => {
    for (const p of [null, 1, "x", [], undefined]) throws(() => decodeMeasure(p));
  });

  it("throws on an unknown unit, direction, period, frequency kind or precision", () => {
    throws(bad("unit", "miles"));
    throws(bad("target.direction", "up"));
    throws(bad("schedule.period", "daily"));
    throws(bad("precision", "float"));
    throws(doneWith({ kind: "monthly" }));
    expect(bad("unit", "miles")).toThrow(/unit/);
  });

  it("throws on bad weekdays and bad times", () => {
    for (const w of [[7], [-1], [1.5], "1"]) {
      throws(doneWith({ kind: "specificDays", weekdays: w }));
    }
    for (const t of [0, "3", 1.5]) throws(doneWith({ kind: "timesPerWeek", times: t }));
  });

  it("accepts structurally valid input the app bounds forbid, and ignores extra keys", () => {
    const m: Measure = {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 1] } },
    };
    expect(decodeMeasure(viaJson(m))).toEqual(m);
    expect(decodeMeasure({ ...(viaJson(m) as object), extra: 1 })).toEqual(m);
  });

  it("rejects a done payload with a weeklyTotal schedule", () => {
    throws(() => decodeMeasure({ v: 1, unit: "done", schedule: { period: "weeklyTotal" } }));
  });

  it("rejects fractions that are numbers, malformed, zero-denominator or not normalized", () => {
    for (const v of [
      { num: 1, den: 2 },
      { num: "1.5", den: "2" },
      { num: "1", den: "0" },
      { num: "2", den: "4" },
      { num: "1", den: "-2" },
      "1/2",
    ]) {
      throws(bad("target.minimum", v));
    }
    throws(bad("target.ideal", undefined));
  });

  it("rejects a bad custom label", () => {
    throws(bad("customLabel", 5));
    throws(bad("customLabel", undefined));
  });
});
