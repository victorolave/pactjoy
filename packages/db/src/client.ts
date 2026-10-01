import postgres from "postgres";
import { parseInt8 } from "./codecs/bigint.ts";
import { parseDate, parseTimestamptz } from "./codecs/time.ts";

/**
 * The only seam repositories see: parameterized SQL text (`$1`) in, plain rows
 * out. No driver type crosses it, so replacing postgres.js touches this file
 * and the unit of work only (design section 12).
 */
export interface SqlExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
}

/** `write` inside `transaction`, `read` inside `read`: a guard is a no-op in the latter (the port says so). */
export type BindMode = "write" | "read";

/**
 * The only isolation levels the adapter uses: writes at READ COMMITTED, reads
 * as a single REPEATABLE READ snapshot. A closed union, because the value is
 * concatenated into `begin <isolation>` and must never be caller-controlled.
 */
export const ISOLATIONS = [
  "isolation level read committed",
  "isolation level repeatable read read only",
] as const;
export type Isolation = (typeof ISOLATIONS)[number];

/** Internal client: transactions at a chosen isolation, plus shutdown. */
export interface Client {
  begin<T>(isolation: Isolation, work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export interface ClientOptions {
  url: string;
  max?: number;
}

// Parse-only. Every value is bound as a string with an explicit cast
// (`$n::timestamptz`, `$n::date`, `$n::int8`) by the mappers, so `serialize`
// stays the identity and the driver never infers a type for a parameter.
const identity = (value: unknown) => String(value);

/**
 * Driver options. `prepare: false` because transaction poolers (Supavisor
 * 6543) cannot keep prepared statements (DC-R2). The `types` replace the
 * driver's lossy defaults: timestamptz -> epoch ms, date -> raw string,
 * int8 -> bigint. `timestamp` (no time zone, OID 1114) is registered with a
 * parser that throws: we store only timestamptz, so a future `timestamp`
 * column must fail loudly rather than be read in the process time zone.
 */
export function clientOptions({ max }: { max?: number | undefined }) {
  return {
    ...(max === undefined ? {} : { max }),
    prepare: false,
    onnotice: (): void => {},
    types: {
      timestamptz: {
        to: 1184,
        from: [1184] as number[],
        serialize: identity,
        parse: parseTimestamptz,
      },
      date: { to: 1082, from: [1082] as number[], serialize: identity, parse: parseDate },
      timestamp: {
        to: 1114,
        from: [1114] as number[],
        serialize: identity,
        parse: (text: string): never => {
          throw new Error(`timestamp without time zone is not supported: ${text}`);
        },
      },
      int8: { to: 20, from: [20] as number[], serialize: identity, parse: parseInt8 },
    },
  };
}

type Unsafe = (
  text: string,
  params: never[],
) => PromiseLike<ArrayLike<unknown> & { count: number }>;

/** Adapts anything with `unsafe(text, params)` (a postgres.js transaction) to the seam. */
export function executorOver(tx: { unsafe: Unsafe }): SqlExecutor {
  return {
    async query<Row>(text: string, params: readonly unknown[]) {
      const result = await tx.unsafe(text, params as never[]);
      return { rows: Array.from(result) as Row[], rowCount: result.count };
    },
  };
}

export function createClient({ url, max }: ClientOptions): Client {
  const sql = postgres(url, clientOptions({ max }));
  return {
    begin: async <T>(isolation: Isolation, work: (tx: SqlExecutor) => Promise<T>) => {
      if (!ISOLATIONS.includes(isolation)) {
        throw new Error(`Unsupported isolation level: ${JSON.stringify(isolation)}`);
      }
      return (await sql.begin(isolation, (tx) => work(executorOver(tx)))) as T;
    },
    end: () => sql.end(),
  };
}
