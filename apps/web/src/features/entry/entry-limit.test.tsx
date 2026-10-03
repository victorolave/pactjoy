import type { TodayRow } from "@pactjoy/app";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  type WeekRow,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const coffee = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-5" as DayRow["commitmentId"],
    habitName: "Café",
    measure: {
      unit: "times",
      customLabel: null,
      precision: "integer",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    },
    ...overrides,
  });

const sweets = (): WeekRow =>
  weekRowFixture({
    commitmentId: "commitment-6" as WeekRow["commitmentId"],
    habitName: "Dulces",
    measure: {
      unit: "times",
      customLabel: null,
      precision: "integer",
      target: { direction: "limit", ideal: "3", tolerance: "6" },
      schedule: { period: "weeklyTotal" },
    },
    progress: {
      value: "2",
      target: { direction: "limit", ideal: "3", tolerance: "6" },
      sessionsDone: 0,
      sessionsTarget: 1,
      percent: 100,
    },
  });

const hours = (): DayRow =>
  coffee({
    commitmentId: "commitment-7" as DayRow["commitmentId"],
    habitName: "Pantalla",
    measure: {
      unit: "hours",
      customLabel: null,
      precision: "decimal",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
    },
  });

const open = (rows: TodayRow[], id: string) =>
  renderApp({ path: `/?entry=${id}`, today: activeTodayFixture({ rows }) });

describe("limit sheet (EN-R5)", () => {
  it("opens from the plus of an open limit row", async () => {
    renderApp({ today: activeTodayFixture({ rows: [coffee(), sweets()] }) });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Café" }));
    expect(await screen.findByRole("dialog", { name: "Café" })).toBeInTheDocument();
  });

  it("asks how many, and says the thresholds and that 0 counts", async () => {
    open([coffee()], "commitment-5");
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(within(dialog).getByText("Registra lo de hoy, aunque sea 0.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("ideal hasta 2, tolerancia hasta 4 veces."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radiogroup", { name: "Cantidad de veces" }),
    ).toBeInTheDocument();
  });

  it("shows what each option scores, from the server, and 5+ for the open end (design 18)", async () => {
    const row = coffee();
    open(
      [
        {
          ...row,
          points: {
            ...row.points,
            limitPercents: [100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        },
      ],
      "commitment-5",
    );
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(
      within(dialog).getByText(
        "ideal hasta 2, tolerancia hasta 4 veces. Cada opción muestra lo que puntúa antes de elegirla.",
      ),
    ).toBeInTheDocument();
    const options = within(dialog)
      .getAllByRole("radio")
      .map((radio) => radio.textContent);
    expect(options).toEqual(["0100 %", "1100 %", "2100 %", "375 %", "450 %", "5+0 %"]);
  });

  it("sends the chosen option as the quantity (EN-S9)", async () => {
    const { deps } = open([coffee()], "commitment-5");
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /^3/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 3 veces" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]).toMatchObject({
      commitmentId: "commitment-5",
      value: { kind: "quantity", value: "3" },
      note: null,
    });
  });

  it("registers an explicit 0 as a real value", async () => {
    const { deps } = open([coffee()], "commitment-5");
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /^0/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 0 veces" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "0" });
  });

  it("will not submit until an option is chosen", async () => {
    const { deps } = open([coffee()], "commitment-5");
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(within(dialog).getByRole("button", { name: "Registrar" })).toBeDisabled();
    expect(deps.api.calls.recordEntry).toBe(0);
  });

  it("never offers Hoy no salió on a limit: the real value, including 0, is logged", async () => {
    open([coffee()], "commitment-5");
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(within(dialog).queryByRole("button", { name: "Hoy no salió" })).not.toBeInTheDocument();
  });

  it("works for a weekly limit total and shows the server's week", async () => {
    const { deps } = open([sweets()], "commitment-6");
    const dialog = await screen.findByRole("dialog", { name: "Dulces" });
    expect(within(dialog).getByText("Esta semana llevas 2 veces")).toBeInTheDocument();
    // A weekly total is not a day's pick from a grid: it is a number to add.
    expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 1 vez" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "1" });
  });

  it("uses a stepper when the tolerance outgrows the grid (limit 14, tolerance 20)", async () => {
    const wide = coffee({
      commitmentId: "commitment-8" as DayRow["commitmentId"],
      habitName: "Cigarros",
      measure: {
        unit: "times",
        customLabel: null,
        precision: "integer",
        target: { direction: "limit", ideal: "14", tolerance: "20" },
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
      },
    });
    const { deps } = open([wide], "commitment-8");
    const dialog = await screen.findByRole("dialog", { name: "Cigarros" });
    expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "17");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 17 veces" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "17" });
  });

  it("uses a stepper that allows 0 for a decimal limit", async () => {
    const { deps } = open([hours()], "commitment-7");
    const dialog = await screen.findByRole("dialog", { name: "Pantalla" });
    expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    expect(input).toHaveValue("0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    expect(input).toHaveValue("0,5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Menos" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 0 h" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "quantity", value: "0" });
  });
});
