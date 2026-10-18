import type { Instant, RateLimitRepository } from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

const iso = (at: number) => new Date(at).toISOString();

/**
 * Rate-limit counters over `pactjoy.rate_limit_counters` (ADR-0020). One instance per transaction
 * (see `bindRepositories`). A hit is one atomic upsert, so two concurrent attempts both count and
 * neither is a {@link ConcurrencyConflict}.
 */
export function createPgRateLimitRepository(exec: SqlExecutor): RateLimitRepository {
  return {
    async hit(counters) {
      const counts: number[] = [];
      for (const counter of counters) {
        const { rows } = await exec.query<{ hits: number }>(
          `insert into pactjoy.rate_limit_counters
             (action, subject, window_start, window_seconds, expires_at, hits)
           values ($1, $2, $3, $4, $5, 1)
           on conflict (action, subject, window_seconds, window_start)
             do update set hits = pactjoy.rate_limit_counters.hits + 1
           returning hits`,
          [
            counter.action,
            counter.subject,
            iso(counter.windowStart),
            counter.windowSeconds,
            iso(counter.windowStart + counter.windowSeconds * 1000),
          ],
        );
        counts.push(rows[0]?.hits ?? 0);
      }
      return counts;
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
