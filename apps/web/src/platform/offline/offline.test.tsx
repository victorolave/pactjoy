import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { meditation, quantity, reading } from "../../testing/fixtures/edit-rows.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  pendingItemFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const OFFLINE = "Sin conexión. Puedes registrar; se enviará al volver.";
const SYNCING = "Enviando lo que registraste sin conexión…";

const openRows = () => [
  dayRowFixture({ habitName: "Meditar" }),
  weekRowFixture(),
  meditation([quantity("25")], {
    habitName: "Leído",
    commitmentId: "c-9" as DayRow["commitmentId"],
  }),
];

describe("offline banner (TO-R10)", () => {
  it("says there is no connection and that registering is still possible (OE-R9.S1)", async () => {
    renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    expect(await screen.findByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByText(/necesitas conexión/)).not.toBeInTheDocument();
    expect(screen.queryByText(SYNCING)).not.toBeInTheDocument();
  });

  it("says it is sending what was registered offline, until the queue is empty (OE-R9.S2)", async () => {
    const { deps } = renderApp({
      online: false,
      today: activeTodayFixture({ rows: openRows() }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
    const release = deps.api.hold("recordEntry");
    act(() => deps.connectivity.setOnline(true));
    expect(await screen.findByText(SYNCING)).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByText(SYNCING)).not.toBeInTheDocument());
    expect(deps.outboxStore.load("user-1").items).toEqual([]);
  });

  it("does not claim to be sending when a retryable failure stopped the replay", async () => {
    const { deps } = renderApp({
      online: false,
      today: activeTodayFixture({ rows: openRows() }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
    deps.api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
    act(() => deps.connectivity.setOnline(true));
    await waitFor(() => expect(deps.api.recordAttempts).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(SYNCING)).not.toBeInTheDocument());
    expect(deps.outboxStore.load("user-1").items).toHaveLength(1);
  });

  it("shows the sin-conexion illustration with the banner", async () => {
    renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    expect(screen.getByRole("img", { name: "Sin conexión" })).toHaveAttribute(
      "src",
      expect.stringContaining("sin-conexion"),
    );
    // 150 high and full width in the design (15g), not the natural size.
    expect(screen.getByRole("img", { name: "Sin conexión" })).toHaveAttribute(
      "data-size",
      "banner",
    );
  });

  it("is not shown while online", async () => {
    renderApp({ today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByRole("heading", { name: "Meditar" });
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });

  it("appears and disappears as the connection changes", async () => {
    const { deps } = renderApp({ today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByRole("heading", { name: "Meditar" });
    act(() => deps.connectivity.setOnline(false));
    expect(await screen.findByText(OFFLINE)).toBeInTheDocument();
    act(() => deps.connectivity.setOnline(true));
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });
});

describe("entry writes work offline, every other write stays disabled (OE-R8, OE-R11)", () => {
  it("enables the register, missed and edit controls on the rows (OE-R8.S1)", async () => {
    renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    for (const name of [
      "Registrar Meditar",
      "Hoy no salió: Meditar",
      "Registrar Leer",
      "Editar registro de Leído",
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("keeps pausing disabled (OE-R8.S2)", async () => {
    renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    expect(screen.getByRole("button", { name: "Pausar un compromiso" })).toBeDisabled();
  });

  it("a tap offline is kept on the phone: no request, one item in the outbox", async () => {
    const { deps } = renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
    expect(deps.api.calls.recordEntry).toBe(0);
  });

  it("keeps Deshacer working when the connection drops (entry writes are queued)", async () => {
    const { deps } = renderApp({
      today: activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    const undo = await screen.findByRole("button", { name: "Deshacer" });
    act(() => deps.connectivity.setOnline(false));
    expect(undo).toBeEnabled();
    await userEvent.click(undo);
    expect(deps.api.deleteAttempts).toEqual([]);
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
  });

  it("enables saving in the sheet of a day row too and keeps the record on the phone (C-W2)", async () => {
    const { deps } = renderApp({
      online: false,
      path: "/?entry=commitment-3",
      today: activeTodayFixture({
        rows: [
          dayRowFixture({
            commitmentId: "commitment-3" as DayRow["commitmentId"],
            habitName: "Correr",
            measure: {
              unit: "km",
              customLabel: null,
              precision: "integer",
              target: { direction: "reach", minimum: "3", ideal: "5" },
              schedule: {
                period: "perSession",
                frequency: { kind: "specificDays", weekdays: [4] },
              },
            },
          }),
        ],
      }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    expect(within(dialog).getByRole("button", { name: "Registrar 4 km" })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km" }));
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
    expect(deps.api.calls.recordEntry).toBe(0);
  });

  it("De ayer: records yesterday on the phone with yesterday's day (OE-R8)", async () => {
    const row = dayRowFixture({ habitName: "Meditar" });
    const { deps } = renderApp({
      online: false,
      today: activeTodayFixture({
        rows: [row],
        pendingYesterday: [
          pendingItemFixture({
            commitmentId: row.commitmentId as never,
            habitName: "Meditar",
            measure: row.measure,
            points: row.points,
          }),
        ],
      }),
    });
    const check = await screen.findByRole("button", { name: "Registrar Meditar de ayer" });
    expect(check).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ayer no salió: Meditar" })).toBeEnabled();
    await userEvent.click(check);
    await waitFor(() => expect(deps.outboxStore.load("user-1").items).toHaveLength(1));
    expect(deps.outboxStore.load("user-1").items[0]).toMatchObject({
      kind: "record",
      habitName: "Meditar",
      command: { forDate: "2026-10-01", value: { kind: "done" } },
    });
  });

  it("disables the photo in the sheet and says why (OE-R1.S4)", async () => {
    renderApp({
      online: false,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));
    expect(within(dialog).getByRole("button", { name: "Añadir foto" })).toBeDisabled();
    expect(within(dialog).getByText("La foto necesita conexión.")).toBeInTheDocument();
  });

  it("shows the offline sentence in a sheet only while there is no connection", async () => {
    const { deps } = renderApp({
      online: false,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByText("Sin conexión: se guardará en este teléfono.")).toBeVisible();
    act(() => deps.connectivity.setOnline(true));
    expect(
      within(dialog).queryByText("Sin conexión: se guardará en este teléfono."),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Registrar 20 min" })).toBeEnabled();
  });

  it("enables saving and deleting in the edit sheet", async () => {
    renderApp({
      online: false,
      path: "/?entry=commitment-2&id=entry-1",
      today: activeTodayFixture({ rows: [reading([quantity("25")])] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("button", { name: "Guardar 25 min" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Borrar registro" })).toBeEnabled();
  });
});
