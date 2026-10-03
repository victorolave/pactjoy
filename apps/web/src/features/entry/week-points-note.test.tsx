import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const NOTE = "Los puntos se asignan al cerrar la semana.";

const reading = (earned: number | null = null) => {
  const row = weekRowFixture();
  return { ...row, points: { perOpportunity: "6.25", earned, limitPercents: null } };
};

describe("week-bound rows do not present points as earned", () => {
  it("keeps the note off the Today row: no points, and nothing said (timesPerWeek)", async () => {
    renderApp({ today: activeTodayFixture({ rows: [reading()] }) });
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("keeps it off a weekly total row too", async () => {
    const total = weekRowFixture({
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "60", ideal: "150" },
        schedule: { period: "weeklyTotal" },
      },
    });
    renderApp({ today: activeTodayFixture({ rows: [total] }) });
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("does not say it on a day-bound row, which counts at once", async () => {
    const day: DayRow = dayRowFixture({ habitName: "Meditar" });
    renderApp({ today: activeTodayFixture({ rows: [day] }) });
    await screen.findByRole("heading", { name: "Meditar" });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it("shows no +N pts on a logged week row", async () => {
    const row = weekRowFixture({
      entries: [entryFixture({ kind: "quantity", value: "30" })],
      opportunity: { state: "logged", graceUntil: null },
    });
    renderApp({ today: activeTodayFixture({ rows: [row] }) });
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByText(/\+\d+ pts/)).not.toBeInTheDocument();
  });

  it("the sheet previews no points for a timesPerWeek session", async () => {
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [reading()] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).queryByText(/\+\d+ pts|\b0 pts/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(NOTE)).toBeInTheDocument();
  });

  it("the confirmation says the same instead of +N pts", async () => {
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [reading()] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const confirmation = await screen.findByText("Registro guardado.");
    expect(confirmation).toBeInTheDocument();
    expect(screen.getByText(/Los puntos se asignan al cerrar la semana\./)).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ pts/)).not.toBeInTheDocument();
  });
});
