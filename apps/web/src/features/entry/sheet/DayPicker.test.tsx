import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
  type PendingItem,
  pendingItemFixture,
  pointsFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const WEEKDAYS: [3, 4] = [3, 4];

const running = (overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-9" as DayRow["commitmentId"],
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: WEEKDAYS } },
    },
    points: pointsFixture({ perOpportunity: "12.5", earned: null, limitPercents: null }),
    ...overrides,
  });

const yesterdayOf = (row: DayRow): PendingItem =>
  pendingItemFixture({
    commitmentId: row.commitmentId as never,
    habitName: row.habitName,
    measure: row.measure,
    points: row.points,
  });

const open = (row: DayRow, item: PendingItem | null = yesterdayOf(row), query = "") =>
  renderApp({
    path: `/?entry=${row.commitmentId}${query}`,
    today: activeTodayFixture({ rows: [row], pendingYesterday: item === null ? [] : [item] }),
  });

const dialogOf = () => screen.findByRole("dialog", { name: "Correr" });

describe("the Hoy / Ayer selector in the entry sheet (design 21)", () => {
  it("offers Hoy and Ayer while yesterday is still open, starting on Hoy", async () => {
    open(running());
    const dialog = await dialogOf();
    const group = within(dialog).getByRole("radiogroup", { name: "Día del registro" });
    const [today, yesterday] = within(group).getAllByRole("radio");
    expect(today).toHaveTextContent("Hoy");
    expect(yesterday).toHaveTextContent("Ayer · jueves 1");
    expect(today).toHaveAttribute("aria-checked", "true");
  });

  it("has no selector when yesterday is not open", async () => {
    open(running(), null);
    const dialog = await dialogOf();
    expect(
      within(dialog).queryByRole("radiogroup", { name: "Día del registro" }),
    ).not.toBeInTheDocument();
  });

  it("says where an Ayer registro lands, and the button says it is yesterday's", async () => {
    open(running());
    const dialog = await dialogOf();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    expect(
      within(dialog).getByText(
        "Se guardará para el jueves 1 y aparecerá como “registrado posteriormente”. Cuenta igual.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }),
    ).toBeInTheDocument();
  });

  it("records for yesterday when Ayer is chosen, and for today otherwise", async () => {
    const yesterday = open(running());
    const dialog = await dialogOf();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }));
    await screen.findByText("Registro guardado.");
    expect(yesterday.deps.api.recorded[0]).toMatchObject({
      commitmentId: "commitment-9",
      forDate: "2026-10-01",
      value: { kind: "quantity", value: "4" },
    });
  });

  it("records for today by default", async () => {
    const app = open(running());
    const dialog = await dialogOf();
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km" }));
    await screen.findByText("Registro guardado.");
    expect(app.deps.api.recorded[0]?.forDate).toBe("2026-10-02");
  });

  it("starts on Ayer when it was opened from the De ayer card (&day=ayer)", async () => {
    open(running(), undefined, "&day=ayer");
    const dialog = await dialogOf();
    expect(within(dialog).getByRole("radio", { name: /Ayer/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }),
    ).toBeInTheDocument();
  });

  it("does not add on top of today's entries when the registro is for yesterday", async () => {
    const row = running({
      entries: [entryFixture({ kind: "quantity", value: "3" })],
      opportunity: { state: "logged", graceUntil: null },
    });
    open(row);
    const dialog = await dialogOf();
    expect(within(dialog).getByRole("button", { name: "Añadir 3 km" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    expect(
      within(dialog).getByRole("button", { name: "Registrar 3 km de ayer" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Llevas/)).not.toBeInTheDocument();
  });

  it("shows no points for a registro of yesterday on its confirmation", async () => {
    open(running());
    const dialog = await dialogOf();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }));
    await screen.findByText("Registro guardado.");
    expect(screen.queryByText(/\+\d+ pts/)).not.toBeInTheDocument();
    expect(screen.getByText("Correr · 4 km · ayer")).toBeInTheDocument();
  });

  it("offers only yesterday when the day is not scheduled today", async () => {
    open(running({ scheduledToday: false }));
    const dialog = await dialogOf();
    expect(
      within(dialog).queryByRole("radiogroup", { name: "Día del registro" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Se guardará para el jueves 1/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }),
    ).toBeInTheDocument();
  });

  it("works on a limit grid too, with yesterday's scores", async () => {
    const coffee = dayRowFixture({
      commitmentId: "commitment-9" as DayRow["commitmentId"],
      habitName: "Correr",
      measure: {
        unit: "times",
        customLabel: "cafés",
        precision: "integer",
        target: { direction: "limit", ideal: "2", tolerance: "4" },
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: WEEKDAYS } },
      },
      points: pointsFixture({
        perOpportunity: "3",
        earned: null,
        limitPercents: [100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    });
    const app = open(coffee);
    const dialog = await dialogOf();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    await userEvent.click(within(dialog).getByRole("radio", { name: /^3/ }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Registrar 3 veces de ayer" }),
    );
    await waitFor(() => expect(app.deps.api.recorded).toHaveLength(1));
    expect(app.deps.api.recorded[0]).toMatchObject({ forDate: "2026-10-01" });
  });
});
