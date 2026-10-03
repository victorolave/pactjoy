import type { TodayView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  endedTodayFixture,
  noCircleTodayFixture,
  noSeasonTodayFixture,
  pactOpenTodayFixture,
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

  it("carries the rows through untouched for the sections that render them", () => {
    const rows = [dayRowFixture()];
    expect(toTodayModel(activeTodayFixture({ rows }))).toMatchObject({ rows });
  });
});
