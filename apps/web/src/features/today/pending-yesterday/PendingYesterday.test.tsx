import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  type Entry,
  endedTodayFixture,
  entryFixture,
  pendingItemFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const limitItem = () =>
  pendingItemFixture({
    commitmentId: "commitment-8" as never,
    habitName: "Café",
    measure: {
      unit: "times",
      customLabel: "cafés",
      precision: "integer",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3] } },
    },
  });

const quantityItem = () =>
  pendingItemFixture({
    commitmentId: "commitment-9" as never,
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3] } },
    },
  });

const show = (items = [pendingItemFixture()]) =>
  renderApp({ today: activeTodayFixture({ pendingYesterday: items }) });

const registeredYesterday = (value: Entry["value"], id = "e-yesterday") =>
  entryFixture(value, { entryId: id as Entry["entryId"], forDate: "2026-10-01" as never });

const withEntry = (row: DayRow, entry: Entry): DayRow => ({ ...row, entries: [entry] });

const reading = (): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-9" as DayRow["commitmentId"],
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3, 4] } },
    },
  });

describe("registered yesterday lives in the De ayer card, not in the Today row", () => {
  const show = (row: DayRow) =>
    renderApp({ today: activeTodayFixture({ rows: [row], pendingYesterday: [] }) });

  it("shows what was registered, with its day, and keeps the card while yesterday's window is open", async () => {
    show(withEntry(reading(), registeredYesterday({ kind: "quantity", value: "4" })));
    const card = (await screen.findByText("De ayer")).closest(".pj-card") as HTMLElement;
    expect(within(card).getByText("Correr")).toBeInTheDocument();
    expect(within(card).getByText("Jueves 1 · 4 km")).toBeInTheDocument();
    expect(within(card).getByText("Puedes cambiarlo hasta el final de hoy.")).toBeInTheDocument();
  });

  it("says a done and a miss in the design's words", async () => {
    show(withEntry(dayRowFixture({ habitName: "Dibujar" }), registeredYesterday({ kind: "done" })));
    expect(await screen.findByText("Jueves 1 · Registrado")).toBeInTheDocument();
  });

  it("says a day marked as missed", async () => {
    show(
      withEntry(dayRowFixture({ habitName: "Dibujar" }), registeredYesterday({ kind: "missed" })),
    );
    expect(await screen.findByText("Jueves 1 · No salió")).toBeInTheDocument();
  });

  it("keeps yesterday's entry out of the Today row", async () => {
    show(withEntry(reading(), registeredYesterday({ kind: "quantity", value: "4" })));
    await screen.findByText("De ayer");
    const row = screen
      .getByRole("heading", { name: "Correr", level: 3 })
      .closest("article") as HTMLElement;
    expect(within(row).queryByText(/4 km/)).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Editar registro/ })).not.toBeInTheDocument();
  });

  it("edits exactly that entry with the pencil", async () => {
    const app = show(
      withEntry(reading(), registeredYesterday({ kind: "quantity", value: "4" }, "e-42")),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Editar registro de Correr de ayer" }),
    );
    expect(app.location()).toBe("/?entry=commitment-9&id=e-42");
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("4");
    expect(within(dialog).getByText(/Jueves 1 de octubre · 4 km · jueves/)).toBeInTheDocument();
    // Its own day's grace, not today's row's: Thursday's entry can be changed until Friday.
    expect(
      within(dialog).getByText("Puedes cambiarlo hasta el viernes 2 de octubre."),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 5 km" }));
    await waitFor(() => expect(app.deps.api.edited).toHaveLength(1));
    expect(app.deps.api.edited[0]).toMatchObject({ entryId: "e-42" });
  });

  it("a row with both a today entry and a yesterday entry keeps each in its place", async () => {
    const today = entryFixture({ kind: "quantity", value: "3" }, { entryId: "e-today" as never });
    const row: DayRow = {
      ...reading(),
      opportunity: { state: "logged", graceUntil: null },
      entries: [registeredYesterday({ kind: "quantity", value: "4" }), today],
    };
    const app = show(row);
    const article = (await screen.findByRole("heading", { name: "Correr", level: 3 })).closest(
      "article",
    ) as HTMLElement;
    expect(within(article).getByText("Llevas 3 km hoy")).toBeInTheDocument();
    await userEvent.click(
      within(article).getByRole("button", { name: "Editar registro de Correr" }),
    );
    expect(app.location()).toContain("id=e-today");
  });
});

describe("the De ayer card (design 15d)", () => {
  it("lists what is pending, with its day, above Para hoy", async () => {
    show();
    const card = (await screen.findByText("De ayer")).closest(".pj-card") as HTMLElement;
    expect(
      within(card).getByText("Puedes registrarlo hasta el final de hoy. Cuenta igual."),
    ).toBeInTheDocument();
    expect(within(card).getByText("Dibujar")).toBeInTheDocument();
    expect(within(card).getByText("Jueves 1")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Para hoy" });
    expect(card.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is on the warm surface of the design, without a border", async () => {
    show();
    const card = (await screen.findByText("De ayer")).closest(".pj-card");
    expect(card).toHaveClass("pj-card--warm");
  });

  it("is not there when nothing is pending, or when the season has ended", async () => {
    show([]);
    await screen.findByRole("heading", { name: "Para hoy" });
    expect(screen.queryByText("De ayer")).not.toBeInTheDocument();
  });

  it("registers a done item for yesterday with one tap", async () => {
    const { deps } = show();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Dibujar de ayer" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({
      commitmentId: "commitment-7",
      forDate: "2026-10-01",
      value: { kind: "done" },
    });
    expect(
      await screen.findByText("Registro guardado. Un paso más en tu meta."),
    ).toBeInTheDocument();
  });

  it("records Ayer no salió for yesterday, not for today", async () => {
    const { deps } = show();
    await userEvent.click(await screen.findByRole("button", { name: "Ayer no salió: Dibujar" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({
      forDate: "2026-10-01",
      value: { kind: "missed" },
    });
  });

  it("opens the sheet for yesterday when the item has a quantity", async () => {
    const app = show([quantityItem()]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Correr de ayer" }));
    expect(app.location()).toBe("/?entry=commitment-9&day=ayer");
  });

  it("does not offer Ayer no salió on a limit: its real value, 0 included, is what counts", async () => {
    show([limitItem()]);
    await screen.findByText("De ayer");
    expect(screen.getByRole("button", { name: "Registrar Café de ayer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /no salió: Café/ })).not.toBeInTheDocument();
  });

  it("says Ayer no salió, never Hoy, and keeps it inside its own item's card", async () => {
    show([pendingItemFixture(), quantityItem()]);
    const miss = await screen.findByRole("button", { name: "Ayer no salió: Dibujar" });
    expect(miss).toHaveAttribute("title", "Ayer no salió: Dibujar");
    const card = miss.closest(".pj-card") as HTMLElement;
    expect(within(card).queryByText("Hoy no salió")).not.toBeInTheDocument();
    // Inside the white item that names the habit, not floating between items.
    const item = miss.closest("div[class*='entry']") as HTMLElement;
    expect(within(item).getByText("Dibujar")).toBeInTheDocument();
    expect(
      within(item).getByRole("button", { name: "Registrar Dibujar de ayer" }),
    ).toBeInTheDocument();
    expect(within(item).queryByText("Correr")).not.toBeInTheDocument();
  });

  it("is one line per item: the name and day on the left, circular buttons on the right", async () => {
    show([pendingItemFixture(), quantityItem(), limitItem()]);
    await screen.findByText("De ayer");
    // The text line under the item is gone.
    expect(screen.queryByText("Ayer no salió")).not.toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Registrar Dibujar de ayer" });
    const miss = screen.getByRole("button", { name: "Ayer no salió: Dibujar" });
    const item = done.closest("div[class*='entry']") as HTMLElement;
    expect(item.contains(miss)).toBe(true);
    expect(within(item).getAllByRole("button")).toHaveLength(2);
    // The ✓ is the one-tap circle, the × a ghost icon button.
    expect(done.className).toMatch(/circle/);
    expect(miss).toHaveClass("pj-iconbtn");
    expect(miss.querySelector(".lucide-x")).not.toBeNull();
  });

  it("a quantity item has only the plus, which opens the sheet on Ayer", async () => {
    const app = show([quantityItem()]);
    const plus = await screen.findByRole("button", { name: "Registrar Correr de ayer" });
    expect(plus.querySelector(".lucide-plus")).not.toBeNull();
    const item = plus.closest("div[class*='entry']") as HTMLElement;
    expect(within(item).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(plus);
    expect(app.location()).toBe("/?entry=commitment-9&day=ayer");
  });

  it("a limit item has only the plus: no miss", async () => {
    show([limitItem()]);
    const plus = await screen.findByRole("button", { name: "Registrar Café de ayer" });
    const item = plus.closest("div[class*='entry']") as HTMLElement;
    expect(within(item).getAllByRole("button")).toHaveLength(1);
  });

  it("the ✓ fills at once and records yesterday", async () => {
    const { deps } = show();
    const done = await screen.findByRole("button", { name: "Registrar Dibujar de ayer" });
    await userEvent.click(done);
    expect(done).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({ forDate: "2026-10-01", value: { kind: "done" } });
  });

  it("every control is a real touch target: the 48 px circle and the 44 px icon buttons", async () => {
    show([pendingItemFixture()]);
    const done = await screen.findByRole("button", { name: "Registrar Dibujar de ayer" });
    const miss = screen.getByRole("button", { name: "Ayer no salió: Dibujar" });
    expect(done.className).toMatch(/circle/);
    expect(miss).toHaveClass("pj-iconbtn");
  });

  it("lists several items, each with its own controls", async () => {
    show([pendingItemFixture(), quantityItem()]);
    await screen.findByText("De ayer");
    expect(screen.getByRole("button", { name: "Registrar Dibujar de ayer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Correr de ayer" })).toBeInTheDocument();
  });

  it("goes away once the server stops listing it", async () => {
    const { deps } = show();
    const register = await screen.findByRole("button", { name: "Registrar Dibujar de ayer" });
    // What the server answers on the refetch after the save: yesterday is no longer pending.
    deps.api.setToday(activeTodayFixture({ pendingYesterday: [] }));
    await userEvent.click(register);
    await waitFor(() => expect(screen.queryByText("De ayer")).not.toBeInTheDocument());
  });

  it("is offered next to a day that is not scheduled today too", async () => {
    renderApp({
      today: activeTodayFixture({
        rows: [dayRowFixture({ scheduledToday: false })],
        pendingYesterday: [pendingItemFixture()],
      }),
    });
    expect(await screen.findByText("De ayer")).toBeInTheDocument();
  });

  it("an ended season shows none", async () => {
    renderApp({ today: endedTodayFixture() });
    await screen.findByText("Temporada terminada");
    expect(screen.queryByText("De ayer")).not.toBeInTheDocument();
  });
});
