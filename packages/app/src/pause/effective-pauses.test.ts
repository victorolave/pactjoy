import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { pauseRequestId, seasonId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { memberFixture, pauseRequestFixture } from "../testing/builders.ts";
import {
  type ActiveSeasonFixture,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { type Instant, instant } from "../time/instant.ts";
import { loadEffectivePauses } from "./effective-pauses.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { settleSeasonPauses } from "./settle.ts";

const VICTOR = memberId("member-victor");
const ANDREA = memberId("member-andrea");
const HOUR = 3_600_000;

/** Fixture season: day 0 = 2026-10-01 at UTC-3; "noon" instants are 15:00Z. */
const noon = (day: number): Instant => localInstant(dayOf(day));

async function setup(now: Instant) {
  const app = createTestApp({ now, timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, given };
}

/** Victor asks to pause his own Commitment on day 2 at noon; Andrea is the only approver. */
function victorsRequest(given: ActiveSeasonFixture, extra: Partial<PauseRequestRecord> = {}) {
  return pauseRequestFixture({
    id: pauseRequestId("pause-v"),
    seasonId: given.season.id,
    memberId: VICTOR,
    requestedAt: noon(2),
    requestedOn: seasonDay(2),
    startDay: seasonDay(2),
    commitments: [{ commitmentId: given.victorCommitment, resumedOn: null, resumedAt: null }],
    ...extra,
  });
}

const read = (app: TestApp, now: Instant, given: ActiveSeasonFixture) =>
  app.uow.read((repos) =>
    loadEffectivePauses(repos, {
      season: given.season,
      circle: given.circle,
      now,
      timeZone: app.timeZone,
    }),
  );

describe("loadEffectivePauses: the lazy decision, applied on every read", () => {
  it("is empty when nobody asked for a pause", async () => {
    const { app, given } = await setup(noon(3));
    expect(await read(app, noon(3), given)).toEqual([]);
  });

  it("a request inside its 48 h window reads as pending, with its owner and Commitment", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(victorsRequest(given), null);

    expect(await read(app, instant(noon(2) + 48 * HOUR - 1), given)).toEqual([
      {
        memberId: VICTOR,
        commitmentId: given.victorCommitment,
        requestedOn: 2,
        startDay: 2,
        end: { kind: "open" },
        decision: { kind: "pending" },
      },
    ]);
  });

  it("at autoApproveAt it reads as approved, decided on the deadline's own day, with no job having run", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(victorsRequest(given), null);

    // A first read days after the deadline still reports day 4 (2026-10-05 noon is the deadline).
    const later = await read(app, noon(8), given);
    expect(later[0]?.decision).toEqual({ kind: "approved", decidedOn: 4, resumedOn: null });
    expect(await app.pauses.get(pauseRequestId("pause-v"))).toMatchObject({ status: "pending" });
  });

  it("an answer from the only approver decides it at once, on the day she answered", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(
      victorsRequest(given, {
        responses: [{ memberId: ANDREA, response: "reject", respondedAt: noon(3) }],
      }),
      null,
    );
    const [pause] = await read(app, noon(3), given);
    expect(pause?.decision).toEqual({ kind: "rejected", decidedOn: 3 });
  });

  it("Q1: with no one else active in the circle, it reads as approved on the request day", async () => {
    const { app, given } = await setup(noon(3));
    const solo = {
      ...given.circle,
      members: given.circle.members.map((m) =>
        m.id === ANDREA ? { ...m, status: "left" as const } : m,
      ),
    };
    await app.pauses.save(victorsRequest(given), null);
    const reading = await app.uow.read((repos) =>
      loadEffectivePauses(repos, {
        season: given.season,
        circle: solo,
        now: noon(2),
        timeZone: app.timeZone,
      }),
    );
    expect(reading[0]?.decision).toEqual({ kind: "approved", decidedOn: 2, resumedOn: null });
  });

  it("a member who left the circle does not hold the decision back", async () => {
    const { app, given } = await setup(noon(3));
    const withLeaver = {
      ...given.circle,
      members: [
        ...given.circle.members,
        memberFixture({
          id: memberId("member-sofia"),
          userId: userId("user-sofia"),
          status: "left",
        }),
      ],
    };
    await app.pauses.save(
      victorsRequest(given, {
        responses: [{ memberId: ANDREA, response: "approve", respondedAt: noon(3) }],
      }),
      null,
    );
    const reading = await app.uow.read((repos) =>
      loadEffectivePauses(repos, {
        season: given.season,
        circle: withLeaver,
        now: noon(3),
        timeZone: app.timeZone,
      }),
    );
    expect(reading[0]?.decision).toMatchObject({ kind: "approved", decidedOn: 3 });
  });

  it("is empty while the season has no start day (pact still open)", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(victorsRequest(given), null);
    const unstarted = { ...given.season, actualStart: null };
    const reading = await app.uow.read((repos) =>
      loadEffectivePauses(repos, {
        season: unstarted,
        circle: given.circle,
        now: noon(3),
        timeZone: app.timeZone,
      }),
    );
    expect(reading).toEqual([]);
  });

  it("only returns the requests of the asked season", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(victorsRequest(given, { seasonId: seasonId("other-season") }), null);
    expect(await read(app, noon(8), given)).toEqual([]);
  });
});

describe("settleSeasonPauses: persists what the lazy decision already says", () => {
  const settle = (app: TestApp, now: Instant, given: ActiveSeasonFixture) =>
    app.uow.transaction(async (repos) =>
      ok(
        await settleSeasonPauses(repos, {
          season: given.season,
          circle: given.circle,
          now,
          timeZone: app.timeZone,
        }),
      ),
    );

  it("stores the due approval with the deadline's decidedAt/decidedOn and a new version", async () => {
    const { app, given } = await setup(noon(3));
    const request = victorsRequest(given);
    await app.pauses.save(request, null);

    const result = await settle(app, noon(8), given);

    expect(result).toEqual({ ok: true, value: 1 });
    expect(await app.pauses.get(request.id)).toEqual({
      ...request,
      status: "approved",
      decidedAt: request.autoApproveAt,
      decidedOn: seasonDay(4),
      version: 1,
    });
  });

  it("stores a standing rejection as rejected at the deadline", async () => {
    const { app, given } = await setup(noon(3));
    const request = victorsRequest(given, {
      responses: [{ memberId: ANDREA, response: "reject", respondedAt: noon(3) }],
    });
    await app.pauses.save(request, null);
    // Everyone answered: decided on day 3 already, even before the deadline.
    await settle(app, noon(3), given);
    expect(await app.pauses.get(request.id)).toMatchObject({
      status: "rejected",
      decidedOn: 3,
      version: 1,
    });
  });

  it("is idempotent: a second run settles nothing and changes nothing", async () => {
    const { app, given } = await setup(noon(3));
    await app.pauses.save(victorsRequest(given), null);
    await settle(app, noon(8), given);
    const afterFirst = await app.pauses.get(pauseRequestId("pause-v"));

    expect(await settle(app, noon(9), given)).toEqual({ ok: true, value: 0 });
    expect(await app.pauses.get(pauseRequestId("pause-v"))).toEqual(afterFirst);
  });

  it("leaves a request that is still inside its window pending", async () => {
    const { app, given } = await setup(noon(3));
    const request = victorsRequest(given);
    await app.pauses.save(request, null);

    expect(await settle(app, noon(3), given)).toEqual({ ok: true, value: 0 });
    expect(await app.pauses.get(request.id)).toEqual(request);
  });
});
