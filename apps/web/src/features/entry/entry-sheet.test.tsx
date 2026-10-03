import type { TodayRow } from "@pactjoy/app";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
  pointsFixture,
  type WeekRow,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const reading = (overrides: Partial<WeekRow> = {}) => weekRowFixture(overrides);

const running = (overrides: Partial<DayRow> = {}) =>
  dayRowFixture({
    commitmentId: "commitment-3" as DayRow["commitmentId"],
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "decimal",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 4] } },
    },
    ...overrides,
  });

/** Leer as a day-bound row (specific days): it counts at once, so its sheet previews points. */
const readingDay = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-2" as DayRow["commitmentId"],
    habitName: "Leer",
    measure: {
      unit: "minutes",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "10", ideal: "30" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
    },
    points: pointsFixture({ perOpportunity: "6.25", earned: null, limitPercents: null }),
    ...overrides,
  });

const english = (): WeekRow =>
  weekRowFixture({
    commitmentId: "commitment-4" as WeekRow["commitmentId"],
    habitName: "Inglés",
    measure: {
      unit: "minutes",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "60", ideal: "150" },
      schedule: { period: "weeklyTotal" },
    },
    progress: {
      value: "90",
      target: { direction: "reach", minimum: "60", ideal: "150" },
      sessionsDone: 0,
      sessionsTarget: 1,
      percent: 40,
    },
  });

const renderRows = (rows: TodayRow[], path = "/") =>
  renderApp({ path, today: activeTodayFixture({ rows }) });

describe("opening the entry sheet (EN-R3)", () => {
  it("opens from the plus of an open quantity row, and the URL says which (back closes it)", async () => {
    const app = renderRows([reading()]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Leer" }));
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    expect(app.location()).toBe("/?entry=commitment-2");
    app.back();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(app.location()).toBe("/");
  });

  it("opens straight from a link with the commitment in it", async () => {
    renderRows([reading()], "/?entry=commitment-2");
    expect(await screen.findByRole("dialog", { name: "Leer" })).toBeInTheDocument();
  });

  it("shows no sheet for a commitment that is not in Today", async () => {
    renderRows([reading()], "/?entry=commitment-404");
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and goes back to Today", async () => {
    const app = renderRows([reading()]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Leer" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(app.location()).toBe("/");
  });

  it("closes from a link without leaving the app", async () => {
    const app = renderRows([reading()], "/?entry=commitment-2");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(app.location()).toBe("/");
  });

  it("offers the plus on day and week quantity rows, not on done rows or rows that cannot be written", async () => {
    renderRows([
      reading(),
      running(),
      running({
        commitmentId: "c-x" as DayRow["commitmentId"],
        habitName: "Cerrado",
        opportunity: { state: "closed", graceUntil: null },
      }),
      dayRowFixture({ habitName: "Meditar" }),
    ]);
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.getByRole("button", { name: "Registrar Leer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Correr" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar Cerrado" })).not.toBeInTheDocument();
    // The done row has the one-tap check, not the sheet: tapping it records, it does not open one.
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeInTheDocument();
  });
});

describe("the quantity form (EN-R3)", () => {
  it("starts on the midpoint, and the shortcuts and stepper change it", async () => {
    renderRows([reading()], "/?entry=commitment-2");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    expect(input).toHaveValue("20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    expect(input).toHaveValue("25");
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    expect(input).toHaveValue("10");
    await userEvent.click(within(dialog).getByRole("button", { name: "Menos" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Menos" }));
    expect(input).toHaveValue("0");
  });

  it("says the thresholds, and shows the typed value against the ideal", async () => {
    renderRows([reading()], "/?entry=commitment-2");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByText("Hoy · mínimo 10 min, ideal 30 min")).toBeInTheDocument();
    expect(within(dialog).getByText("20 / 30 min")).toBeInTheDocument();
    expect(within(dialog).getByText("Mínimo cumplido · 67 % del ideal")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    expect(within(dialog).getByText("25 / 30 min")).toBeInTheDocument();
  });

  it("previews the points of the draft from the server's value of one opportunity (design 17)", async () => {
    renderRows([readingDay()], "/?entry=commitment-2");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    // 20 of 30 min: round(6.25 x 2/3) = 4.
    expect(within(dialog).getByText("+4 pts")).toBeInTheDocument();
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    expect(within(dialog).getByText("0 pts")).toBeInTheDocument();
    expect(
      within(dialog).getByText("5 min más para el mínimo. Aún no cuenta para tu consistencia."),
    ).toBeInTheDocument();
  });

  it("adds on top of what is logged today: +N, the running total and 'Añadir' (design 22)", async () => {
    renderRows(
      [
        readingDay({
          entries: [entryFixture({ kind: "quantity", value: "25" })],
          opportunity: { state: "logged", graceUntil: null },
        }),
      ],
      "/?entry=commitment-2",
    );
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByText("Llevas 25 min hoy")).toBeInTheDocument();
    expect(within(dialog).getByText("+")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("10");
    expect(within(dialog).getByText("25 + 10 = 35 / 30 min")).toBeInTheDocument();
    expect(within(dialog).getByText("+1 pt")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Ideal alcanzado. Por encima de 30 min no suma más puntos."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Añadir 10 min" })).toBeInTheDocument();
  });

  it("puts the unit right after the number, which is as wide as what is typed", async () => {
    renderRows([reading()], "/?entry=commitment-2");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    expect(input.nextElementSibling).toHaveTextContent("min");
    expect(input.getAttribute("style")).toContain("width: 3ch");
  });

  it("does not offer Hoy no salió in a quantity sheet (design 17)", async () => {
    renderRows([running()], "/?entry=commitment-3");
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    expect(within(dialog).queryByRole("button", { name: "Hoy no salió" })).not.toBeInTheDocument();
  });

  it("steps decimals exactly", async () => {
    renderRows([running()], "/?entry=commitment-3");
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    expect(input).toHaveValue("4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    // Decimals read with a comma, like the rest of the app.
    expect(input).toHaveValue("4,5");
  });

  it("marks a value that cannot be sent as invalid", async () => {
    renderRows([reading()], "/?entry=commitment-2");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    expect(input).toHaveAttribute("aria-invalid", "true");
    await userEvent.clear(input);
    await userEvent.type(input, "15");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("weekly total sheet (EN-R4, EN-S10)", () => {
  it("previews 'a → b / ideal' with the week's figure from the server, and no points (design 17b)", async () => {
    renderRows([english()], "/?entry=commitment-4");
    const dialog = await screen.findByRole("dialog", { name: "Inglés" });
    expect(within(dialog).getByText("Esta semana llevas 90 min")).toBeInTheDocument();
    expect(within(dialog).getByText("90 → 120 / 150 min")).toBeInTheDocument();
    expect(within(dialog).getByText("Progreso de la semana")).toBeInTheDocument();
    expect(
      within(dialog).getByText("80 % del ideal semanal · te faltarían 30 min"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/pts/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Durante la semana solo se muestra el progreso. Los puntos se asignan al cerrar la semana.",
      ),
    ).toBeInTheDocument();
  });

  it("moves the new total, not the week's figure, while the user steps the number", async () => {
    renderRows([english()], "/?entry=commitment-4");
    const dialog = await screen.findByRole("dialog", { name: "Inglés" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    expect(within(dialog).getByText("90 → 125 / 150 min")).toBeInTheDocument();
  });

  it("draws the week's two layers: the new total and what was already there", async () => {
    renderRows([english()], "/?entry=commitment-4");
    const dialog = await screen.findByRole("dialog", { name: "Inglés" });
    const bar = within(dialog).getByRole("progressbar", { name: "Cantidad de Inglés" });
    expect(bar.children).toHaveLength(3);
    expect(bar.children[0]).toHaveStyle({ width: "80%" });
    expect(bar.children[1]).toHaveStyle({ width: "60%" });
  });

  it("starts on 30 with 15, 30 and 45 as shortcuts", async () => {
    renderRows([english()], "/?entry=commitment-4");
    const dialog = await screen.findByRole("dialog", { name: "Inglés" });
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("30");
    for (const preset of ["15 min", "30 min", "45 min"]) {
      expect(within(dialog).getByRole("button", { name: preset })).toBeInTheDocument();
    }
  });

  it("starts a week with nothing logged at zero progress", async () => {
    const row = english();
    renderRows(
      [
        {
          ...row,
          progress: row.progress === null ? null : { ...row.progress, value: null, percent: 0 },
        },
      ],
      "/?entry=commitment-4",
    );
    const dialog = await screen.findByRole("dialog", { name: "Inglés" });
    expect(within(dialog).getByText("Esta semana llevas 0 min")).toBeInTheDocument();
    expect(within(dialog).getByText("0 → 30 / 150 min")).toBeInTheDocument();
  });
});
