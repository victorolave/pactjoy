import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meditation, quantity, reading } from "../../testing/fixtures/edit-rows.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const OFFLINE =
  "Sin conexión. Estás viendo lo último que se guardó; para registrar necesitas conexión.";

const openRows = () => [
  dayRowFixture({ habitName: "Meditar" }),
  weekRowFixture(),
  meditation([quantity("25")], {
    habitName: "Leído",
    commitmentId: "c-9" as DayRow["commitmentId"],
  }),
];

describe("offline banner (TO-R10)", () => {
  it("says there is no connection, and never claims anything is pending", async () => {
    renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    const banner = await screen.findByText(OFFLINE);
    expect(banner).toBeInTheDocument();
    expect(screen.queryByText(/se enviará|pendiente|al volver/i)).not.toBeInTheDocument();
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

describe("writes are disabled offline, and nothing is queued (EN-R9, EN-S17)", () => {
  it("disables every register and edit control on the rows", async () => {
    const { deps } = renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    const controls = screen.getAllByRole("button");
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const control of controls) expect(control).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    expect(deps.api.calls.recordEntry).toBe(0);
  });

  it("enables them again when the connection returns", async () => {
    const { deps } = renderApp({ online: false, today: activeTodayFixture({ rows: openRows() }) });
    await screen.findByText(OFFLINE);
    act(() => deps.connectivity.setOnline(true));
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Hoy no salió: Meditar" })).toBeEnabled();
  });

  it("disables saving in a sheet and says why", async () => {
    renderApp({
      online: false,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("button", { name: "Registrar 20 min" })).toBeDisabled();
    expect(within(dialog).getByText("Sin conexión: no se puede guardar.")).toBeInTheDocument();
  });

  it("disables saving and deleting in the edit sheet", async () => {
    renderApp({
      online: false,
      path: "/?entry=commitment-2&id=entry-1",
      today: activeTodayFixture({ rows: [reading([quantity("25")])] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("button", { name: "Guardar 25 min" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Borrar registro" })).toBeDisabled();
  });

  it("lets a sheet save again once the connection is back", async () => {
    const { deps } = renderApp({
      online: false,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    act(() => deps.connectivity.setOnline(true));
    expect(within(dialog).getByRole("button", { name: "Registrar 20 min" })).toBeEnabled();
    expect(
      within(dialog).queryByText("Sin conexión: no se puede guardar."),
    ).not.toBeInTheDocument();
  });
});
