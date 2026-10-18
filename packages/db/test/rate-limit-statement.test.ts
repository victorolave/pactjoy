import { instant, type RateLimitCounter } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import type { SqlExecutor } from "../src/client.ts";
import { createPgRateLimitRepository } from "../src/rate-limit/pg-rate-limit-repository.ts";

/**
 * `hit` is ONE statement whatever the number of counters (PR #312 review S1): one round trip, and
 * the rows go in primary-key order, so two concurrent attempts lock their counters in the same
 * order and cannot deadlock. The real upsert is covered by the Postgres contract suite.
 */
const T0 = 1_792_490_400_000;
const counter = (subject: string, windowSeconds: number): RateLimitCounter => ({
  action: "joinCircle",
  subject,
  windowStart: instant(T0),
  windowSeconds,
});

function recording() {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const exec: SqlExecutor = {
    async query<Row>(text: string, params: readonly unknown[]) {
      queries.push({ text, params });
      // What Postgres would return: one row per counter, in no particular order.
      const subjects = (params[1] as string[]) ?? [];
      const seconds = (params[3] as number[]) ?? [];
      const rows = subjects
        .map((subject, i) => ({
          subject,
          window_seconds: seconds[i],
          window_start_ms: String(T0),
          hits: 10 + i,
        }))
        .reverse();
      return { rows: rows as Row[], rowCount: rows.length };
    },
  };
  return { exec, queries };
}

describe("PgRateLimitRepository.hit", () => {
  it("sends one statement with the counters in primary-key order, and answers in the order given", async () => {
    const { exec, queries } = recording();
    const counts = await createPgRateLimitRepository(exec).hit([
      counter("user:b", 60),
      counter("network:z", 3600),
      counter("user:b", 3600),
      counter("network:z", 60),
    ]);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.params[1]).toEqual(["network:z", "network:z", "user:b", "user:b"]);
    expect(queries[0]?.params[3]).toEqual([60, 3600, 60, 3600]);
    // Sorted position -> hits 10..13; mapped back to the caller's order.
    expect(counts).toEqual([12, 11, 13, 10]);
  });

  it("sends nothing for no counters", async () => {
    const { exec, queries } = recording();
    expect(await createPgRateLimitRepository(exec).hit([])).toEqual([]);
    expect(queries).toEqual([]);
  });
});
