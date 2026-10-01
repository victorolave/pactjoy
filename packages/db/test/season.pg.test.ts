import {
  type Circle,
  circleId,
  instant,
  inviteCode,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const MEMBER = memberId(uuid(0x101));

const circle: Circle = {
  id: circleId(uuid(0xc1)),
  name: "Circle",
  members: [
    { id: MEMBER, userId: userId(uuid(0x201)), status: "active", joinedAt: T0, leftAt: null },
  ],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};
const season: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: circle.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  commitments: [],
  approvals: [],
  pactClosedAt: null,
  createdAt: T0,
  version: 0,
};

// Pool >= 2: the lock regression keeps one transaction open while another runs.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await client.end();
  await admin.end();
});
beforeEach(async () => {
  await truncateAll(admin);
  await uow.transaction(async ({ circles }) => {
    await circles.save(circle, null);
    return ok(undefined);
  });
});

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);

describe("season repository on Postgres (read/write side)", () => {
  it("guardVersion fails loudly until it lands, never as a silent no-op", async () => {
    await expect(
      uow.transaction(async ({ seasons }) => {
        await seasons.guardVersion(season.id, 0);
        return ok(undefined);
      }),
    ).rejects.toThrow("not implemented (B5b-ii)");
  });

  it("stores the measure as a jsonb object (not a double-encoded string) tagged with its version", async () => {
    const commitment = {
      id: uuid(0x301) as never,
      memberId: MEMBER,
      habitId: uuid(0x401) as never,
      weightPercent: 100,
      privacy: "visible" as const,
      measure: {
        unit: "done" as const,
        schedule: {
          period: "perSession" as const,
          frequency: { kind: "timesPerWeek" as const, times: 3 },
        },
      },
    };
    await uow.transaction(async ({ seasons }) => {
      await seasons.save({ ...season, commitments: [commitment] }, null);
      return ok(undefined);
    });
    const rows = await admin.unsafe(
      "select jsonb_typeof(measure) as type, (measure->>'v')::int as v from pactjoy.season_commitments",
    );
    expect(rows).toEqual([{ type: "object", v: 1 }]);
  });

  it("a commitment id is unique across seasons (season_commitments_id_key), raised as a raw 23505", async () => {
    const commitment = {
      id: uuid(0x301) as never,
      memberId: MEMBER,
      habitId: uuid(0x401) as never,
      weightPercent: 100,
      privacy: "visible" as const,
      measure: {
        unit: "done" as const,
        schedule: {
          period: "perSession" as const,
          frequency: { kind: "timesPerWeek" as const, times: 3 },
        },
      },
    };
    await uow.transaction(async ({ seasons }) => {
      await seasons.save({ ...season, commitments: [commitment] }, null);
      return ok(undefined);
    });
    const error = await uow
      .transaction(async ({ seasons }) => {
        await seasons.save(
          { ...season, id: seasonId(uuid(0xe2)), commitments: [commitment] },
          null,
        );
        return ok(undefined);
      })
      .catch((e) => e);
    expect(error).toMatchObject({ code: "23505", constraint_name: "season_commitments_id_key" });
  });

  it("a circle invite regenerated while a season insert is uncommitted never waits (KEY SHARE vs save)", async () => {
    const c = { ...circle, invite: null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const seasonInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // The season's FK check holds KEY SHARE on the circle row until this transaction commits.
    const holder = uow.transaction(async ({ seasons }) => {
      await seasons.save(season, null);
      inserted();
      await gate;
      return ok(undefined);
    });
    holder.catch(() => undefined);
    try {
      await within(seasonInserted, 5_000);
      const next = {
        ...c,
        version: 1,
        invite: {
          code: inviteCode("NEW999"),
          createdAt: T0,
          expiresAt: instant(T0 + 600_000),
          createdBy: MEMBER,
        },
      };
      await within(
        uow.transaction(async ({ circles }) => {
          await circles.save(next, 0);
          return ok(undefined);
        }),
        5_000,
      );
    } finally {
      release();
    }
    await within(holder, 5_000);
    expect(await uow.read(({ seasons }) => seasons.get(season.id))).toEqual(season);
  });
});
