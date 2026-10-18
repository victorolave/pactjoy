import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { UserId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { RateLimitCounter } from "./rate-limit.repository.ts";

/**
 * How many join attempts (`POST /circles/join/preview` and `POST /circles/join` together) fit in
 * each fixed window (ADR-0020). Per user they keep a 31^6 code space out of reach; per network
 * they slow down someone rotating accounts, looser because people can share an address.
 */
export const JOIN_ATTEMPT_LIMITS = [
  { per: "user", windowSeconds: 60, limit: 10 },
  { per: "user", windowSeconds: 3600, limit: 30 },
  { per: "network", windowSeconds: 60, limit: 30 },
  { per: "network", windowSeconds: 3600, limit: 100 },
] as const;

export interface JoinAttemptInput {
  /**
   * The client network as an opaque keyed hash (the API never passes the address itself), or
   * `null` when it is unknown: then only the user limits apply.
   */
  readonly networkKey: string | null;
}

export type JoinAttemptError = {
  readonly kind: "TooManyJoinAttempts";
  /** Whole seconds until every window this attempt exceeded has ended (at least 1). */
  readonly retryAfterSeconds: number;
};

export interface AdmitJoinAttemptDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
}

/** The `user:` subject of a user's counters; account erasure deletes them by it. */
export const userSubject = (user: UserId): string => `user:${user}`;

const subjectOf = (per: "user" | "network", actor: Actor, networkKey: string) =>
  per === "user" ? userSubject(actor.userId) : `network:${networkKey}`;

/**
 * Counts one join attempt and says whether it may go on (ADR-0020, REQ-RL1..RL4). Every attempt
 * counts, refused ones too, and the count commits on its own transaction before the join or
 * preview runs, so a failed attempt is never rolled back with it. It never looks at the code:
 * a refusal is the same whether or not the code exists. Ended windows are swept on the way.
 */
export async function admitJoinAttempt(
  deps: AdmitJoinAttemptDeps,
  actor: Actor,
  input: JoinAttemptInput,
): Promise<Result<void, JoinAttemptError>> {
  const now = deps.clock.now();
  const rules = JOIN_ATTEMPT_LIMITS.filter(
    (rule) => rule.per === "user" || input.networkKey !== null,
  );
  const counters: RateLimitCounter[] = rules.map((rule) => {
    const size = rule.windowSeconds * 1000;
    return {
      action: "joinCircle",
      subject: subjectOf(rule.per, actor, input.networkKey ?? ""),
      windowStart: instant(now - (now % size)),
      windowSeconds: rule.windowSeconds,
    };
  });

  const counted = await deps.uow.transaction(async ({ rateLimits }) => {
    await rateLimits.sweepExpired(now);
    return ok(await rateLimits.hit(counters));
  });
  if (!counted.ok) return counted;

  const waits = rules.flatMap((rule, i) => {
    const counter = counters[i] as RateLimitCounter;
    return (counted.value[i] ?? 0) > rule.limit ? [secondsUntilEnd(counter, now)] : [];
  });
  if (waits.length === 0) return ok(undefined);
  return err({
    kind: "TooManyJoinAttempts",
    retryAfterSeconds: waits.reduce((a, b) => (a > b ? a : b)),
  });
}

/** Rounded up, so a client that waits exactly this long finds the window over. */
function secondsUntilEnd(counter: RateLimitCounter, now: Instant): number {
  const left = counter.windowStart + counter.windowSeconds * 1000 - now;
  const whole = (left - (left % 1000)) / 1000;
  return left % 1000 === 0 ? whole : whole + 1;
}
