import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { meditation, quantity, reading, renderToday } from "../../../testing/fixtures/edit-rows.ts";
import { entryFixture } from "../../../testing/fixtures/today.ts";

describe("editing a logged entry (EN-R7)", () => {
  it("opens a sheet prefilled from the entry, and saves the change with a PUT (EN-S11)", async () => {
    const { deps } = renderToday([reading([quantity("25", "entry-1", "buen capítulo")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Editar registro de Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("25");
    expect(within(dialog).getByRole("textbox", { name: "Nota (opcional)" })).toHaveValue(
      "buen capítulo",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 30 min" }));
    expect(await screen.findByText("Registro guardado.")).toBeInTheDocument();
    expect(deps.api.edited).toEqual([
      { entryId: "entry-1", value: { kind: "quantity", value: "30" }, note: "buen capítulo" },
    ]);
    expect(deps.api.calls.recordEntry).toBe(0);
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("keeps the confirmation open until the user leaves it (no timer)", async () => {
    renderToday([reading([quantity("25", "entry-1")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Editar registro de Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    expect(await screen.findByText("Registro guardado.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(screen.getByText("Registro guardado.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can clear the note", async () => {
    const { deps } = renderToday([reading([quantity("25", "entry-1", "borrar")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Editar registro de Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Quitar nota" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.edited[0]?.note).toBeNull();
  });

  it("edits a done entry's note without a value field", async () => {
    const { deps } = renderToday([meditation([entryFixture({ kind: "done" }, { note: null })])]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Editar registro de Meditar" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Meditar" });
    expect(within(dialog).queryByRole("textbox", { name: "Cantidad" })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota" }));
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Nota (opcional)" }),
      "en la mañana",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.edited[0]).toEqual({
      entryId: "entry-1",
      value: { kind: "done" },
      note: "en la mañana",
    });
  });

  it("keeps a missed entry missed when only the note changes", async () => {
    const { deps } = renderToday([meditation([entryFixture({ kind: "missed" })])]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Editar registro de Meditar" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Meditar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.edited[0]?.value).toEqual({ kind: "missed" });
  });

  it("opens a deep link on the entry it names", async () => {
    renderToday(
      [reading([quantity("25", "entry-1"), quantity("10", "entry-2")])],
      "/?entry=commitment-2&id=entry-2",
    );
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("10");
  });

  it("falls back to a new entry when the link names an entry that is gone", async () => {
    renderToday(
      [reading([quantity("25", "entry-1")], { opportunity: { state: "open", graceUntil: null } })],
      "/?entry=commitment-2&id=entry-404",
    );
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    // The row has 25 min logged today, so the new sheet adds on top of them.
    expect(within(dialog).getByRole("button", { name: "Añadir 10 min" })).toBeInTheDocument();
  });
});
