import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { HabitDto, SeasonDto } from "../../../ports/wire.ts";
import { soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";
import { chosenCommitmentsMessage, commitmentSubtitle } from "./ChooseHabitsScreen.tsx";

const FIXED_DATE_MS = Date.parse("2026-10-06T12:00:00Z");

const habitFixtures: HabitDto[] = [
  {
    id: "h-meditar",
    name: "Meditar",
    why: "Calma",
    category: "Salud",
    icon: "sparkles",
    createdAt: "2026-10-01T12:00:00.000Z",
    version: 1,
  },
  {
    id: "h-leer",
    name: "Leer",
    why: "Aprender",
    category: "Mente",
    icon: "book",
    createdAt: "2026-10-01T12:00:00.000Z",
    version: 1,
  },
  {
    id: "h-caminar",
    name: "Caminar",
    why: "Moverse",
    category: "Salud",
    icon: "footprints",
    createdAt: "2026-10-01T12:00:00.000Z",
    version: 1,
  },
];

const seasonFixture = (id = "s-1"): SeasonDto => ({
  id,
  circleId: "circle-1",
  timeZone: "UTC",
  nominalStart: "2026-10-07",
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  approvals: [],
  pactClosedAt: null,
  createdAt: "2026-10-06T12:00:00.000Z",
  version: 1,
  pactRevision: 0,
  commitments: [
    {
      id: "c-meditar",
      memberId: "member-victor",
      habitId: "h-meditar",
      weightPercent: 50,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "done",
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 3 },
        },
      },
      habit: { name: "Meditar", icon: "sparkles" },
    },
    {
      id: "c-leer",
      memberId: "member-victor",
      habitId: "h-leer",
      weightPercent: 50,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "10", ideal: "30" },
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 5 },
        },
      },
      habit: { name: "Leer", icon: "book" },
    },
    {
      id: "c-andrea",
      memberId: "member-andrea",
      habitId: "h-andrea-1",
      weightPercent: 100,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "done",
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 7 },
        },
      },
      habit: { name: "Correr", icon: "footprints" },
    },
  ],
});

function renderChooseHabits({
  season = seasonFixture(),
  habits = habitFixtures,
  circle = soloCircleFixture(),
} = {}) {
  const result = renderApp({
    path: `/season/${season.id}/habits`,
    myCircle: circle,
    now: FIXED_DATE_MS,
  });
  result.deps.api.setPactResponse("getSeason", season);
  result.deps.api.setPactResponse("listHabits", habits);
  return result;
}

describe("choose habits screen (design 10)", () => {
  it("formats commitment subtitles and counter messages accurately", () => {
    expect(chosenCommitmentsMessage(1)).toBe("1 compromiso elegido. Sugerimos entre 2 y 5.");
    expect(chosenCommitmentsMessage(4)).toBe("4 compromisos elegidos. Sugerimos entre 2 y 5.");

    expect(
      commitmentSubtitle({
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      }),
    ).toBe("3 veces por semana · hecho / no hecho");

    expect(
      commitmentSubtitle({
        unit: "done",
        schedule: {
          period: "perSession",
          frequency: { kind: "specificDays", weekdays: [1, 3, 5] },
        },
      }),
    ).toBe("Mar · jue · sáb");

    expect(
      commitmentSubtitle({
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "10", ideal: "30" },
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 5 } },
      }),
    ).toBe("5 veces por semana · mín. 10 · ideal 30 min");
  });

  it("renders screen 10 header, checked season commitments, and unchecked habits", async () => {
    renderChooseHabits();

    expect(
      await screen.findByRole("heading", { level: 1, name: "¿Qué vas a trabajar esta temporada?" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Temporada de 8 semanas · empieza el miércoles 7"),
    ).toBeInTheDocument();

    // Checked commitments belonging to the viewer
    const meditarCheck = await screen.findByRole("checkbox", { name: "Meditar" });
    expect(meditarCheck).toBeChecked();
    expect(meditarCheck).toHaveAttribute("aria-describedby", "commitment-sub-c-meditar");
    expect(screen.getByText("3 veces por semana · hecho / no hecho")).toBeInTheDocument();

    const leerCheck = screen.getByRole("checkbox", { name: "Leer" });
    expect(leerCheck).toBeChecked();
    expect(leerCheck).toHaveAttribute("aria-describedby", "commitment-sub-c-leer");
    expect(screen.getByText("5 veces por semana · mín. 10 · ideal 30 min")).toBeInTheDocument();

    // Andrea's commitment should not appear as viewer's commitment
    expect(screen.queryByText("Correr")).not.toBeInTheDocument();

    // Unassigned habit is unchecked with no subtitle and accessible hint
    const caminarCheck = screen.getByRole("checkbox", { name: "Caminar" });
    expect(caminarCheck).not.toBeChecked();
    expect(caminarCheck).toHaveAttribute("aria-describedby", "habit-hint-h-caminar");
    expect(screen.getByText("Configurar compromiso para esta temporada")).toBeInTheDocument();

    // Counter recommendation
    expect(screen.getByText("2 compromisos elegidos. Sugerimos entre 2 y 5.")).toBeInTheDocument();

    // CTA enabled with 2 commitments
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeEnabled();
  });

  it("renders a skeleton while queries are loading (CRITICAL 2)", async () => {
    const season = seasonFixture();
    const { deps } = renderChooseHabits({ season });
    const release = deps.api.hold("getSeason");

    // Since getSeason is held, the screen is in loading state
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeDisabled();

    release();
    expect(await screen.findByRole("checkbox", { name: "Meditar" })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });

  it("renders error state when circle or season load fails and supports retry (W3)", async () => {
    const { deps } = renderChooseHabits();
    deps.api.failNext("getSeason", new ApiError("NetworkError", 0, null));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.getByText("Revisa tu conexión e inténtalo de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeDisabled();

    // Click retry
    const retryBtn = screen.getByRole("button", { name: "Reintentar" });
    await userEvent.click(retryBtn);

    expect(await screen.findByRole("checkbox", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("unchecking a commitment calls removeCommitment and moves it to unassigned (W5)", async () => {
    const season = seasonFixture();
    const updatedSeason: SeasonDto = {
      ...season,
      commitments: season.commitments.filter((c) => c.id !== "c-meditar"),
    };
    const { deps } = renderChooseHabits({ season });
    deps.api.setPactResponse("removeCommitment", updatedSeason);

    const meditarCheck = await screen.findByRole("checkbox", { name: "Meditar" });
    expect(meditarCheck).toBeChecked();
    expect(screen.getByText("3 veces por semana · hecho / no hecho")).toBeInTheDocument();

    deps.api.setPactResponse("getSeason", updatedSeason);
    await userEvent.click(meditarCheck);

    expect(deps.api.pactCommands.find((c) => c.method === "removeCommitment")).toEqual({
      method: "removeCommitment",
      args: ["s-1", "c-meditar"],
    });

    // Meditar is now unchecked and moved to unassigned habits (no subtitle)
    await screen.findByText("1 compromiso elegido. Sugerimos entre 2 y 5.");
    const updatedMeditarCheck = screen.getByRole("checkbox", { name: "Meditar" });
    expect(updatedMeditarCheck).not.toBeChecked();
    expect(screen.queryByText("3 veces por semana · hecho / no hecho")).not.toBeInTheDocument();
  });

  it("disables row checkbox and 'Repartir pesos' while removal is pending (W4, CRITICAL 1)", async () => {
    const season = seasonFixture();
    const updatedSeason: SeasonDto = {
      ...season,
      commitments: season.commitments.filter((c) => c.id !== "c-meditar"),
    };
    const { deps } = renderChooseHabits({ season });
    deps.api.setPactResponse("removeCommitment", updatedSeason);

    const meditarCheck = await screen.findByRole("checkbox", { name: "Meditar" });
    expect(meditarCheck).toBeChecked();

    const release = deps.api.hold("removeCommitment");
    deps.api.setPactResponse("getSeason", updatedSeason);

    await userEvent.click(meditarCheck);

    // While pending
    expect(meditarCheck).toBeDisabled();
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeDisabled();

    release();

    // After completion
    await screen.findByText("1 compromiso elegido. Sugerimos entre 2 y 5.");
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeEnabled();
  });

  it("checking an unassigned habit navigates to the commitment wizard prefilled with habitId (OD-1A)", async () => {
    const { location } = renderChooseHabits();

    const caminarCheck = await screen.findByRole("checkbox", { name: "Caminar" });
    await userEvent.click(caminarCheck);

    expect(location()).toBe("/season/s-1/habits/new?habitId=h-caminar");
  });

  it("clicking 'Crear hábito' navigates to the new habit wizard without habitId", async () => {
    const { location } = renderChooseHabits();

    const createBtn = await screen.findByRole("button", { name: "Crear hábito" });
    await userEvent.click(createBtn);

    expect(location()).toBe("/season/s-1/habits/new");
  });

  it("clicking 'Repartir pesos' navigates to the weights screen", async () => {
    const { location } = renderChooseHabits();

    const weightsBtn = await screen.findByRole("button", { name: "Repartir pesos" });
    await userEvent.click(weightsBtn);

    expect(location()).toBe("/season/s-1/weights");
  });

  it("disables 'Repartir pesos' button when there are no season commitments", async () => {
    const emptySeason = { ...seasonFixture(), commitments: [] };
    renderChooseHabits({ season: emptySeason });

    await screen.findByRole("heading", { level: 1, name: "¿Qué vas a trabajar esta temporada?" });
    expect(
      await screen.findByText("0 compromisos elegidos. Sugerimos entre 2 y 5."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repartir pesos" })).toBeDisabled();
  });

  it("shows an error message when removing a commitment fails", async () => {
    const { deps } = renderChooseHabits();
    deps.api.failNext("removeCommitment", new ApiError("InternalError", 500, null));

    const meditarCheck = await screen.findByRole("checkbox", { name: "Meditar" });
    await userEvent.click(meditarCheck);

    expect(
      await screen.findByText("No pudimos quitar el compromiso. Inténtalo de nuevo."),
    ).toBeInTheDocument();
  });

  it("renders the back button to navigate back", async () => {
    renderChooseHabits();

    await screen.findByRole("heading", { level: 1, name: "¿Qué vas a trabajar esta temporada?" });
    const backBtn = screen.getByRole("button", { name: "Volver" });
    expect(backBtn).toBeInTheDocument();
  });
});
