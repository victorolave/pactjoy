import { describe, expect, it } from "vitest";
import { joinCircle } from "../circle/join-circle.ts";
import { approvePact } from "../pact/approve-pact.ts";
import { instant } from "../time/instant.ts";
import { createTestApp } from "./app-harness.ts";
import { givenSoloOpenPact, storedSeason } from "./pact-fixtures.ts";
import { raceTransactions } from "./race-harness.ts";

const NOW = instant(1_759_060_800_000);
const HANG_GUARD_MS = 1_000;

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
