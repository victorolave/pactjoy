import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  coffee,
  meditation,
  quantity,
  reading,
  renderToday,
} from "../../testing/fixtures/edit-rows.ts";
import { entryFixture } from "../../testing/fixtures/today.ts";

describe("what the edit sheet tells and lists (EN-R7)", () => {
  it("says until when the entry can still be changed", async () => {
    renderToday([reading([quantity("25")])], "/?entry=commitment-2&id=entry-1");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(
      within(dialog).getByText("Puedes cambiarlo hasta el sábado 3 de octubre."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Después del periodo de gracia, el registro queda bloqueado."),
    ).toBeInTheDocument();
  });

  it("lists every entry of the row and edits the one chosen (EN-S13)", async () => {
    const { deps } = renderToday([reading([quantity("25", "entry-1"), quantity("10", "entry-2")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Editar registro de Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    const first = within(dialog).getByRole("button", { name: "25 min" });
    const second = within(dialog).getByRole("button", { name: "10 min" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(second);
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("10");
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 10 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.edited[0]).toMatchObject({ entryId: "entry-2" });
  });
});

describe("editing a limit entry", () => {
  it("preselects its option in the grid and saves another, 0 included", async () => {
    const { deps } = renderToday([coffee([quantity("2", "entry-9")])]);
    await userEvent.click(await screen.findByRole("button", { name: "Editar registro de Café" }));
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(within(dialog).getByRole("radio", { name: /^2/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(within(dialog).getByRole("radio", { name: /^0/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 0 veces" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.edited[0]).toMatchObject({
      entryId: "entry-9",
      value: { kind: "quantity", value: "0" },
    });
  });
});

describe("edit failures (EN-R8)", () => {
  it("tells that the entry is gone, keeps the sheet and refetches Today (EN-S16)", async () => {
    const { deps } = renderToday([reading([quantity("25")])], "/?entry=commitment-2&id=entry-1");
    deps.api.failNext("editEntry", new ApiError("EntryDeleted", 409, "req-1"));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ese registro ya no existe.",
    );
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("says another device changed it", async () => {
    const { deps } = renderToday([reading([quantity("25")])], "/?entry=commitment-2&id=entry-1");
    deps.api.failNext("editEntry", new ApiError("ConcurrencyConflict", 409, "req-2"));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Se actualizó en otro dispositivo.",
    );
  });

  it("keeps the sheet open with the quantity error", async () => {
    const { deps } = renderToday([reading([quantity("25")])], "/?entry=commitment-2&id=entry-1");
    deps.api.failNext("editEntry", new ApiError("InvalidQuantity", 422, "req-3"));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La cantidad no es válida.");
  });
});

describe("who can edit", () => {
  it("offers the pencil only on rows with entries that can still be written", async () => {
    renderToday([
      reading([quantity("25")]),
      meditation([], {
        habitName: "SinRegistro",
        opportunity: { state: "open", graceUntil: null },
      }),
      meditation([entryFixture({ kind: "done" })], {
        habitName: "Cerrado",
        opportunity: { state: "closed", graceUntil: null },
      }),
      meditation([entryFixture({ kind: "done" })], { habitName: "OtroDía", scheduledToday: false }),
    ]);
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.getByRole("button", { name: "Editar registro de Leer" })).toBeInTheDocument();
    for (const name of ["SinRegistro", "Cerrado", "OtroDía"]) {
      expect(
        screen.queryByRole("button", { name: `Editar registro de ${name}` }),
      ).not.toBeInTheDocument();
    }
  });

  it("keeps the plus next to the pencil while the row is still open", async () => {
    renderToday([reading([quantity("25")], { opportunity: { state: "open", graceUntil: null } })]);
    expect(await screen.findByRole("button", { name: "Registrar Leer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar registro de Leer" })).toBeInTheDocument();
  });
});
