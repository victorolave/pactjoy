import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { meditation, quantity, reading, renderToday } from "../../../testing/fixtures/edit-rows.ts";
import {
  activeTodayFixture,
  type EntryPhoto,
  entryFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const FILE = new File(["raw"], "camera.heic", { type: "image/heic" });
const PHOTO: EntryPhoto = {
  photoId: "photo-old" as EntryPhoto["photoId"],
  url: "https://storage.test/entry-photos/old.jpg?sig=1",
  expiresAt: Date.parse("2026-10-03T12:10:00.000Z") as EntryPhoto["expiresAt"],
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const openRecord = (options: Parameters<typeof renderApp>[0] = {}, rowOverrides = {}) =>
  renderApp({
    path: "/?entry=commitment-2",
    today: activeTodayFixture({ rows: [weekRowFixture(rowOverrides)] }),
    ...options,
  });

const fileInput = (dialog: HTMLElement) =>
  dialog.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;

async function addPhoto(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));
  await userEvent.upload(fileInput(dialog), FILE);
}

describe("recording with a photo (entry sheet)", () => {
  it("uploads on pick and records the entry with the photo's id (SC-W1, REQ-W6)", async () => {
    const { deps } = openRecord();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));

    await addPhoto(dialog);
    expect(await within(dialog).findByRole("button", { name: "Cambiar" })).toBeEnabled();
    expect(deps.photoUploader.puts).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));

    expect(await screen.findByText("Registro guardado.")).toBeInTheDocument();
    expect(deps.api.recorded[0]).toMatchObject({ photoId: "photo-1", note: null });
  });

  it("will not save while the photo is being prepared or sent", async () => {
    const { deps } = openRecord();
    const release = deps.photoUploader.hold();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));

    await addPhoto(dialog);

    expect(await within(dialog).findByText("Subiendo foto…")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Registrar 10 min" })).toBeDisabled();
    release();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Registrar 10 min" })).toBeEnabled(),
    );
  });

  it("a failed upload never blocks saving without the photo, and the note stays (REQ-W9)", async () => {
    const { deps } = openRecord();
    deps.photoUploader.script("failed");
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Nota (opcional)" }), "ok");
    await userEvent.upload(fileInput(dialog), FILE);

    expect(
      await within(dialog).findByRole("button", {
        name: "No se pudo subir la foto · Reintentar",
      }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));

    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]).toMatchObject({ note: "ok" });
    expect(deps.api.recorded[0]).not.toHaveProperty("photoId");
  });

  it("when the server turns the photo down, the field offers to upload again, not a generic error", async () => {
    const { deps } = openRecord();
    deps.api.failNext("recordEntry", new ApiError("PhotoUploadExpired", 409, "r-1"));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    await addPhoto(dialog);
    await within(dialog).findByRole("button", { name: "Cambiar" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));

    expect(
      await within(dialog).findByRole("button", {
        name: "No se pudo subir la foto · Reintentar",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("No pudimos usar la foto.")).toBeNull();
    // Reintentar reserves a new slot and the save goes through with the new id.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "No se pudo subir la foto · Reintentar" }),
    );
    await within(dialog).findByRole("button", { name: "Cambiar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));
    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded.at(-1)).toMatchObject({ photoId: "photo-2" });
  });

  it("offline the photo control is disabled with its reason (SC-W2)", async () => {
    openRecord({ online: false });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));

    expect(within(dialog).getByRole("button", { name: "Añadir foto" })).toBeDisabled();
    expect(
      within(dialog).getByText("Sin conexión: las fotos no están disponibles"),
    ).toBeInTheDocument();
  });

  it("the help under the note says who sees the photo too", async () => {
    openRecord();
    const visible = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(visible).getByRole("button", { name: "Añadir nota o foto" }));
    expect(
      within(visible).getByRole("textbox", { name: "Nota (opcional)" }),
    ).toHaveAccessibleDescription("Visible para el círculo, igual que este compromiso.");
  });

  it("a private commitment says only the member sees it", async () => {
    openRecord({}, { privacy: "private" });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));
    expect(
      within(dialog).getByRole("textbox", { name: "Nota (opcional)" }),
    ).toHaveAccessibleDescription("Solo tú la verás");
  });

  it("removing the note and photo drops the picked photo from the entry", async () => {
    const { deps } = openRecord();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "10 min" }));
    await addPhoto(dialog);
    await within(dialog).findByRole("button", { name: "Cambiar" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Quitar nota y foto" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 10 min" }));

    await screen.findByText("Registro guardado.");
    expect(deps.api.recorded[0]).not.toHaveProperty("photoId");
  });
});

const editOf = async (rows: Parameters<typeof renderToday>[0], name: string, options = {}) => {
  const app = renderToday(rows);
  void options;
  await userEvent.click(await screen.findByRole("button", { name: `Editar registro de ${name}` }));
  return { app, dialog: await screen.findByRole("dialog", { name }) };
};

describe("editing the photo of an entry (edit sheet)", () => {
  it("shows the photo the entry has, already open", async () => {
    const { dialog } = await editOf(
      [reading([entryFixture({ kind: "quantity", value: "25" }, { photo: PHOTO })])],
      "Leer",
    );

    expect(within(dialog).getByRole("img", { name: "Foto del registro" })).toHaveAttribute(
      "src",
      PHOTO.url,
    );
    expect(within(dialog).getByRole("button", { name: "Quitar foto" })).toBeEnabled();
  });

  it("saving without touching the photo leaves photoId out, so the server keeps it", async () => {
    const { app, dialog } = await editOf(
      [reading([entryFixture({ kind: "quantity", value: "25" }, { photo: PHOTO })])],
      "Leer",
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).not.toHaveProperty("photoId");
  });

  it("'Quitar foto' sends photoId null", async () => {
    const { app, dialog } = await editOf(
      [reading([entryFixture({ kind: "quantity", value: "25" }, { photo: PHOTO })])],
      "Leer",
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Quitar foto" }));
    expect(within(dialog).queryByRole("img")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).toHaveProperty("photoId", null);
  });

  it("picking another photo replaces it: the new id is sent", async () => {
    const { app, dialog } = await editOf(
      [reading([entryFixture({ kind: "quantity", value: "25" }, { photo: PHOTO })])],
      "Leer",
    );

    await userEvent.upload(fileInput(dialog), FILE);
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Guardar 25 min" })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).toHaveProperty("photoId", "photo-1");
  });

  it("adds a photo to a done entry that had none", async () => {
    const { app, dialog } = await editOf(
      [meditation([entryFixture({ kind: "done" }, { note: null })])],
      "Meditar",
    );

    await addPhoto(dialog);
    await within(dialog).findByRole("button", { name: "Cambiar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).toMatchObject({ value: { kind: "done" }, photoId: "photo-1" });
  });

  it("a missed entry cannot take a photo (SC-W3)", async () => {
    const { dialog } = await editOf([meditation([entryFixture({ kind: "missed" })])], "Meditar");

    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));

    expect(within(dialog).getByRole("button", { name: "Añadir foto" })).toBeDisabled();
    expect(within(dialog).getByText("Las fotos van con un registro hecho")).toBeInTheDocument();
  });

  it("a missed entry with a leftover photo in the payload still sends no photoId", async () => {
    const { app, dialog } = await editOf(
      [meditation([entryFixture({ kind: "missed" }, { note: "x" })])],
      "Meditar",
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).not.toHaveProperty("photoId");
  });

  it("edit keeps working for quantity entries with a note and no photo", async () => {
    const { app, dialog } = await editOf([reading([quantity("25", "entry-1", "nota")])], "Leer");

    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));

    await screen.findByText("Registro guardado.");
    expect(app.deps.api.edited[0]).toEqual({
      entryId: "entry-1",
      value: { kind: "quantity", value: "25" },
      note: "nota",
    });
  });
});
