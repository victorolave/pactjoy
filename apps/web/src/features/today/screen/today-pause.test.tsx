import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  endedTodayFixture,
  todayPauseFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const pausedMeditar = (pause: Parameters<typeof todayPauseFixture>[0] = {}) =>
  dayRowFixture({
    opportunity: { state: "paused", graceUntil: null },
    pause: todayPauseFixture({ endDate: "2026-10-03", endsTomorrow: true, ...pause }),
  });

describe("Today and pauses (screens 29, 30a)", () => {
  it("shows the paused row with its reason and Reanudar, and the 'ends tomorrow' banner", async () => {
    renderApp({ today: activeTodayFixture({ rows: [pausedMeditar(), weekRowFixture()] }) });
    expect(await screen.findByText("En pausa · Viaje")).toBeInTheDocument();
    expect(await screen.findByText("Tu pausa de Meditar termina mañana")).toBeInTheDocument();
    // The row's own Reanudar and the banner's.
    expect(screen.getAllByRole("button", { name: "Reanudar" })).toHaveLength(2);
  });

  it("resumes from the row, refetches Today and lets the member write again", async () => {
    const view = renderApp({
      today: activeTodayFixture({
        rows: [pausedMeditar({ endsTomorrow: false })],
      }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Reanudar" }));
    // What the server answers once the pause is resumed: the row is open again.
    view.deps.api.setToday(activeTodayFixture({ rows: [dayRowFixture()] }));
    await userEvent.click(screen.getByRole("button", { name: "Reanudar hoy" }));
    await waitFor(() => expect(view.deps.api.calls.resumePause).toBe(1));
    expect(await screen.findByRole("button", { name: "Registrar Meditar" })).toBeInTheDocument();
    expect(screen.queryByText(/En pausa/)).not.toBeInTheDocument();
  });

  it("offers 'Pausar un compromiso' while the season runs, and opens the request sheet", async () => {
    renderApp({ today: activeTodayFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Pausar un compromiso" }));
    expect(await screen.findByRole("dialog", { name: "Pausar un compromiso" })).toBeInTheDocument();
  });

  it("does not offer it once the season ended", async () => {
    renderApp({ today: endedTodayFixture() });
    await screen.findByText("Temporada terminada");
    expect(screen.queryByRole("button", { name: "Pausar un compromiso" })).not.toBeInTheDocument();
  });

  it("shows no banner when no pause ends tomorrow", async () => {
    renderApp({
      today: activeTodayFixture({
        rows: [pausedMeditar({ endsTomorrow: false })],
      }),
    });
    await screen.findByText("En pausa · Viaje");
    expect(screen.queryByText(/termina mañana/)).not.toBeInTheDocument();
  });
});
