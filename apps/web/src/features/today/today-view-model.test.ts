import type { OpportunityState, TodayView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  endedTodayFixture,
  entryFixture,
  noCircleTodayFixture,
  noSeasonTodayFixture,
  pactOpenTodayFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { toTodayModel } from "./today-view-model.ts";

describe("toTodayModel: states without a season", () => {
  it("noCircle carries nothing", () => {
    expect(toTodayModel(noCircleTodayFixture())).toEqual({ kind: "noCircle" });
  });

  it("noSeason carries the circle name", () => {
    expect(toTodayModel(noSeasonTodayFixture())).toEqual({
      kind: "noSeason",
      circleName: "Los de siempre",
    });
  });
});

describe("toTodayModel: pact open and not started", () => {
  it("pactOpen shows the circle, the season length and the nominal start", () => {
    expect(toTodayModel(pactOpenTodayFixture())).toEqual({
      kind: "pactOpen",
      circleName: "Los de siempre",
      lengthWeeks: 4,
      startDate: "2026-09-28",
    });
  });

  it("notStarted starts on the actual start when there is one", () => {
    const pactOpen = pactOpenTodayFixture();
    const view = {
      ...pactOpen,
      state: "notStarted",
      season: { ...pactOpen.season, actualStart: "2026-10-05" as typeof pactOpen.today },
    } as TodayView;
    expect(toTodayModel(view)).toMatchObject({ kind: "notStarted", startDate: "2026-10-05" });
  });

  it("notStarted falls back to the nominal start when the actual start is not set", () => {
    const view = { ...pactOpenTodayFixture(), state: "notStarted" } as TodayView;
    expect(toTodayModel(view)).toMatchObject({ kind: "notStarted", startDate: "2026-09-28" });
  });
});

describe("toTodayModel: active and ended", () => {
  it("greets the viewer by the display name found in the standings (TO-R2)", () => {
    expect(toTodayModel(activeTodayFixture())).toMatchObject({
      kind: "active",
      greetingName: "Victor",
    });
  });

  it("greets by the name of whoever the viewer is, not by position", () => {
    const view = activeTodayFixture({
      standings: {
        kind: "ranked",
        eligibleParticipantCount: 2,
        rows: [
          ...activeTodayFixture().standings.rows.map((row) =>
            row.displayName === "Victor" ? { ...row, displayName: "Vic" } : row,
          ),
        ],
      },
    });
    expect(toTodayModel(view)).toMatchObject({ greetingName: "Vic" });
  });

  it("has no greeting name when the viewer is missing from the standings", () => {
    const view = activeTodayFixture({
      standings: {
        kind: "ranked",
        eligibleParticipantCount: 1,
        rows: activeTodayFixture().standings.rows.filter((row) => row.displayName !== "Victor"),
      },
    });
    expect(toTodayModel(view)).toMatchObject({ kind: "active", greetingName: null });
  });

  it("describes the day and the week", () => {
    expect(toTodayModel(activeTodayFixture())).toMatchObject({
      dateLabel: "Viernes 2 de octubre",
      weekLabel: "Semana 1 de 4",
    });
  });

  it("keeps the ended kind and describes the last week", () => {
    expect(toTodayModel(endedTodayFixture())).toMatchObject({
      kind: "ended",
      weekLabel: "Semana 4 de 4",
    });
  });
});

const running = (view: TodayView) => {
  const model = toTodayModel(view);
  if (model.kind !== "active" && model.kind !== "ended") throw new Error("not a running model");
  return model;
};

const row = (state: OpportunityState, overrides: Partial<DayRow> = {}) =>
  dayRowFixture({ opportunity: { state, graceUntil: null }, ...overrides });

describe("toTodayModel: sections and counts (TO-R3)", () => {
  it("splits day rows scheduled today from other days, and keeps week rows apart", () => {
    const today = dayRowFixture({ habitName: "Hoy" });
    const other = dayRowFixture({ habitName: "Otro día", scheduledToday: false });
    const week = weekRowFixture();
    const { sections } = running(activeTodayFixture({ rows: [today, other, week] }));
    expect(sections.forToday.map((r) => r.habitName)).toEqual(["Hoy"]);
    expect(sections.otherDays.map((r) => r.habitName)).toEqual(["Otro día"]);
    expect(sections.week.map((r) => r.habitName)).toEqual(["Leer"]);
  });

  it("counts the logged of the day rows scheduled today (1 of 3)", () => {
    const { counts, dayState } = running(
      activeTodayFixture({ rows: [row("logged"), row("open"), row("open")] }),
    );
    expect(counts).toEqual({ logged: 1, scheduled: 3 });
    expect(dayState).toBe("pending");
  });

  it("carries the server's points for the day, untouched", () => {
    const view = activeTodayFixture({ rows: [row("logged")] });
    const { pointsToday } = running({
      ...view,
      summary: { ...view.summary, pointsToday: 14 },
    });
    expect(pointsToday).toBe(14);
  });

  it("never counts a day not scheduled today as pending", () => {
    const { counts } = running(
      activeTodayFixture({
        rows: [row("logged"), row("open", { scheduledToday: false })],
      }),
    );
    expect(counts).toEqual({ logged: 1, scheduled: 1 });
  });

  it("does not count paused, on-hold or closed rows: nothing can be registered on them", () => {
    const { counts } = running(
      activeTodayFixture({
        rows: [row("open"), row("paused"), row("onHold"), row("closed")],
      }),
    );
    expect(counts).toEqual({ logged: 0, scheduled: 1 });
  });

  it("is allDone when every scheduled row is logged (15b)", () => {
    expect(running(activeTodayFixture({ rows: [row("logged"), row("logged")] })).dayState).toBe(
      "allDone",
    );
  });

  it("is allLogged, not allDone, when a registered day was marked Hoy no salió (B-W2)", () => {
    const missed = row("logged", { entries: [entryFixture({ kind: "missed" })] });
    const done = row("logged", { entries: [entryFixture({ kind: "done" })] });
    expect(running(activeTodayFixture({ rows: [missed, missed] })).dayState).toBe("allLogged");
    expect(running(activeTodayFixture({ rows: [done, missed] })).dayState).toBe("allLogged");
    expect(running(activeTodayFixture({ rows: [done, done] })).dayState).toBe("allDone");
  });

  it("counts a missed entry as registered", () => {
    const missed = row("logged", { entries: [entryFixture({ kind: "missed" })] });
    expect(running(activeTodayFixture({ rows: [missed, row("open")] })).counts).toEqual({
      logged: 1,
      scheduled: 2,
    });
  });

  it("describes today while the season runs, and its last day once it ended (C-W4)", () => {
    expect(running(activeTodayFixture()).refDate).toBe("2026-10-02");
    // 4 weeks from 2026-09-28: the last day is 2026-10-25, though today is 2026-10-27.
    expect(running(endedTodayFixture()).refDate).toBe("2026-10-25");
  });

  it("carries the server's today, to tell entries of another day", () => {
    expect(running(activeTodayFixture()).today).toBe("2026-10-02");
  });

  it("has no day commitments when nothing is scheduled today (15c)", () => {
    const model = running(
      activeTodayFixture({ rows: [row("open", { scheduledToday: false }), weekRowFixture()] }),
    );
    expect(model.counts).toEqual({ logged: 0, scheduled: 0 });
    expect(model.dayState).toBe("none");
  });

  it("has no day commitments with no rows at all", () => {
    expect(running(activeTodayFixture({ rows: [] })).dayState).toBe("none");
  });
});

describe("toTodayModel: season card (TO-R6)", () => {
  it("shows points, consistency, ideal completion, week and days left", () => {
    expect(running(activeTodayFixture()).season).toEqual({
      points: "540",
      consistency: "75 %",
      idealCompletion: "54 %",
      week: 1,
      weekCount: 4,
      weekLabel: "Semana 1 de 4",
      daysLeftLabel: "Quedan 23 días",
    });
  });

  it("shows a dash for a null ideal completion", () => {
    const view = activeTodayFixture();
    const score = view.summary.score;
    if (score.kind !== "scored" || score.scope !== "own") throw new Error("fixture changed");
    const next = activeTodayFixture({
      summary: { ...view.summary, score: { ...score, consistency: null, idealCompletion: null } },
    });
    expect(running(next).season).toMatchObject({ consistency: "-", idealCompletion: "-" });
  });

  it("words days left: one, none, and ended", () => {
    const view = activeTodayFixture();
    const left = (daysLeft: number) =>
      running(activeTodayFixture({ summary: { ...view.summary, daysLeft } })).season.daysLeftLabel;
    expect(left(1)).toBe("Queda 1 día");
    expect(left(0)).toBe("Último día");
    expect(running(endedTodayFixture()).season.daysLeftLabel).toBe("La temporada terminó");
  });
});

describe("toTodayModel: standings pair (TO-R7)", () => {
  const rows = (...entries: Array<[string, number, number]>) => ({
    kind: "ranked" as const,
    eligibleParticipantCount: entries.length,
    rows: entries.map(([displayName, rank, points]) => ({
      memberId: (displayName === "Victor" ? "member-victor" : `member-${displayName}`) as never,
      displayName,
      rank,
      points,
    })),
  });

  it("pairs the viewer with the member just ahead and says the gap", () => {
    const { standings } = running(activeTodayFixture());
    expect(standings).toEqual({
      kind: "pair",
      rank: 2,
      participantCount: 2,
      viewerPoints: 540,
      otherName: "Andrea",
      otherPoints: 620,
      difference: 80,
    });
  });

  it("with three, the viewer second, pairs with rank 1 (TO-S14)", () => {
    const { standings } = running(
      activeTodayFixture({
        standings: rows(["Andrea", 1, 620], ["Victor", 2, 540], ["Lu", 3, 300]),
      }),
    );
    expect(standings).toMatchObject({
      kind: "pair",
      rank: 2,
      participantCount: 3,
      otherName: "Andrea",
      difference: 80,
    });
  });

  it("when the viewer leads, pairs with the member behind", () => {
    const { standings } = running(
      activeTodayFixture({ standings: rows(["Victor", 1, 700], ["Andrea", 2, 650]) }),
    );
    expect(standings).toMatchObject({
      kind: "pair",
      rank: 1,
      otherName: "Andrea",
      otherPoints: 650,
      difference: 50,
    });
  });

  it("shows a zero gap when points are tied", () => {
    const { standings } = running(
      activeTodayFixture({ standings: rows(["Andrea", 1, 500], ["Victor", 1, 500]) }),
    );
    expect(standings).toMatchObject({ kind: "pair", rank: 1, difference: 0 });
  });

  it("with a single participant shows only the viewer", () => {
    const { standings } = running(activeTodayFixture({ standings: rows(["Victor", 1, 540]) }));
    expect(standings).toEqual({ kind: "solo", points: 540 });
  });

  it("shows nothing when the viewer is not ranked", () => {
    const { standings } = running(
      activeTodayFixture({ standings: rows(["Andrea", 1, 620], ["Lu", 2, 300]) }),
    );
    expect(standings).toBeNull();
  });
});
