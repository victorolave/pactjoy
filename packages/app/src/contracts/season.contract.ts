import { frac, fromInt, type PerSessionSchedule } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { type CommitmentRecord, commitmentId, type Measure } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, habitId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { circleFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { CIRCLE, type ContractSubject } from "./fixtures.ts";

type SeasonRepositories = Pick<Repositories, "circles" | "seasons">;
type Uow = ContractSubject<SeasonRepositories>["uow"];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const OTHER_CIRCLE = circleFixture({
  id: circleId(uuid(0xc2)),
  members: [memberFixture({ id: memberId(uuid(0xa2)), userId: userId(uuid(0xb2)) })],
});
const SPECIFIC: PerSessionSchedule = {
  period: "perSession",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
};
// The contracts run under Node only; the app tsconfig has no node types.
const { env } = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process;
const huge = 2n ** 70n + 1n;

const MINUTES = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: SPECIFIC,
} satisfies Measure;

/** Every unit x direction x period combination, plus fractions beyond 2^53 (SP-S17, SP-S18). */
const MEASURES: readonly Measure[] = [
  { unit: "done", schedule: SPECIFIC },
  {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
  MINUTES,
  { ...MINUTES, schedule: { period: "weeklyTotal" } },
  {
    unit: "custom",
    customLabel: 'Ñ ✓ "q"',
    precision: "integer",
    target: { direction: "limit", ideal: fromInt(2), tolerance: frac(7n, 2n) },
    schedule: SPECIFIC,
  },
  {
    unit: "km",
    customLabel: null,
    precision: "decimal",
    target: { direction: "limit", ideal: frac(1n, 3n), tolerance: fromInt(9) },
    schedule: { period: "weeklyTotal" },
  },
  {
    unit: "pages",
    customLabel: null,
    precision: "integer",
    target: { direction: "reach", minimum: frac(huge, 3n), ideal: frac(huge * 5n, 7n) },
    schedule: SPECIFIC,
  },
];

const commitments = (count: number, from = 0): CommitmentRecord[] =>
  Array.from({ length: count }, (_, i) => ({
    id: commitmentId(uuid(0x300 + from + i)),
    memberId: memberId(uuid(0x100 + ((from + i) % 2))),
    habitId: habitId(uuid(0x400 + from + i)),
    weightPercent: 5 * (from + i + 1),
    privacy: i % 2 === 0 ? ("visible" as const) : ("private" as const),
    measure: MEASURES[(from + i) % MEASURES.length] as Measure,
  }));
const approvals = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    memberId: memberId(uuid(0x100 + i)),
    approvedAt: instant(1_700_000_000_000 + 7 * i),
  }));

const season = (n: number, options: Partial<Season> = {}): Season =>
  seasonFixture({ id: seasonId(uuid(0xe0 + n)), circleId: CIRCLE.id, ...options });

const saveSeason = (uow: Uow, s: Season, expected: number | null) =>
  uow.transaction(async ({ seasons }) => {
    await seasons.save(s, expected);
    return ok(undefined);
  });

/**
 * `SeasonRepository` read/write contract (SP-S1..S6, S8..S10, S17, S18, S22,
 * S24, S25), adapter-neutral. The factory must return an EMPTY store. Parent
 * circles are seeded through the port first, because of the foreign key.
 */
export function describeSeasonRepositoryContract(
  name: string,
  factory: () => Promise<ContractSubject<SeasonRepositories>>,
): void {
  describe(`SeasonRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      await uow.transaction(async ({ circles }) => {
        await circles.save(CIRCLE, null);
        await circles.save(OTHER_CIRCLE, null);
        return ok(undefined);
      });
      return {
        uow,
        get: (id = season(1).id) => uow.read(({ seasons }) => seasons.get(id)),
        latest: (circle = CIRCLE.id) =>
          uow.read(({ seasons }) => seasons.findLatestByCircle(circle)),
      };
    }

    it("SP-S1: get returns null for an unknown id", async () => {
      expect(await (await subject()).get()).toBeNull();
    });

    it("SP-S2/S25: round-trips commitments and approvals in saved order", async () => {
      const { uow, get } = await subject();
      const saved = season(1, { commitments: commitments(5), approvals: approvals(3) });
      await saveSeason(uow, saved, null);
      expect(await get()).toEqual(saved);
    });

    it("SP-S3/S24: preserves nulls, millisecond instants and every other field", async () => {
      const { uow, get } = await subject();
      const bare = season(1);
      await saveSeason(uow, bare, null);
      expect(await get()).toEqual(bare);
      const full = season(2, {
        status: "active",
        lengthWeeks: 12,
        reviewCadenceWeeks: 3,
        timeZone: timeZoneId("America/Bogota"),
        nominalStart: localDate("2026-03-08"),
        actualStart: localDate("2026-03-09"),
        pactClosedAt: instant(1_700_000_123_456),
        createdAt: instant(1_700_000_000_001),
        version: 4,
      });
      await saveSeason(uow, full, null);
      expect(await get(full.id)).toEqual(full);
    });

    it("SP-S17/S18: round-trips every measure kind, fractions beyond 2^53 included", async () => {
      const { uow, get } = await subject();
      const saved = season(1, { commitments: commitments(MEASURES.length) });
      await saveSeason(uow, saved, null);
      expect((await get())?.commitments.map((c) => c.measure)).toEqual(MEASURES);
    });

    it("SP-S22: LocalDate and Instant survive a process time zone of Bogota and UTC+14", async () => {
      const { uow, get } = await subject();
      const saved = season(1, {
        nominalStart: localDate("2026-03-08"),
        actualStart: localDate("2026-12-31"),
      });
      await saveSeason(uow, saved, null);
      const previous = env.TZ;
      try {
        for (const tz of ["America/Bogota", "Pacific/Kiritimati"]) {
          env.TZ = tz;
          expect(await get()).toEqual(saved);
        }
      } finally {
        if (previous === undefined) delete env.TZ;
        else env.TZ = previous;
      }
    });

    it("SP-S4: save(null) on an existing id conflicts", async () => {
      const { uow } = await subject();
      await saveSeason(uow, season(1), null);
      await expect(saveSeason(uow, season(1), null)).rejects.toBeInstanceOf(ConcurrencyConflict);
    });

    it("SP-S5: save at the stored version succeeds; a stale or missing one conflicts", async () => {
      const { uow, get } = await subject();
      await saveSeason(uow, season(1), null);
      await saveSeason(uow, season(1, { version: 1, status: "active" }), 0);
      expect((await get())?.version).toBe(1);
      await expect(saveSeason(uow, season(1, { version: 2 }), 0)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      await expect(saveSeason(uow, season(2, { version: 1 }), 0)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect((await get())?.version).toBe(1);
    });

    it("SP-S6: an update replaces the child sets, shrinking and growing", async () => {
      const { uow, get } = await subject();
      await saveSeason(
        uow,
        season(1, { commitments: commitments(4), approvals: approvals(2) }),
        null,
      );
      const shrunk = season(1, { version: 1, commitments: commitments(1, 2), approvals: [] });
      await saveSeason(uow, shrunk, 0);
      expect(await get()).toEqual(shrunk);
      const grown = season(1, { version: 2, commitments: commitments(3), approvals: approvals(2) });
      await saveSeason(uow, grown, 1);
      expect(await get()).toEqual(grown);
    });

    it("SP-S8/S9: latest is the last INSERTED season: an update does not move it, equal createdAt ties", async () => {
      const { uow, latest } = await subject();
      await saveSeason(uow, season(1), null);
      await saveSeason(uow, season(2), null);
      expect((await latest())?.id).toBe(season(2).id);
      await saveSeason(uow, season(1, { version: 1, status: "closed" }), 0);
      expect((await latest())?.id).toBe(season(2).id);
    });

    it("SP-S10: no seasons gives null and other circles' seasons are ignored", async () => {
      const { uow, latest } = await subject();
      expect(await latest()).toBeNull();
      await saveSeason(uow, season(1, { circleId: OTHER_CIRCLE.id }), null);
      expect(await latest()).toBeNull();
      expect((await latest(OTHER_CIRCLE.id))?.id).toBe(season(1).id);
    });
  });
}
