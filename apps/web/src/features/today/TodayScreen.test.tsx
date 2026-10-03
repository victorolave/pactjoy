import type { TodayView } from "@pactjoy/app";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  noCircleTodayFixture,
  noSeasonTodayFixture,
  pactOpenTodayFixture,
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
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar Hoy");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar Hoy");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
