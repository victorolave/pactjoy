import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it, vi } from "vitest";
import { createIntlTimeZone } from "../adapters/intl-time-zone.ts";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { loadScoreContext } from "../score/score-context.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { habitFixture, memberFixture } from "../testing/builders.ts";
import {
  atInstant,
  END_OF_DAY,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { instant } from "../time/instant.ts";
import { epochDay } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { seasonProgressCore } from "./season-progress-core.ts";

const day = (n: number) => localDateOfSeasonDay(seasonDay(n), SEASON_START);
const DAILY = {
  unit: "done",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
} as const;

async function setup() {
  const app = createTestApp({ now: localInstant(day(0)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY);
  // Test-only composition: A2 will load once and combine this core with weekly series.
  const read = (n = 0, actor: Actor = given.andrea, deps = atInstant(app, localInstant(day(n)))) =>
    deps.uow.read(async (repos) => {
      const context = await loadScoreContext(deps, repos, actor, given.season.id);
      if (!context.ok) return context;
      const { season, viewer, start } = context.value;
      const entries = start ? await repos.entries.listBySeason(season.id) : [];
      const pauses = start ? await repos.pauses.listBySeason(season.id) : [];
      const habits = start
        ? await repos.habits.getMany(
            season.commitments.filter((c) => c.memberId === viewer.id).map((c) => c.habitId),
          )
        : [];
      return ok(seasonProgressCore(context.value, { entries, pauses }, habits));
    });
  const started = async (n = 0, actor = given.andrea, deps?: TestApp) => {
    const result = await read(n, actor, deps);
    if (!result.ok || result.value.state === "notStarted") throw new Error("expected progress");
    return result.value;
  };
  return { app, given, read, started };
}

describe("season progress core (A1, 23a)", () => {
  it("projects season metadata, null metrics and alphabetical unnumbered zero standings", async () => {
    const { app, given, started } = await setup();
    await app.circles.save({ ...given.circle, members: [...given.circle.members].reverse() }, 0);
    const view = await started();
    expect(view).toMatchObject({
      state: "active",
      viewerId: "member-andrea",
      circle: { id: "circle-1", name: "Test Circle" },
      season: { id: "season-1", actualStart: day(0), lastDay: day(27), lengthWeeks: 4 },
      calendar: { today: day(0), weekIndex: 0, dayOfWeek: 1, daysLeft: 27 },
      own: { points: 0, consistency: null, idealCompletion: null },
    });
    expect(view.own.commitments).toHaveLength(1);
    expect(view.own.commitments[0]).toMatchObject({
      habit: { name: "Meditar", icon: null },
      opportunities: { kept: 0, counted: 0 },
      pause: "none",
    });
    expect(view.standings).toEqual({
      memberCount: 2,
      rows: [
        { memberId: "member-andrea", displayName: "Andrea", isViewer: true, rank: null, points: 0 },
        {
          memberId: "member-victor",
          displayName: "Victor",
          isViewer: false,
          rank: null,
          points: 0,
        },
      ],
    });
    // Internal core deliberately cannot masquerade as the complete public /progress DTO.
    expect(view).not.toHaveProperty("weeks");
  });

  it("returns only notStarted for a pact with no actual start", async () => {
    const { app, given, read } = await setup();
    await app.seasons.save({ ...given.season, status: "pactOpen", actualStart: null }, 0);
    const habits = vi.spyOn(app.habits, "getMany");
    expect(await read()).toEqual({
      ok: true,
      value: { state: "notStarted", seasonId: given.season.id },
    });
    expect(habits).not.toHaveBeenCalled();
  });

  it("also returns notStarted before the resolved actual start", async () => {
    const { app, given, read } = await setup();
    await app.seasons.save({ ...given.season, actualStart: day(1) }, 0);
    expect(await read()).toEqual({
      ok: true,
      value: { state: "notStarted", seasonId: given.season.id },
    });
  });

  it("counts an explicit entry immediately, but distinguishes uncounted from missed", async () => {
    const { app, given, started } = await setup();
    expect((await started(1)).own).toMatchObject({ points: 0, consistency: 0, idealCompletion: 0 });
    expect(
      await recordEntry(app, given.andrea, {
        seasonId: given.season.id,
        commitmentId: given.andreaCommitment,
        value: { kind: "done" },
        clientRequestId: "daily",
      }),
    ).toMatchObject({ ok: true });
    const view = await started();
    expect(view.own).toMatchObject({ points: 36, consistency: 100, idealCompletion: 100 });
    expect(view.own.commitments[0]).toMatchObject({
      opportunities: { kept: 1, counted: 1 },
      streak: { current: 1 },
    });
    expect(view.standings.rows.map((row) => [row.memberId, row.rank, row.points])).toEqual([
      ["member-andrea", 1, 36],
      ["member-victor", 2, 0],
    ]);
  });

  it("does not give weekly-window habits provisional points, including in the last week", async () => {
    const { app, given, started } = await setup();
    for (const n of [25, 26, 27]) {
      expect(
        await recordEntry(atInstant(app, localInstant(day(n))), given.victor, {
          seasonId: given.season.id,
          commitmentId: given.victorCommitment,
          value: { kind: "done" },
          clientRequestId: `weekly-${n}`,
        }),
      ).toMatchObject({ ok: true });
    }
    expect((await started(27, given.victor)).own.points).toBe(0);
    const ended = await started(28, given.victor);
    expect(ended).toMatchObject({
      state: "ended",
      calendar: { today: day(28), weekIndex: 3, dayOfWeek: 7, daysLeft: 0 },
      own: { points: 250, consistency: 25, idealCompletion: 25 },
    });
    expect(ended.own.commitments[0]?.opportunities).toEqual({ kept: 3, counted: 12 });
    expect((await started(40, given.victor)).own).toEqual(ended.own);
  });

  it("uses one captured instant for the whole read across season-local midnight", async () => {
    const { app, given, started } = await setup();
    const before = localInstant(day(0), END_OF_DAY);
    const clock = {
      now: vi
        .fn()
        .mockReturnValueOnce(before)
        .mockReturnValue(instant(before + 1)),
    };
    const read = vi.spyOn(app.uow, "read");
    const view = await started(0, given.andrea, { ...app, clock });
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(view.calendar.today).toBe(day(0));
    expect(view.own.consistency).toBeNull();
  });

  it("uses the season timezone, not the host's UTC day", async () => {
    const { app, given, started } = await setup();
    await app.seasons.save({ ...given.season, timeZone: timeZoneId("Pacific/Auckland") }, 0);
    const deps = {
      ...app,
      timeZone: createIntlTimeZone(),
      clock: { now: () => instant(epochDay(day(0)) * 86_400_000 + 12 * 3_600_000) },
    };
    const view = await started(0, given.andrea, deps);
    expect(view.calendar).toEqual({ today: day(1), weekIndex: 0, dayOfWeek: 2, daysLeft: 26 });
    expect(view.own.commitments[0]?.opportunities).toEqual({ kept: 0, counted: 1 });
  });

  it("keeps weighted ideal null until a weeklyTotal commitment has counted opportunities", async () => {
    const { app, given, started } = await setup();
    const base = given.season.commitments[0];
    if (!base) throw new Error("missing fixture commitment");
    await app.seasons.save(
      {
        ...given.season,
        commitments: [
          { ...base, weightPercent: 50 },
          {
            ...base,
            id: commitmentId("weekly-total"),
            weightPercent: 50,
            measure: {
              unit: "minutes",
              customLabel: null,
              precision: "decimal",
              target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
              schedule: { period: "weeklyTotal" },
            },
          },
        ],
      },
      0,
    );
    for (const [id, value] of [
      [given.andreaCommitment, { kind: "done" }],
      [commitmentId("weekly-total"), { kind: "quantity", value: "30" }],
    ] as const) {
      expect(
        await recordEntry(app, given.andrea, {
          seasonId: given.season.id,
          commitmentId: id,
          value,
          clientRequestId: id,
        }),
      ).toMatchObject({ ok: true });
    }
    const open = await started();
    expect(open.own).toMatchObject({ points: 18, consistency: 100, idealCompletion: null });
    expect(open.own.commitments[1]).toMatchObject({
      points: 0,
      opportunities: { kept: 0, counted: 0 },
      measure: { target: { minimum: "10", ideal: "30" } },
    });
    expect((await started(7)).own.commitments[1]).toMatchObject({
      points: 125,
      opportunities: { kept: 1, counted: 1 },
    });
  });

  it("loads only own habit metadata, retaining own private detail without enriching peers", async () => {
    const { app, given, started } = await setup();
    await app.seasons.save(
      {
        ...given.season,
        commitments: given.season.commitments.map((c) => ({ ...c, privacy: "private" })),
      },
      0,
    );
    const own = await app.habits.get(habitId("habit-andrea"));
    const peer = await app.habits.get(habitId("habit-victor"));
    if (!own || !peer) throw new Error("missing fixture habits");
    await app.habits.save({ ...own, icon: "brain", why: "own secret" }, 0);
    await app.habits.save({ ...peer, name: "private peer habit", why: "peer secret" }, 0);
    const getMany = vi.spyOn(app.habits, "getMany");
    const view = await started();
    expect(getMany).toHaveBeenCalledExactlyOnceWith([own.id]);
    expect(view.own.commitments[0]).toMatchObject({
      habit: { name: "Meditar", icon: "brain" },
      privacy: "private",
    });
    const serialized = JSON.stringify(view);
    for (const secret of [
      "private peer habit",
      "own secret",
      "peer secret",
      "user-andrea",
      "user-victor",
      "habit-victor",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each(["pending", "approved"] as const)(
    "projects real %s pause facts from the engine",
    async (kind) => {
      const { app, given, started } = await setup();
      app.pauses.add(given.season.id, {
        memberId: memberId("member-andrea"),
        commitmentId: given.andreaCommitment,
        requestedOn: seasonDay(0),
        startDay: seasonDay(0),
        end: { kind: "open" },
        decision:
          kind === "pending" ? { kind } : { kind, decidedOn: seasonDay(0), resumedOn: null },
      });
      expect((await started()).own.commitments[0]).toMatchObject({
        pause: kind === "pending" ? "onHold" : "paused",
        opportunities: { kept: 0, counted: 0 },
        consistency: null,
      });
    },
  );

  it("rounds the exact member total once, not the sum of displayed commitment points", async () => {
    const { app, given, started } = await setup();
    const base = given.season.commitments[0];
    if (!base) throw new Error("missing fixture commitment");
    const commitments = [35, 35, 30].map((weightPercent, i) => ({
      ...base,
      id: commitmentId(`own-${i}`),
      weightPercent,
    }));
    await app.seasons.save({ ...given.season, commitments }, 0);
    for (const c of commitments) {
      expect(
        await recordEntry(app, given.andrea, {
          seasonId: given.season.id,
          commitmentId: c.id,
          value: { kind: "done" },
          clientRequestId: c.id,
        }),
      ).toMatchObject({ ok: true });
    }
    const view = await started();
    expect(view.own.points).toBe(36);
    expect(view.own.commitments.map((row) => row.points)).toEqual([13, 13, 11]);
    expect(view.standings.memberCount).toBe(1);
  });

  it("allows active members without commitments, without inventing own metrics", async () => {
    const { app, given, started } = await setup();
    await app.seasons.save(
      {
        ...given.season,
        commitments: given.season.commitments.filter(
          (c) => c.memberId !== memberId("member-andrea"),
        ),
      },
      0,
    );
    expect((await started()).own).toEqual({
      points: 0,
      consistency: null,
      idealCompletion: null,
      commitments: [],
    });
    expect((await started()).standings).toMatchObject({
      memberCount: 1,
      rows: [{ memberId: "member-victor" }],
    });
  });

  it("keeps historical access for a former participant but excludes them from standings", async () => {
    const { app, given, started } = await setup();
    await app.circles.save(
      {
        ...given.circle,
        archivedAt: app.clock.now(),
        members: given.circle.members.map((m) =>
          m.id === memberId("member-andrea")
            ? { ...m, status: "left", leftAt: app.clock.now() }
            : m,
        ),
      },
      0,
    );
    const view = await started();
    expect(view.viewerId).toBe(memberId("member-andrea"));
    expect(view.own.commitments).toHaveLength(1);
    expect(view.standings.rows.map((row) => row.memberId)).toEqual([memberId("member-victor")]);
  });

  it.each(["outsider", "member-andrea", "former-nonparticipant"])(
    "rejects %s before reading score or habit data",
    async (user) => {
      const { app, given, read } = await setup();
      if (user === "former-nonparticipant") {
        await app.circles.save(
          {
            ...given.circle,
            members: [
              ...given.circle.members,
              memberFixture({
                id: memberId("former"),
                userId: userId(user),
                status: "left",
                leftAt: app.clock.now(),
              }),
            ],
          },
          0,
        );
      }
      const entries = vi.spyOn(app.entries, "listBySeason");
      const habits = vi.spyOn(app.habits, "getMany");
      expect(await read(0, { userId: userId(user) })).toEqual({
        ok: false,
        error: { kind: "NotAMember" },
      });
      expect(entries).not.toHaveBeenCalled();
      expect(habits).not.toHaveBeenCalled();
    },
  );

  it("orders nonzero displayed ties by Spanish name then MemberId with competition ranks", async () => {
    const { app, given, started } = await setup();
    const members = ["Zoe", "Álvaro", "Álvaro", "Beatriz", "Carlos", "Diana"].map(
      (displayName, i) =>
        memberFixture({
          id: memberId(`m-${i}`),
          userId: i === 0 ? given.andrea.userId : userId(`u-${i}`),
          displayName,
        }),
    );
    const commitments = members.map((m, i) =>
      buildCommitment({
        id: commitmentId(`c-${i}`),
        memberId: m.id,
        habitId: habitId(`h-${i}`),
        weightPercent: 100,
        privacy: "private",
        measure: DAILY,
      }),
    );
    await app.circles.save({ ...given.circle, members: [...members].reverse() }, 0);
    await app.seasons.save({ ...given.season, commitments }, 0);
    await app.habits.save(habitFixture({ id: habitId("h-0"), ownerId: given.andrea.userId }), null);
    for (const [i, n] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ] as const) {
      const c = commitments[i];
      const m = members[i];
      if (!c || !m) throw new Error("missing ranking fixture");
      expect(
        await recordEntry(
          atInstant(app, localInstant(day(n))),
          { userId: m.userId },
          {
            seasonId: given.season.id,
            commitmentId: c.id,
            value: { kind: "done" },
            clientRequestId: `${i}-${n}`,
          },
        ),
      ).toMatchObject({ ok: true });
    }
    expect((await started(2)).standings.rows.map((r) => [r.memberId, r.rank, r.points])).toEqual([
      ["m-0", 1, 71],
      ["m-1", 2, 36],
      ["m-2", 2, 36],
      ["m-3", 4, 0],
      ["m-4", 4, 0],
      ["m-5", 4, 0],
    ]);
  });
});
