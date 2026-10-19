import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { quantity, reading } from "../../../testing/fixtures/edit-rows.ts";
import {
  activeTodayFixture,
  FIXTURE_DAY_NOW_MS,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const QUEUED = "Guardado en este teléfono. Se enviará al volver la conexión.";
const LINE = "Sin conexión: se guardará en este teléfono.";

describe("the record sheet without a connection (OE-R8.S1)", () => {
  const open = () =>
    renderApp({
      online: false,
      now: FIXTURE_DAY_NOW_MS,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });

  it("keeps Registrar enabled and says it saves on the phone", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("button", { name: "Registrar 20 min" })).toBeEnabled();
    expect(within(dialog).getByText(LINE)).toBeInTheDocument();
    expect(within(dialog).queryByText("Sin conexión: no se puede guardar.")).toBeNull();
  });

  it("saves into the outbox, closes the sheet and confirms with a toast that can be undone", async () => {
    const app = open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Añadir nota o foto" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Nota (opcional)" }), "ok");
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeEnabled();
    expect(app.deps.api.calls.recordEntry).toBe(0);
    expect(app.deps.outboxStore.load("user-1").items).toEqual([
      expect.objectContaining({
        kind: "record",
        habitName: "Leer",
        command: expect.objectContaining({
          value: { kind: "quantity", value: "20" },
          note: "ok",
          forDate: "2026-10-02",
        }),
      }),
    ]);
    expect(screen.queryByText("Registro guardado.")).not.toBeInTheDocument();
  });

  it("drops the sentence when the connection returns", async () => {
    const app = open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    app.deps.connectivity.setOnline(true);
    await waitFor(() => expect(within(dialog).queryByText(LINE)).not.toBeInTheDocument());
  });
});

describe("the edit sheet without a connection (OE-R8.S1)", () => {
  const open = () =>
    renderApp({
      online: false,
      path: "/?entry=commitment-2&id=entry-1",
      today: activeTodayFixture({ rows: [reading([quantity("25", "entry-1")])] }),
    });

  it("keeps Guardar and Borrar enabled and says it saves on the phone", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("button", { name: "Guardar 25 min" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Borrar registro" })).toBeEnabled();
    expect(within(dialog).getByText(LINE)).toBeInTheDocument();
  });

  it("queues the edit and closes with the queued confirmation", async () => {
    const app = open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 30 min" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(QUEUED)).toBeInTheDocument();
    expect(app.deps.api.calls.editEntry).toBe(0);
    expect(app.deps.outboxStore.load("user-1").items).toEqual([
      expect.objectContaining({
        kind: "edit",
        target: "entry-1",
        habitName: "Leer",
        value: { kind: "quantity", value: "30" },
      }),
    ]);
  });

  it("queues the delete and says it was deleted on the phone", async () => {
    const app = open();
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    expect(
      await screen.findByText(
        "Registro borrado en este teléfono. Se enviará al volver la conexión.",
      ),
    ).toBeInTheDocument();
    expect(app.deps.api.calls.deleteEntry).toBe(0);
    expect(app.deps.outboxStore.load("user-1").items).toEqual([
      expect.objectContaining({ kind: "delete", target: "entry-1" }),
    ]);
  });
});
