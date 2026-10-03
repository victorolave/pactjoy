import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTodayFixture, type WeekRow, weekRowFixture } from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const withEarned = (earned: number | null): WeekRow => {
  const row = weekRowFixture();
  return { ...row, points: { ...row.points, earned } };
};

const open = (row: WeekRow) =>
  renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [row] }) });

const sheet = () => screen.findByRole("dialog", { name: "Leer" });

const save = async (label: string) => {
  const dialog = await screen.findByRole("dialog", { name: "Leer" });
  await userEvent.click(within(dialog).getByRole("button", { name: label }));
};

describe("the confirmation after a save (design 20)", () => {
  it("has no sheet header and no close button, only the way out the design draws", async () => {
    open(withEarned(null));
    await save("Registrar 20 min");
    await screen.findByText("Registro guardado.");
    const dialog = screen.getByRole("dialog", { name: "Leer" });
    expect(within(dialog).queryByRole("heading", { name: "Leer" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cerrar" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Seguir con mi día" })).toBeInTheDocument();
  });

  it("shows the points the server computed for this save, once Today is refetched", async () => {
    const { deps } = open(withEarned(null));
    await screen.findByRole("dialog", { name: "Leer" });
    // What the server answers on the refetch that follows the save: 4 points earned today.
    deps.api.setToday(activeTodayFixture({ rows: [withEarned(4)] }));
    await save("Registrar 20 min");
    expect(await within(await sheet()).findByText("+4 pts")).toBeInTheDocument();
  });

  it("shows only what this save added when the row already had points", async () => {
    const { deps } = open(withEarned(4));
    await screen.findByRole("dialog", { name: "Leer" });
    deps.api.setToday(activeTodayFixture({ rows: [withEarned(5)] }));
    await save("Registrar 20 min");
    expect(await within(await sheet()).findByText("+1 pt")).toBeInTheDocument();
  });

  it("says the minimum was met when the typed value reaches it", async () => {
    open(withEarned(null));
    await save("Registrar 20 min");
    expect(await screen.findByText("Mínimo cumplido. Un paso más en tu meta.")).toBeInTheDocument();
  });

  it("does not say it when the value is below the minimum", async () => {
    open(withEarned(null));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    const input = within(dialog).getByRole("textbox", { name: "Cantidad" });
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 5 min" }));
    await screen.findByText("Registro guardado.");
    expect(screen.queryByText(/Mínimo cumplido/)).not.toBeInTheDocument();
  });

  it("leaves a toast with Deshacer behind when it closes, and Deshacer deletes the entry", async () => {
    const { deps } = open(withEarned(null));
    await save("Registrar 20 min");
    await screen.findByText("Registro guardado.");
    act(() => vi.advanceTimersByTime(1200));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Registro guardado.");
    await userEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(deps.api.deleted).toEqual(["entry-1"]));
  });

  it("names the points in that toast when there are some", async () => {
    const { deps } = open(withEarned(null));
    await screen.findByRole("dialog", { name: "Leer" });
    deps.api.setToday(activeTodayFixture({ rows: [withEarned(4)] }));
    await save("Registrar 20 min");
    await within(await sheet()).findByText("+4 pts");
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Leer · +4 pts");
  });
});
