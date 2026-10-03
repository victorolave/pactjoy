import type { TodayView } from "@pactjoy/app";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
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
import { renderApp } from "../../testing/render.tsx";

const renderToday = (today: TodayView) => renderApp({ path: "/", today });

describe("Today without a season (TO-R1)", () => {
  it("noCircle shows the empty state and nothing else (TO-S1)", async () => {
    renderToday(noCircleTodayFixture());
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Para hoy/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("noSeason shows the circle name (TO-S2)", async () => {
    renderToday(noSeasonTodayFixture());
    expect(
      await screen.findByRole("heading", { name: "Todavía no hay temporada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Los de siempre")).toBeInTheDocument();
  });

  it("pactOpen shows the season summary, with no rows and no register control (TO-S3)", async () => {
    renderToday(pactOpenTodayFixture());
    expect(
      await screen.findByRole("heading", { name: "El pacto sigue abierto" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Temporada de 4 semanas")).toBeInTheDocument();
    expect(screen.getByText("Empieza el lunes 28 de septiembre")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Para hoy/)).not.toBeInTheDocument();
  });

  it("notStarted tells the start date (TO-S4)", async () => {
    renderToday({ ...pactOpenTodayFixture(), state: "notStarted" } as TodayView);
    expect(
      await screen.findByRole("heading", { name: "Tu temporada aún no empieza" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Empieza el lunes 28 de septiembre.")).toBeInTheDocument();
  });
});

describe("Today with a season", () => {
  it("greets the viewer by name and says the day and week (TO-R2)", async () => {
    renderToday(activeTodayFixture());
    expect(await screen.findByRole("heading", { name: "Hola, Victor" })).toBeInTheDocument();
    expect(screen.getByText("Viernes 2 de octubre · Semana 1 de 4")).toBeInTheDocument();
  });

  it("falls back to a neutral greeting when the viewer has no name in the standings", async () => {
    renderToday(
      activeTodayFixture({
        standings: {
          kind: "ranked",
          eligibleParticipantCount: 1,
          rows: activeTodayFixture().standings.rows.filter((row) => row.displayName !== "Victor"),
        },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Hola" })).toBeInTheDocument();
  });
});

const dayRow = (
  habitName: string,
  state: DayRow["opportunity"]["state"],
  overrides: Partial<DayRow> = {},
) =>
  dayRowFixture({
    habitName,
    opportunity: { state, graceUntil: null },
    ...(state === "logged" ? { entries: [entryFixture({ kind: "done" })] } : {}),
    ...overrides,
  });

describe("Today active: rows (TO-R3, TO-R4, TO-R5)", () => {
  it("counts the day rows registered of those scheduled today (TO-S5)", async () => {
    renderToday(
      activeTodayFixture({
        rows: [dayRow("Meditar", "logged"), dayRow("Dibujar", "open"), dayRow("Correr", "open")],
      }),
    );
    expect(await screen.findByRole("heading", { name: "Para hoy" })).toBeInTheDocument();
    expect(screen.getByText("1 de 3 registrados")).toBeInTheDocument();
    expect(screen.getByText("¿Qué quieres cumplir hoy?")).toBeInTheDocument();
    for (const name of ["Meditar", "Dibujar", "Correr"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("does not count a day that does not fall today as pending, and lists it under the week", async () => {
    renderToday(
      activeTodayFixture({
        rows: [dayRow("Meditar", "logged"), dayRow("Yoga", "open", { scheduledToday: false })],
      }),
    );
    expect(await screen.findByText("1 de 1 registrados")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esta semana" })).toBeInTheDocument();
    expect(screen.getByText("No toca hoy")).toBeInTheDocument();
  });

  it("celebrates quietly when everything for today is registered (15b)", async () => {
    renderToday(
      activeTodayFixture({ rows: [dayRow("Meditar", "logged"), dayRow("Dibujar", "logged")] }),
    );
    expect(await screen.findByText("Hoy ya está cumplido.")).toBeInTheDocument();
    expect(screen.getByText("2 de 2 compromisos de hoy")).toBeInTheDocument();
    expect(screen.getByText("Meditar y Dibujar.")).toBeInTheDocument();
    expect(screen.queryByText("¿Qué quieres cumplir hoy?")).not.toBeInTheDocument();
  });

  it("explains a day with nothing scheduled and keeps the week visible (15c)", async () => {
    renderToday(activeTodayFixture({ rows: [weekRowFixture()] }));
    expect(
      await screen.findByRole("heading", { name: "Hoy no tienes compromisos previstos." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Para hoy" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esta semana" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3 esta semana")).toBeInTheDocument();
  });

  it("shows the week rows with their progress under Esta semana (TO-S7)", async () => {
    renderToday(activeTodayFixture({ rows: [dayRow("Meditar", "open"), weekRowFixture()] }));
    expect(await screen.findByRole("heading", { name: "Esta semana" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3 esta semana")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
  });

  it("shows a paused row read-only, with no control (TO-S8)", async () => {
    renderToday(activeTodayFixture({ rows: [dayRow("Gym", "paused"), dayRow("Meditar", "open")] }));
    expect(await screen.findByText("En pausa")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks the viewer's private commitments (TO-R8)", async () => {
    renderToday(activeTodayFixture({ rows: [dayRow("Terapia", "open", { privacy: "private" })] }));
    expect(await screen.findByText("Privado")).toBeInTheDocument();
  });
});

describe("Today active: season and standings (TO-R6, TO-R7)", () => {
  it("shows the season card and the standings pair", async () => {
    renderToday(activeTodayFixture());
    expect(await screen.findByText("Tu temporada")).toBeInTheDocument();
    expect(screen.getByText("540")).toBeInTheDocument();
    expect(screen.getByText("Consistencia 75 %")).toBeInTheDocument();
    expect(screen.getByText("Quedan 23 días")).toBeInTheDocument();
    expect(screen.getByText("Andrea 620 · Tú 540")).toBeInTheDocument();
    expect(screen.getByText("80 pts de diferencia")).toBeInTheDocument();
  });

  it("shows only the viewer when they are the only participant", async () => {
    renderToday(
      activeTodayFixture({
        standings: {
          kind: "ranked",
          eligibleParticipantCount: 1,
          rows: activeTodayFixture().standings.rows.filter((row) => row.displayName === "Victor"),
        },
      }),
    );
    expect(await screen.findByText("Tú 540 pts")).toBeInTheDocument();
    expect(screen.queryByText(/de diferencia/)).not.toBeInTheDocument();
  });
});

describe("Today ended (TO-R6, TO-S9)", () => {
  it("shows an ended banner and no pending prompt", async () => {
    renderToday(endedTodayFixture());
    expect(await screen.findByText("Temporada terminada")).toBeInTheDocument();
    expect(screen.getByText("La temporada terminó")).toBeInTheDocument();
    expect(screen.queryByText("¿Qué quieres cumplir hoy?")).not.toBeInTheDocument();
    expect(screen.queryByText("Hoy no tienes compromisos previstos.")).not.toBeInTheDocument();
    expect(screen.getByText("Tu temporada")).toBeInTheDocument();
  });
});

describe("loading and failure (TO-R9)", () => {
  it("shows a skeleton while the query is pending (TO-S10)", () => {
    renderToday(noCircleTodayFixture());
    const loading = screen.getByRole("status", { name: "Cargando Hoy" });
    expect(loading).toHaveAttribute("aria-busy", "true");
  });

  it("shows the error with Reintentar, and a click refetches and renders (TO-S11)", async () => {
    const { deps } = renderApp({
      today: noCircleTodayFixture(),
      todayFailures: [new ApiError("Internal", 500, "req-1")],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu día.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(deps.api.calls.getToday).toBe(2);
  });

  it("explains a failure that a retry cannot fix, without offering one", async () => {
    renderApp({
      today: noCircleTodayFixture(),
      todayFailures: [new ApiError("InvalidRequest", 400, "req-3")],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("shows a connection failure as retryable", async () => {
    renderApp({
      today: noCircleTodayFixture(),
      todayFailures: [new ApiError("NetworkError", 0, null)],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu día.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
