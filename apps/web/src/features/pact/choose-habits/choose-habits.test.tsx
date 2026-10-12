import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { CarryOverDto, HabitDto, SeasonDto } from "../../../ports/wire.ts";
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
    graduatedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    version: 1,
  },
  {
    id: "h-leer",
    name: "Leer",
    why: "Aprender",
    category: "Mente",
    icon: "book",
    graduatedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    version: 1,
  },
  {
    id: "h-caminar",
    name: "Caminar",
    why: "Moverse",
    category: "Salud",
    icon: "footprints",
    graduatedAt: null,
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
  it("redirects a closed pact to its screen without showing editable habits", async () => {
    const { location, deps } = renderChooseHabits({
      season: { ...seasonFixture(), status: "active" },
    });
    expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeVisible();
    expect(location()).toBe("/season/s-1/pact");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(deps.api.calls.removeCommitment).toBe(0);
  });

  it("lets the pact flow send an ended season onward to Today", async () => {
    const { location } = renderChooseHabits({ season: { ...seasonFixture(), status: "closed" } });
    expect(await screen.findByRole("heading", { name: /^Hola/ })).toBeVisible();
    expect(location()).toBe("/");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

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

  it.each([5, 6])("WF-R4: %i selected habits do not impose a hard limit", async (count) => {
    const season = seasonFixture();
    const template = season.commitments.find((commitment) => commitment.kind === "detail");
    if (!template) throw new Error("fixture commitment missing");
    const habits = ["Leer", "Meditar", "Caminar", "Dibujar", "Estudiar", "Dormir"].map(
      (name, index): HabitDto => ({
        id: `habit-${index}`,
        name,
        why: null,
        category: null,
        icon: "book",
        graduatedAt: null,
        createdAt: "2026-10-01T12:00:00.000Z",
        version: 0,
      }),
    );
    const { location } = renderChooseHabits({
      habits,
      season: {
        ...season,
        commitments: habits.slice(0, count).map((habit, index) => ({
          ...template,
          id: `commitment-${index}`,
          habitId: habit.id,
          habit: { name: habit.name, icon: habit.icon },
          weightPercent: index < 2 ? 20 : 15,
        })),
      },
    });

    expect(
      await screen.findByText(`${count} compromisos elegidos. Sugerimos entre 2 y 5.`),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(count);
    for (const habit of habits.slice(0, count)) {
      expect(screen.getByRole("checkbox", { name: habit.name })).toBeChecked();
    }
    if (count === 5) {
      const sixth = screen.getByRole("checkbox", { name: "Dormir" });
      expect(sixth).not.toBeChecked();
      expect(sixth).toBeEnabled();
      await userEvent.click(sixth);
      expect(location()).toBe("/season/s-1/habits/new?habitId=habit-5");
      return;
    }
    const continueButton = screen.getByRole("button", { name: "Repartir pesos" });
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);
    expect(location()).toBe("/season/s-1/weights");
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

describe("carry-over from the previous season (season-close-graduation, owner decision 4)", () => {
  const habit = (id: string, name: string, graduatedAt: string | null = null): HabitDto => ({
    id,
    name,
    why: null,
    category: null,
    icon: null,
    graduatedAt,
    createdAt: "2026-08-01T12:00:00.000Z",
    version: 1,
  });
  const minutes = {
    unit: "minutes",
    customLabel: null,
    precision: "integer",
    target: { direction: "reach", minimum: "10", ideal: "30" },
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 5 } },
  } as const;
  const item = (
    habitId: string,
    decision: "continue" | "adjust" | "pause",
    weightPercent = 30,
  ): CarryOverDto["items"][number] => ({
    habitId,
    decision,
    previous: { measure: minutes, weightPercent, privacy: "private" },
  });
  const habits = [
    habit("h-estudiar", "Estudiar"),
    habit("h-dibujar", "Dibujar"),
    habit("h-nadar", "Nadar"),
    habit("h-leer", "Leer", "2026-10-01T12:00:00.000Z"),
  ];
  // The viewer has no commitment yet in the new pact.
  const emptySeason = (): SeasonDto => ({ ...seasonFixture(), commitments: [] });

  function render(carryOver: CarryOverDto) {
    const app = renderChooseHabits({ season: emptySeason(), habits });
    app.deps.api.setCarryOver("s-1", carryOver);
    return app;
  }
  const full: CarryOverDto = {
    previousSeasonId: "s-0",
    items: [
      item("h-estudiar", "continue"),
      item("h-dibujar", "adjust", 20),
      item("h-nadar", "pause"),
    ],
  };

  it("offers the habits to continue or adjust in their own group, with nothing created yet", async () => {
    const { deps } = render(full);
    const group = await screen.findByRole("region", { name: "De tu temporada anterior" });
    const estudiar = within(group).getByRole("listitem", { name: "Estudiar" });
    expect(estudiar).toHaveTextContent("5 veces por semana · mín. 10 · ideal 30 min");
    expect(within(estudiar).getByRole("button", { name: "Seguir igual" })).toBeEnabled();
    const dibujar = within(group).getByRole("listitem", { name: "Dibujar" });
    expect(within(dibujar).getByRole("button", { name: "Ajustar" })).toBeEnabled();
    expect(within(group).queryByText("Nadar")).not.toBeInTheDocument();
    expect(deps.api.calls.addCommitment).toBe(0);
    expect(screen.getByText("0 compromisos elegidos. Sugerimos entre 2 y 5.")).toBeVisible();
  });

  it("Seguir igual adds the commitment with the previous measure, weight and privacy in one tap", async () => {
    const { deps } = render(full);
    const added: SeasonDto = {
      ...emptySeason(),
      version: 2,
      commitments: [
        {
          id: "c-estudiar",
          memberId: "member-victor",
          habitId: "h-estudiar",
          weightPercent: 30,
          privacy: "private",
          kind: "detail",
          measure: minutes,
          habit: { name: "Estudiar", icon: null },
        },
      ],
    };
    const group = await screen.findByRole("region", { name: "De tu temporada anterior" });
    deps.api.setPactResponse("addCommitment", added);
    deps.api.setPactResponse("getSeason", added);
    await userEvent.click(
      within(within(group).getByRole("listitem", { name: "Estudiar" })).getByRole("button", {
        name: "Seguir igual",
      }),
    );
    expect(await screen.findByRole("checkbox", { name: "Estudiar" })).toBeChecked();
    const command = deps.api.pactCommands.find((c) => c.method === "addCommitment");
    expect(command?.args[0]).toBe("s-1");
    expect(command?.args[1]).toMatchObject({
      habitId: "h-estudiar",
      weightPercent: 30,
      privacy: "private",
      measure: { unit: "minutes", minimum: "10", ideal: "30" },
    });
    expect(deps.api.calls.addCommitment).toBe(1);
    expect(
      within(screen.getByRole("region", { name: "De tu temporada anterior" })).queryByText(
        "Estudiar",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps the row and says so when Seguir igual fails", async () => {
    const { deps } = render(full);
    deps.api.failNext("addCommitment", new ApiError("InternalError", 500, null));
    await userEvent.click(await screen.findByRole("button", { name: "Seguir igual" }));
    expect(
      await screen.findByText("No pudimos agregar el compromiso. Inténtalo de nuevo."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Seguir igual" })).toBeEnabled();
  });

  it("Ajustar opens the wizard for that habit, prefilled and not yet a commitment", async () => {
    const { deps, location } = render(full);
    const group = await screen.findByRole("region", { name: "De tu temporada anterior" });
    await userEvent.click(within(group).getByRole("button", { name: "Ajustar" }));
    expect(location()).toBe("/season/s-1/habits/new?habitId=h-dibujar");
    expect(await screen.findByRole("textbox", { name: "Nombre" })).toHaveValue("Dibujar");
    expect(deps.api.calls.addCommitment).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("radio", { name: "Minutos" })).toHaveAttribute("aria-checked", "true");
  });

  it("lists a paused habit as a normal unchecked row with a hint, never preselected", async () => {
    const { deps } = render(full);
    const nadar = await screen.findByRole("checkbox", { name: "Nadar" });
    expect(nadar).not.toBeChecked();
    expect(await screen.findByText("La dejaste en pausa")).toBeVisible();
    expect(deps.api.calls.addCommitment).toBe(0);
    await userEvent.click(nadar);
    expect(await screen.findByRole("textbox", { name: "Nombre" })).toHaveValue("Nadar");
  });

  it("never offers a graduated habit", async () => {
    render(full);
    await screen.findByRole("checkbox", { name: "Nadar" });
    expect(screen.queryByText("Leer")).not.toBeInTheDocument();
  });

  it.each([
    ["a member who never closed, or a first season", { previousSeasonId: null, items: [] }],
    ["a laggard cut off without decisions", { previousSeasonId: "s-0", items: [] }],
  ] as const)("shows no group for %s", async (_name, carryOver) => {
    render(carryOver);
    await screen.findByRole("checkbox", { name: "Nadar" });
    expect(screen.queryByRole("region", { name: "De tu temporada anterior" })).toBeNull();
    expect(screen.queryByText("La dejaste en pausa")).not.toBeInTheDocument();
  });

  it("works as before when the defaults cannot be read", async () => {
    const app = renderChooseHabits({ season: emptySeason(), habits });
    app.deps.api.failNext("getCarryOver", new ApiError("NetworkError", 0, null));
    expect(await screen.findByRole("checkbox", { name: "Nadar" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "De tu temporada anterior" })).toBeNull();
  });
});
