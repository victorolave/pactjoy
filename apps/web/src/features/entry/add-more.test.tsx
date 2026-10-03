import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { coffee, quantity, reading, renderToday } from "../../testing/fixtures/edit-rows.ts";
import { dayRowFixture, entryFixture } from "../../testing/fixtures/today.ts";

describe("adding more to a logged quantity (design 22)", () => {
  it("keeps the plus on a logged reach row while its window is open, next to the edit", async () => {
    renderToday([reading([quantity("25")])]);
    expect(await screen.findByRole("button", { name: "Registrar Leer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Editar registro de Leer" })).toBeInTheDocument();
  });

  it("says how much the day has: 'Llevas 25 min hoy' on the row", async () => {
    renderToday([reading([quantity("25")])]);
    expect(await screen.findByText("2 de 3 esta semana · llevas 25 min hoy")).toBeInTheDocument();
  });

  it("says it on a day row too, for one entry as for several", async () => {
    renderToday([
      dayRowFixture({
        habitName: "Correr",
        measure: {
          unit: "km",
          customLabel: null,
          precision: "integer",
          target: { direction: "reach", minimum: "3", ideal: "5" },
          schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
        },
        entries: [entryFixture({ kind: "quantity", value: "3" })],
        opportunity: { state: "logged", graceUntil: null },
      }),
    ]);
    expect(await screen.findByText("Llevas 3 km hoy")).toBeInTheDocument();
  });

  it("opens the sheet in add mode: what the day has, '+10', 'Añadir 10 min'", async () => {
    renderToday([reading([quantity("25")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByText("Llevas 25 min hoy")).toBeInTheDocument();
    expect(within(dialog).getByText("25 + 10 = 35 / 30 min")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Añadir 10 min" })).toBeInTheDocument();
  });

  it("records the addition as a new entry, never an edit of the first one", async () => {
    const { deps } = renderToday([reading([quantity("25")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir 10 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded).toHaveLength(1);
    expect(deps.api.recorded[0]).toMatchObject({
      commitmentId: "commitment-2",
      value: { kind: "quantity", value: "10" },
    });
    expect(deps.api.edited).toEqual([]);
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("offers no plus once the window has closed", async () => {
    renderToday([
      reading([quantity("25")], { opportunity: { state: "closed", graceUntil: null } }),
    ]);
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByRole("button", { name: "Registrar Leer" })).not.toBeInTheDocument();
  });

  it("does not add a plus to a limit row: a limit is corrected, not summed on a grid", async () => {
    renderToday([coffee([quantity("2", "entry-1")])]);
    await screen.findByRole("heading", { name: "Café" });
    expect(screen.queryByRole("button", { name: "Registrar Café" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar registro de Café" })).toBeInTheDocument();
  });
});
