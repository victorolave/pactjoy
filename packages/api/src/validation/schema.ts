/** One validation failure. `path` is dot-separated (`""` for the root), `problem` a stable code. */
export interface Issue {
  readonly path: string;
  readonly problem: "type" | "required" | "unknownField" | "enum" | "format" | "range";
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] };

export const MAX_ISSUES = 10;

const INVALID = Symbol("invalid");
type Invalid = typeof INVALID;

type Sink = Issue[];
type Check<T> = (input: unknown, path: string, sink: Sink) => T | Invalid;

export interface Schema<T> {
  readonly check: Check<T>;
  readonly optional?: true;
}
interface OptionalSchema<T> extends Schema<T> {
  readonly optional: true;
}

/** Records an issue (capped) and returns the invalid marker. Formats use it too. */
export const fail = (sink: Sink, path: string, problem: Issue["problem"]): Invalid => {
  if (sink.length < MAX_ISSUES) sink.push({ path, problem });
  return INVALID;
};
const join = (path: string, key: string | number) => (path === "" ? String(key) : `${path}.${key}`);

/** Builds a schema from a check; the formats in `formats.ts` use it. */
export const schema = <T>(check: Check<T>): Schema<T> => ({ check });

export const string: Schema<string> = schema((v, path, sink) =>
  typeof v === "string" ? v : fail(sink, path, "type"),
);

export const number: Schema<number> = schema((v, path, sink) =>
  typeof v === "number" && Number.isFinite(v) ? v : fail(sink, path, "type"),
);

/** A safe integer at or above `min`: a non-integer or non-number is `type`, a smaller integer is `range`. */
export const integer = (options: { readonly min: number }): Schema<number> =>
  schema((v, path, sink) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return fail(sink, path, "type");
    return v >= options.min ? v : fail(sink, path, "range");
  });

export const literal = <const L extends string>(expected: L): Schema<L> =>
  schema((v, path, sink) => (v === expected ? expected : fail(sink, path, "enum")));

export const oneOf = <const L extends string>(allowed: readonly L[]): Schema<L> =>
  schema((v, path, sink) =>
    typeof v === "string" && (allowed as readonly string[]).includes(v)
      ? (v as L)
      : fail(sink, path, "enum"),
  );

/** Picks the variant by the string at `key`; an absent/unknown tag is an `enum` issue at that key. */
export const tagged = <T>(key: string, variants: Record<string, Schema<unknown>>): Schema<T> =>
  schema((v, path, sink) => {
    const at = path === "" ? key : `${path}.${key}`;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(sink, path, "type");
    const tag = Object.hasOwn(v, key) ? (v as Record<string, unknown>)[key] : undefined;
    const variant = typeof tag === "string" && Object.hasOwn(variants, tag) ? variants[tag] : null;
    if (!variant) return fail(sink, at, tag === undefined ? "required" : "enum");
    return variant.check(v, path, sink) as T;
  });

/** The field may be absent; when absent it is OMITTED from the output (exactOptionalPropertyTypes). */
export const optional = <T>(inner: Schema<T>): OptionalSchema<T> => ({
  check: inner.check,
  optional: true,
});

/** `null` is accepted; the optional flag of `inner` is preserved (`nullable(optional(x))` may be absent). */
export function nullable<T>(inner: OptionalSchema<T>): OptionalSchema<T | null>;
export function nullable<T>(inner: Schema<T>): Schema<T | null>;
export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  const check: Check<T | null> = (v, path, sink) =>
    v === null ? null : inner.check(v, path, sink);
  return inner.optional ? { check, optional: true } : { check };
}

export const array = <T>(item: Schema<T>, maxItems: number): Schema<T[]> =>
  schema((v, path, sink) => {
    if (!Array.isArray(v)) return fail(sink, path, "type");
    if (v.length > maxItems) return fail(sink, path, "range");
    const out: T[] = [];
    let bad = false;
    // Total loop (not forEach): a sparse array's holes are visited as `undefined`.
    for (let i = 0; i < v.length; i++) {
      const r = item.check(v[i], join(path, i), sink);
      if (r === INVALID) bad = true;
      else out.push(r);
    }
    return bad ? INVALID : out;
  });

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never;
}[keyof S];
type Infer<S> = S extends Schema<infer T> ? T : never;
type Flatten<T> = { [K in keyof T]: T[K] };
type ObjectOf<S extends Shape> = Flatten<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Infer<S[K]>;
  }
>;

/** Strict object: builds a NEW object from the declared keys only; any other own key is `unknownField`. */
export const object = <S extends Shape>(shape: S): Schema<ObjectOf<S>> =>
  schema((v, path, sink) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(sink, path, "type");
    const out: Record<string, unknown> = {};
    let bad = false;
    for (const key of Object.keys(shape)) {
      const field = shape[key] as Schema<unknown>;
      if (!Object.hasOwn(v, key)) {
        if (!field.optional) bad = fail(sink, join(path, key), "required") === INVALID;
        continue;
      }
      const r = field.check((v as Record<string, unknown>)[key], join(path, key), sink);
      if (r === INVALID) bad = true;
      else out[key] = r;
    }
    for (const key of Object.keys(v)) {
      if (!Object.hasOwn(shape, key)) bad = fail(sink, join(path, key), "unknownField") === INVALID;
    }
    return bad ? INVALID : (out as ObjectOf<S>);
  });

export interface ParseOptions {
  /** Reads an `undefined` root (no body) as `{}`. Opt-in: only routes whose body may be omitted use it. */
  readonly emptyBody?: "object";
}

/**
 * Runs a schema. By default an `undefined` root (no body) is a `required` issue at path `""`, so a
 * route with required fields never sees a missing body as valid. Route slices whose body is entirely
 * optional pass `{ emptyBody: "object" }` explicitly; do not make it the default.
 */
export function parse<T>(root: Schema<T>, input: unknown, options: ParseOptions = {}): Parsed<T> {
  const sink: Sink = [];
  if (input === undefined && options.emptyBody !== "object") {
    fail(sink, "", "required");
    return { ok: false, issues: sink };
  }
  const value = root.check(input === undefined ? {} : input, "", sink);
  return value === INVALID ? { ok: false, issues: sink } : { ok: true, value };
}
