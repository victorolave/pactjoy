import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { quantity, reading } from "../../../testing/fixtures/edit-rows.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  entryFixture,
  pendingItemFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const BADGE = "Pendiente de sincronizar";
const FOOTNOTE = "Puntos y clasificación se actualizan al sincronizar.";

const offlineDay = () =>
  renderApp({
    online: false,
    today: activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }),
  });

describe("Today shows what is waiting on the phone (OE-R7, design 15g)", () => {
  it("a queued tap fills the circle, says where it is saved and badges the row (OE-R7.S1)", async () => {
    offlineDay();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    expect(await screen.findByText("Registrado en este teléfono")).toBeInTheDocument();
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(screen.getByText(FOOTNOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The count and the points are the server's: nothing is scored on the phone.
    expect(screen.getByText("0 de 1 registrados")).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ pts?/)).not.toBeInTheDocument();
  });

  it("keeps the fill after the optimistic one lets go: the queued entry is what is shown", async () => {
    offlineDay();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await screen.findByText("Registrado en este teléfono");
    await new Promise((resolve) => setTimeout(resolve, 4300));
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }, 10_000);

  it("shows no footnote and no badge when nothing is queued", async () => {
    renderApp({ today: activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }) });
    await screen.findByRole("heading", { name: "Meditar" });
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
  });

  it("undoing a pending tap returns the row to the server's state (OE-R7.S3)", async () => {
    const app = offlineDay();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await screen.findByText("Registrado en este teléfono");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer registro" }));
    await waitFor(() => expect(screen.queryByText(BADGE)).not.toBeInTheDocument());
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
    expect(app.deps.outboxStore.load("user-1").items).toEqual([]);
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("opens the edit of a pending quantity with the queued value, and saving coalesces (OE-R7.S4)", async () => {
    const app = renderApp({
      online: false,
      path: "/?entry=commitment-2",
      today: activeTodayFixture({ rows: [weekRowFixture()] }),
    });
    const record = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(record).getByRole("button", { name: "Registrar 20 min" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Registrado en este teléfono")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Editar registro de Leer" }));
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    expect(within(dialog).getByRole("textbox", { name: "Cantidad" })).toHaveValue("20");
    await userEvent.click(within(dialog).getByRole("button", { name: "Más" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Guardar 25 min" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const items = app.deps.outboxStore.load("user-1").items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "record",
      attempted: false,
      command: { value: { kind: "quantity", value: "25" }, clientRequestId: "id-1" },
    });
    expect(app.deps.api.calls.recordEntry).toBe(0);
  });

  it("a queued delete hides the entry and the row says it was deleted on the phone", async () => {
    renderApp({
      online: false,
      path: "/?entry=commitment-2&id=entry-1",
      today: activeTodayFixture({ rows: [reading([quantity("25", "entry-1")])] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar registro" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    expect(await screen.findByText("Borrado en este teléfono")).toBeInTheDocument();
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar registro de Leer" })).toBeNull();
  });

  it("a record queued for yesterday leaves the open ones and shows as pending in De ayer (OE-R7.S2)", async () => {
    const row = dayRowFixture({ habitName: "Meditar" });
    renderApp({
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
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar de ayer" }));
    expect(
      await screen.findByRole("button", { name: "Editar registro de Meditar de ayer" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar Meditar de ayer" })).toBeNull();
    const card = screen.getByRole("heading", { name: "De ayer" }).closest("section");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(BADGE)).toBeInTheDocument();
  });

  it("the badges go when the queue has been sent and Today holds the entry (OE-R7.S5)", async () => {
    const app = offlineDay();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await screen.findByText(BADGE);
    // What the server will answer once the record is in.
    app.deps.api.setToday(
      activeTodayFixture({
        rows: [
          dayRowFixture({
            habitName: "Meditar",
            entries: [entryFixture({ kind: "done" }, { entryId: "entry-1" as never })],
          }),
        ],
      }),
    );
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(screen.queryByText(BADGE)).not.toBeInTheDocument());
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
    expect(app.deps.api.recorded).toHaveLength(1);
  });

  it("a sent record keeps its row filled until Today has it, so a second tap does not record again", async () => {
    const app = renderApp({
      online: false,
      today: activeTodayFixture({
        rows: [
          dayRowFixture({ habitName: "Meditar" }),
          dayRowFixture({
            habitName: "Leer",
            commitmentId: "commitment-3" as never,
          }),
        ],
      }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Leer" }));
    await waitFor(() => expect(app.deps.outboxStore.load("user-1").items).toHaveLength(2));
    const fetchesBefore = app.deps.api.calls.getToday;
    // The fetch the replay asks for once it is done is held, so the window between the send and
    // the refetch can be looked at.
    const releaseToday = app.deps.api.hold("getToday");
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(app.deps.api.recorded).toHaveLength(2));
    await waitFor(() => expect(app.deps.api.calls.getToday).toBeGreaterThan(fetchesBefore));
    await waitFor(() => expect(app.deps.outboxStore.load("user-1").items).toEqual([]));
    for (const name of ["Registrar Meditar", "Registrar Leer"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
    }
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    expect(app.deps.api.recordAttempts).toHaveLength(2);
    // The refetch comes back without the entries (outside the window, or deleted elsewhere): the
    // phone keeps no phantom entry once the server has answered.
    releaseToday();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(screen.queryByText(BADGE)).not.toBeInTheDocument();
    expect(screen.queryByText(FOOTNOTE)).not.toBeInTheDocument();
  });
});
