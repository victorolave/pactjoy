import { describe, expect, it } from "vitest";
import type { Repositories } from "../ports/repositories.ts";
import type { RateLimitCounter } from "../rate-limit/rate-limit.repository.ts";
import { ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import type { ContractSubject } from "./fixtures.ts";

type RateLimitRepositories = Pick<Repositories, "rateLimits">;

const T0 = 1_791_987_120_000;
const MINUTE = 60;

const counter = (subject: string, extra: Partial<RateLimitCounter> = {}): RateLimitCounter => ({
  action: "joinCircle",
  subject,
  windowStart: instant(T0),
  windowSeconds: MINUTE,
  ...extra,
});

/**
 * `RateLimitRepository` contract (ADR-0020), adapter-neutral, driven through the unit of work. The
 * factory must return an EMPTY store. Counters have no foreign keys, so nothing needs seeding.
 */
export function describeRateLimitContract(
  name: string,
  factory: () => Promise<ContractSubject<RateLimitRepositories>>,
): void {
  describe(`RateLimitRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      const write = <T>(work: (repos: RateLimitRepositories) => Promise<T>) =>
        uow.transaction(async (repos) => ok(await work(repos)));
      const hit = async (counters: readonly RateLimitCounter[]) => {
        const result = await write(({ rateLimits }) => rateLimits.hit(counters));
        if (!result.ok) throw new Error("unreachable");
        return result.value;
      };
      return { uow, write, hit };
    }

    it("creates a counter at 1 and counts every later hit", async () => {
      const { hit } = await subject();
      expect(await hit([counter("user:a")])).toEqual([1]);
      expect(await hit([counter("user:a")])).toEqual([2]);
      expect(await hit([counter("user:a")])).toEqual([3]);
    });

    it("returns the counts in the order given, each counter on its own", async () => {
      const { hit } = await subject();
      await hit([counter("user:a")]);
      const counts = await hit([
        counter("user:b"),
        counter("user:a"),
        counter("user:a", { windowSeconds: 3600 }),
        counter("user:a", { windowStart: instant(T0 + MINUTE * 1000) }),
      ]);
      expect(counts).toEqual([1, 2, 1, 1]);
    });

    it("sees its own hits inside a transaction and counts them once committed", async () => {
      const { write, hit } = await subject();
      const inside = await write(async ({ rateLimits }) => [
        ...(await rateLimits.hit([counter("user:a")])),
        ...(await rateLimits.hit([counter("user:a")])),
      ]);
      expect(inside).toEqual(ok([1, 2]));
      expect(await hit([counter("user:a")])).toEqual([3]);
    });

    it("a rolled-back transaction leaves no hit behind", async () => {
      const { uow, hit } = await subject();
      await expect(
        uow.transaction(async ({ rateLimits }) => {
          await rateLimits.hit([counter("user:a")]);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await hit([counter("user:a")])).toEqual([1]);
    });

    it("sweeps exactly the counters whose window ended at or before now", async () => {
      const { write, hit } = await subject();
      await hit([
        counter("user:ended"),
        counter("user:open", { windowStart: instant(T0 + 1000) }),
        counter("user:hour", { windowSeconds: 3600 }),
      ]);
      await write(({ rateLimits }) => rateLimits.sweepExpired(instant(T0 + MINUTE * 1000)));
      expect(
        await hit([
          counter("user:ended"),
          counter("user:open", { windowStart: instant(T0 + 1000) }),
          counter("user:hour", { windowSeconds: 3600 }),
        ]),
      ).toEqual([1, 2, 2]);
    });

    it("deletes every counter of the given subjects and nothing else", async () => {
      const { write, hit } = await subject();
      await hit([counter("user:a"), counter("user:a", { windowSeconds: 3600 }), counter("user:b")]);
      await write(({ rateLimits }) => rateLimits.deleteBySubjects(["user:a"]));
      await write(({ rateLimits }) => rateLimits.deleteBySubjects([]));
      expect(
        await hit([
          counter("user:a"),
          counter("user:a", { windowSeconds: 3600 }),
          counter("user:b"),
        ]),
      ).toEqual([1, 1, 2]);
    });
  });
}
