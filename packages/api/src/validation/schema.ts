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

export const literal = <const L extends string>(expected: L): Schema<L> =>
  schema((v, path, sink) => (v === expected ? expected : fail(sink, path, "enum")));

export const oneOf = <const L extends string>(allowed: readonly L[]): Schema<L> =>
  schema((v, path, sink) =>
    typeof v === "string" && (allowed as readonly string[]).includes(v)
      ? (v as L)
      : fail(sink, path, "enum"),
  );

/** The field may be absent; when absent it is OMITTED from the output (exactOptionalPropertyTypes). */
export const optional = <T>(inner: Schema<T>): OptionalSchema<T> => ({
  check: inner.check,
  optional: true,
});

export const nullable = <T>(inner: Schema<T>): Schema<T | null> =>
  schema((v, path, sink) => (v === null ? null : inner.check(v, path, sink)));

export const array = <T>(item: Schema<T>, maxItems: number): Schema<T[]> =>
  schema((v, path, sink) => {
    if (!Array.isArray(v)) return fail(sink, path, "type");
    if (v.length > maxItems) return fail(sink, path, "range");
    const out: T[] = [];
    let bad = false;
    v.forEach((element, i) => {
      const r = item.check(element, join(path, i), sink);
      if (r === INVALID) bad = true;
      else out.push(r);
    });
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

/** Runs a schema. `undefined` (an empty body) is read as `{}` at the root. */
export function parse<T>(root: Schema<T>, input: unknown): Parsed<T> {
  const sink: Sink = [];
  const value = root.check(input === undefined ? {} : input, "", sink);
  return value === INVALID ? { ok: false, issues: sink } : { ok: true, value };
}
