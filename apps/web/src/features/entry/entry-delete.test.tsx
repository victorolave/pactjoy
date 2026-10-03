import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { meditation, quantity, reading, renderToday } from "../../testing/fixtures/edit-rows.ts";
import { entryFixture } from "../../testing/fixtures/today.ts";

const openEdit = async (name: string) => {
  await userEvent.click(await screen.findByRole("button", { name: `Editar registro de ${name}` }));
  return screen.findByRole("dialog", { name });
};

describe("deleting an entry (EN-R7, EN-S12)", () => {
  it("asks before deleting, then deletes that entry and confirms", async () => {
    const { deps } = renderToday([reading([quantity("25", "entry-1")])]);
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    expect(within(dialog).getByText("¿Borrar este registro?")).toBeInTheDocument();
    expect(deps.api.calls.deleteEntry).toBe(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    expect(await screen.findByText("Registro borrado.")).toBeInTheDocument();
    expect(deps.api.deleted).toEqual(["entry-1"]);
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("goes back to the form when the user changes their mind", async () => {
    const { deps } = renderToday([reading([quantity("25")])]);
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(within(dialog).queryByText("¿Borrar este registro?")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Guardar 25 min" })).toBeInTheDocument();
    expect(deps.api.calls.deleteEntry).toBe(0);
  });

  it("deletes the one entry that is selected when there are several", async () => {
    const { deps } = renderToday([reading([quantity("25", "entry-1"), quantity("10", "entry-2")])]);
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Registro borrado.");
    expect(deps.api.deleted).toEqual(["entry-2"]);
  });

  it("deletes a done entry too", async () => {
    const { deps } = renderToday([meditation([entryFixture({ kind: "done" })])]);
    const dialog = await openEdit("Meditar");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Registro borrado.");
    expect(deps.api.deleted).toEqual(["entry-1"]);
  });

  it("sends one request on a double tap", async () => {
    const { deps } = renderToday([reading([quantity("25")])]);
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Registro borrado.");
    expect(deps.api.deleteAttempts).toEqual(["entry-1"]);
  });
});

describe("delete failures (EN-R8)", () => {
  it("says the entry is already gone and keeps the sheet open", async () => {
    const { deps } = renderToday([reading([quantity("25")])]);
    deps.api.failNext("deleteEntry", new ApiError("EntryNotFound", 404, "req-1"));
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ese registro ya no existe.",
    );
    expect(screen.getByRole("dialog", { name: "Leer" })).toBeInTheDocument();
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("lets the user try again after a connection failure", async () => {
    const { deps } = renderToday([reading([quantity("25")])]);
    deps.api.failNext("deleteEntry", new ApiError("NetworkError", 0, null));
    const dialog = await openEdit("Leer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No pudimos borrar el registro.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await screen.findByText("Registro borrado.");
    expect(deps.api.deleteAttempts).toEqual(["entry-1", "entry-1"]);
  });
});
