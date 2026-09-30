import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { joinCircle } from "../circle/join-circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { approvePact } from "../pact/approve-pact.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { instant } from "../time/instant.ts";
import { createTestApp } from "./app-harness.ts";
import { givenActiveSeason } from "./entry-fixtures.ts";
import { givenSoloOpenPact, storedSeason } from "./pact-fixtures.ts";
import { raceTransactions } from "./race-harness.ts";

const NOW = instant(1_759_060_800_000);
const HANG_GUARD_MS = 1_000;
const DONE_DAILY: Measure = {
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};

describe("raceTransactions", () => {
  it(
    "does not hang when the winner settles before ever reading a season: the loser runs normally",
    async () => {
      const app = createTestApp({ now: NOW });
      const { season, andrea } = await givenSoloOpenPact(app);

      const { winner, loser } = await raceTransactions(
        app,
        (a) => joinCircle(a, andrea, { inviteCode: "NOSUCH" }),
        (a) => approvePact(a, andrea, { seasonId: season.id }),
      );

      expect(winner).toMatchObject({ status: "fulfilled", value: { ok: false } });
      expect(loser).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect((await storedSeason(app, season.id)).status).toBe("active");
    },
    HANG_GUARD_MS,
  );

  it(
    "does not hang when the loser settles before ever reading a season: the winner runs normally",
    async () => {
      const app = createTestApp({ now: NOW });
      const { season, andrea } = await givenSoloOpenPact(app);

      const { winner, loser } = await raceTransactions(
        app,
        (a) => approvePact(a, andrea, { seasonId: season.id }),
        (a) => joinCircle(a, andrea, { inviteCode: "NOSUCH" }),
      );

      expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect(loser).toMatchObject({ status: "fulfilled", value: { ok: false } });
    },
    HANG_GUARD_MS,
  );

  it(
    "pauseOn entries: a winner that never pauses still commits only after the loser reached its pause point",
    async () => {
      const app = createTestApp({ now: NOW });
      const given = await givenActiveSeason(app, DONE_DAILY);

      const { winner, loser } = await raceTransactions(
        app,
        // Commits immediately: without the harness holding it back it would
        // land before the slow loser has even read the season.
        (a) =>
          a.uow.transaction(async (repos) => {
            await repos.seasons.save({ ...given.season, version: 1 }, 0);
            return { ok: true as const, value: undefined };
          }),
        (a) =>
          a.uow.transaction(async (repos) => {
            for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
            const season = await repos.seasons.get(given.season.id);
            await repos.entries.findByClientRequest(
              memberId("member-andrea"),
              given.andreaCommitment,
              "k",
            );
            await repos.seasons.guardVersion(given.season.id, season?.version ?? -1);
            return { ok: true as const, value: undefined };
          }),
        "entries",
      );

      expect(winner.status).toBe("fulfilled");
      expect(loser.status).toBe("rejected");
      expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    },
    HANG_GUARD_MS,
  );

  it(
    "pauseOn entries: does not hang when the loser settles without ever reaching the pause point",
    async () => {
      const app = createTestApp({ now: NOW });

      const { winner, loser } = await raceTransactions(
        app,
        (a) => a.uow.transaction(async () => ({ ok: true as const, value: 1 })),
        (a) => a.uow.transaction(async () => ({ ok: false as const, error: "early" })),
        "entries",
      );

      expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
      expect(loser).toMatchObject({ status: "fulfilled", value: { ok: false } });
    },
    HANG_GUARD_MS,
  );

  it(
    "does not hang when a transaction throws before reading a season",
    async () => {
      const app = createTestApp({ now: NOW });
      const { season, andrea } = await givenSoloOpenPact(app);

      const { winner, loser } = await raceTransactions(
        app,
        (a) => a.uow.transaction(async () => Promise.reject(new Error("boom"))),
        (a) => approvePact(a, andrea, { seasonId: season.id }),
      );

      expect(winner.status).toBe("rejected");
      expect(loser).toMatchObject({ status: "fulfilled", value: { ok: true } });
    },
    HANG_GUARD_MS,
  );
});
