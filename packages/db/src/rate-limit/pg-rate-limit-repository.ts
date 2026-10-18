import type { Instant, RateLimitCounter, RateLimitRepository } from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

const iso = (at: number) => new Date(at).toISOString();

/** Primary-key order: `(action, subject, window_seconds, window_start)`. */
const byKey = (a: RateLimitCounter, b: RateLimitCounter) =>
  a.action.localeCompare(b.action) ||
  (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0) ||
  a.windowSeconds - b.windowSeconds ||
  a.windowStart - b.windowStart;

const keyOf = (subject: string, windowSeconds: number, windowStartMs: number) =>
  `${subject}|${windowSeconds}|${windowStartMs}`;

/**
 * Rate-limit counters over `pactjoy.rate_limit_counters` (ADR-0020). One instance per transaction
 * (see `bindRepositories`). A hit is ONE multi-row upsert, so concurrent attempts all count and
 * neither is a {@link ConcurrencyConflict}; its rows go in primary-key order, so two attempts lock
 * their shared counters in the same order and cannot deadlock.
 */
export function createPgRateLimitRepository(exec: SqlExecutor): RateLimitRepository {
  return {
    async hit(counters) {
      if (counters.length === 0) return [];
      const sorted = [...counters].sort(byKey);
      const { rows } = await exec.query<{
        subject: string;
        window_seconds: number;
        window_start_ms: string;
        hits: number;
      }>(
        `insert into pactjoy.rate_limit_counters
           (action, subject, window_start, window_seconds, expires_at, hits)
         select action, subject, window_start, window_seconds, expires_at, 1
           from unnest($1::text[], $2::text[], $3::timestamptz[], $4::integer[], $5::timestamptz[])
             with ordinality as t(action, subject, window_start, window_seconds, expires_at, n)
           order by n
         on conflict (action, subject, window_seconds, window_start)
           do update set hits = pactjoy.rate_limit_counters.hits + 1
         returning subject, window_seconds,
           (extract(epoch from window_start) * 1000)::bigint::text as window_start_ms, hits`,
        [
          sorted.map((c) => c.action),
          sorted.map((c) => c.subject),
          sorted.map((c) => iso(c.windowStart)),
          sorted.map((c) => c.windowSeconds),
          sorted.map((c) => iso(c.windowStart + c.windowSeconds * 1000)),
        ],
      );
      const hits = new Map(
        rows.map((row) => [
          keyOf(row.subject, row.window_seconds, Number(row.window_start_ms)),
          row.hits,
        ]),
      );
      return counters.map((c) => hits.get(keyOf(c.subject, c.windowSeconds, c.windowStart)) ?? 0);
    },

    async sweepExpired(now: Instant) {
      await exec.query("delete from pactjoy.rate_limit_counters where expires_at <= $1", [
        iso(now),
      ]);
    },

    async deleteBySubjects(subjects) {
      if (subjects.length === 0) return;
      await exec.query("delete from pactjoy.rate_limit_counters where subject = any($1::text[])", [
        subjects,
      ]);
    },
  };
}
