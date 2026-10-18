import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { instant } from "../time/instant.ts";
import { admitJoinAttempt, JOIN_ATTEMPT_LIMITS } from "./join-attempts.ts";

/**
 * Join attempts (ADR-0020, REQ-RL1..RL4): every preview or join counts against the user and, when
 * the API could key it, the client network; over any fixed window's limit it is refused with the
 * seconds until that window ends, whether or not the code exists (the code is not even an input).
 */

// 2026-10-20T10:00:00Z, the start of a minute and of an hour.
const HOUR_START = 1_792_490_400_000;
const ANDREA = { userId: userId("aaaaaaaa-0000-4000-8000-000000000001") };
const VICTOR = { userId: userId("aaaaaaaa-0000-4000-8000-000000000002") };
const NET = "k1";

function given(at = HOUR_START) {
  const app = createTestApp();
  let now = at;
  const clock = { now: () => instant(now) };
  const deps = { uow: app.uow, clock };
  const attempt = (actor = ANDREA, networkKey: string | null = NET) =>
    admitJoinAttempt(deps, actor, { networkKey });
  const times = async (n: number, actor = ANDREA, networkKey: string | null = NET) => {
    for (let i = 0; i < n; i += 1) await attempt(actor, networkKey);
  };
  return {
    app,
    attempt,
    times,
    at: (ms: number) => {
      now = ms;
    },
  };
}

describe("admitJoinAttempt", () => {
  it("pins the limits: 10 a minute and 30 an hour per user, 30 and 100 per network", () => {
    expect(JOIN_ATTEMPT_LIMITS).toEqual([
      { per: "user", windowSeconds: 60, limit: 10 },
      { per: "user", windowSeconds: 3600, limit: 30 },
      { per: "network", windowSeconds: 60, limit: 30 },
      { per: "network", windowSeconds: 3600, limit: 100 },
    ]);
  });

  it("admits a user's first 10 attempts in a minute and refuses the 11th until the minute ends", async () => {
    const { attempt, times, at } = given(HOUR_START + 15_000);
    await times(9);
    expect(await attempt()).toEqual(ok(undefined));
    expect(await attempt()).toEqual(err({ kind: "TooManyJoinAttempts", retryAfterSeconds: 45 }));
    at(HOUR_START + 59_001);
    // Rounded up: never tells the client to come back before the window ends.
    expect(await attempt()).toEqual(err({ kind: "TooManyJoinAttempts", retryAfterSeconds: 1 }));
    at(HOUR_START + 60_000);
    expect(await attempt()).toEqual(ok(undefined));
  });

  it("refused attempts count too, so hammering does not slip through the next minute early", async () => {
    const { attempt, times, at } = given();
    await times(25);
    // 10 admitted + 15 refused in minute one: the hour already holds 25.
    at(HOUR_START + 60_000);
    await times(5);
    expect(await attempt()).toEqual(err({ kind: "TooManyJoinAttempts", retryAfterSeconds: 3540 }));
  });

  it("refuses the 31st attempt in an hour with the seconds until the hour ends", async () => {
    const { attempt, times, at } = given();
    for (let minute = 0; minute < 3; minute += 1) {
      at(HOUR_START + minute * 60_000);
      await times(10);
    }
    at(HOUR_START + 3 * 60_000);
    expect(await attempt()).toEqual(err({ kind: "TooManyJoinAttempts", retryAfterSeconds: 3420 }));
  });

  it("each user has their own budget", async () => {
    const { attempt, times } = given();
    await times(10, ANDREA, null);
    expect((await attempt(ANDREA, null)).ok).toBe(false);
    expect(await attempt(VICTOR, null)).toEqual(ok(undefined));
  });

  it("limits a network across users: 30 a minute", async () => {
    const { attempt, at } = given();
    for (let n = 0; n < 30; n += 1) {
      at(HOUR_START + n);
      const user = {
        userId: userId(`aaaaaaaa-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`),
      };
      expect(await attempt(user, NET)).toEqual(ok(undefined));
    }
    const fresh = { userId: userId("aaaaaaaa-0000-4000-8000-000000000999") };
    expect((await attempt(fresh, NET)).ok).toBe(false);
    // Another network is not affected.
    expect(await attempt(fresh, "k2")).toEqual(ok(undefined));
  });

  it("without a network key only the user limits apply", async () => {
    const { attempt } = given();
    for (let n = 0; n < 40; n += 1) {
      const user = {
        userId: userId(`aaaaaaaa-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`),
      };
      expect(await attempt(user, null)).toEqual(ok(undefined));
    }
  });

  it("stores only `user:` and `network:` subjects and sweeps the ended windows", async () => {
    const { app, attempt, at } = given();
    await attempt();
    at(HOUR_START + 3_600_000);
    await attempt(VICTOR, null);
    // Andrea's minute and hour windows both ended: swept; only Victor's two counters remain.
    const counts = await app.uow.transaction(async ({ rateLimits }) =>
      ok(
        await rateLimits.hit([
          {
            action: "joinCircle",
            subject: `user:${ANDREA.userId}`,
            windowStart: instant(HOUR_START),
            windowSeconds: 60,
          },
          {
            action: "joinCircle",
            subject: `user:${VICTOR.userId}`,
            windowStart: instant(HOUR_START + 3_600_000),
            windowSeconds: 60,
          },
        ]),
      ),
    );
    expect(counts).toEqual(ok([1, 2]));
  });
});
