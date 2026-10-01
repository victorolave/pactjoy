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

/** Internal client: transactions at a chosen isolation, plus shutdown. */
export interface Client {
  begin<T>(isolation: string, work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export interface ClientOptions {
  url: string;
  max?: number;
}

// Parse-only: values are serialized in the mappers (`$n::timestamptz` etc.),
// so `serialize` stays the identity for the strings we send.
const identity = (value: unknown) => String(value);

/**
 * Driver options. `prepare: false` because transaction poolers (Supavisor
 * 6543) cannot keep prepared statements (DC-R2). The `types` replace the
 * driver's lossy defaults: timestamptz -> epoch ms, date -> raw string,
 * int8 -> bigint.
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
    begin: (isolation, work) =>
      sql.begin(isolation, (tx) => work(executorOver(tx))) as Promise<never>,
    end: () => sql.end(),
  };
}
