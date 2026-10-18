import type { UserId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import type { TestApp } from "../testing/app-harness.ts";
import { instant } from "../time/instant.ts";
import { userSubject } from "./join-attempts.ts";

/**
 * Test support: hits `user`'s join-attempt counter of the current minute once and returns its
 * count, so 1 means nothing was stored before. Lives here because `repos.rateLimits` is confined to
 * this module (`rate-limit-guard.test.ts`).
 */
export async function probeUserMinute(app: TestApp, user: UserId): Promise<number> {
  const now = app.clock.now();
  const counted = await app.uow.transaction(async (repos) =>
    ok(
      await repos.rateLimits.hit([
        {
          action: "joinCircle",
          subject: userSubject(user),
          windowStart: instant(now - (now % 60_000)),
          windowSeconds: 60,
        },
      ]),
    ),
  );
  return counted.ok ? (counted.value[0] ?? 0) : 0;
}
