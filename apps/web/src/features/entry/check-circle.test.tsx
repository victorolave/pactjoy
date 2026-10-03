import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const open = (overrides: Partial<DayRow> = {}) =>
  dayRowFixture({ habitName: "Dibujar", ...overrides });

const logged = (overrides: Partial<DayRow> = {}) =>
  open({
    opportunity: { state: "logged", graceUntil: "2026-10-03" as never },
    entries: [entryFixture({ kind: "done" })],
    ...overrides,
  });

const render = (row: DayRow) => renderApp({ today: activeTodayFixture({ rows: [row] }) });

describe("the one-tap circle (design 16)", () => {
  it("is a toggle: empty while pending, named for the habit", async () => {
    render(open());
    const circle = await screen.findByRole("button", { name: "Registrar Dibujar" });
    expect(circle).toHaveAttribute("aria-pressed", "false");
    expect(circle.className).toMatch(/circle/);
  });

  it("records on the first tap", async () => {
    const { deps } = render(open());
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Dibujar" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "done" });
  });

  it("is filled and pressed once logged", async () => {
    render(logged());
    const circle = await screen.findByRole("button", { name: "Registrar Dibujar" });
    expect(circle).toHaveAttribute("aria-pressed", "true");
  });

  it("asks '¿Deshacer registro?' on a second tap, and does not delete until confirmed", async () => {
    const { deps } = render(logged());
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Dibujar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Deshacer registro?" });
    expect(deps.api.calls.deleteEntry).toBe(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deps.api.calls.deleteEntry).toBe(0);
  });

  it("deletes that entry when the undo is confirmed, and says so", async () => {
    const { deps } = render(logged());
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Dibujar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Deshacer registro?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Deshacer registro" }));
    await waitFor(() => expect(deps.api.deleted).toEqual(["entry-1"]));
    expect(await screen.findByText("Registro deshecho.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has no circle on a day marked 'Hoy no salió': that registro is edited, not toggled", async () => {
    render(logged({ entries: [entryFixture({ kind: "missed" })] }));
    await screen.findByRole("heading", { name: "Dibujar" });
    expect(screen.queryByRole("button", { name: "Registrar Dibujar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar registro de Dibujar" })).toBeInTheDocument();
  });

  it("has no circle once the window has closed", async () => {
    render(logged({ opportunity: { state: "closed", graceUntil: null } }));
    await screen.findByRole("heading", { name: "Dibujar" });
    expect(screen.queryByRole("button", { name: "Registrar Dibujar" })).not.toBeInTheDocument();
  });

  it("keeps a way to record Hoy no salió, since the design only draws the circle", async () => {
    const { deps } = render(open());
    await userEvent.click(await screen.findByRole("button", { name: "Hoy no salió: Dibujar" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.value).toEqual({ kind: "missed" });
  });

  it("centres Hoy no salió under the row, with the shared Centered wrapper (it was lost once)", async () => {
    render(open());
    const missed = await screen.findByRole("button", { name: "Hoy no salió: Dibujar" });
    expect(missed.parentElement).toHaveAttribute("data-centered", "true");
  });

  it("does not offer Hoy no salió on a day that is already logged", async () => {
    render(logged());
    await screen.findByRole("heading", { name: "Dibujar" });
    expect(screen.queryByRole("button", { name: /Hoy no salió/ })).not.toBeInTheDocument();
  });
});
