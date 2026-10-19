import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { OutboxNotice, OutboxState } from "../../../ports/outbox-store.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  FIXTURE_DAY_NOW_MS,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const notice = (id: string, habitName: string, forDate = "2026-10-13"): OutboxNotice => ({
  id,
  habitName,
  forDate,
  action: "record",
  reason: "closedWindow",
});

const state = (...notices: OutboxNotice[]): OutboxState => ({ v: 1, items: [], notices });

const open = () =>
  renderApp({ today: activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }) });

describe("rejected entries (OE-R5, OE-R10)", () => {
  it("shows no card when nothing was rejected", async () => {
    open();
    await screen.findByRole("heading", { name: "Meditar" });
    expect(screen.queryByText(/No pudimos enviar/)).not.toBeInTheDocument();
  });

  it("lists one rejected registro with its habit, day and reason (OE-R10.S1)", async () => {
    const { deps } = open();
    await screen.findByRole("heading", { name: "Meditar" });
    act(() => deps.outboxStore.emitExternal("user-1", state(notice("n1", "Leer"))));
    expect(await screen.findByText("No pudimos enviar un registro")).toBeInTheDocument();
    expect(
      screen.getByText("Leer · martes 13: el plazo para registrarlo ya terminó."),
    ).toBeInTheDocument();
  });

  it("counts several in the title and lists each one", async () => {
    const { deps } = open();
    await screen.findByRole("heading", { name: "Meditar" });
    act(() =>
      deps.outboxStore.emitExternal(
        "user-1",
        state(notice("n1", "Leer"), notice("n2", "Correr", "2026-10-12")),
      ),
    );
    expect(await screen.findByText("No pudimos enviar 2 registros")).toBeInTheDocument();
    expect(screen.getByText(/^Leer · martes 13:/)).toBeInTheDocument();
    expect(screen.getByText(/^Correr · lunes 12:/)).toBeInTheDocument();
  });

  it("Entendido removes them for good, from the screen and from storage", async () => {
    const { deps } = open();
    await screen.findByRole("heading", { name: "Meditar" });
    act(() => deps.outboxStore.emitExternal("user-1", state(notice("n1", "Leer"))));
    await userEvent.click(await screen.findByRole("button", { name: "Entendido" }));
    expect(screen.queryByText("No pudimos enviar un registro")).not.toBeInTheDocument();
    expect(deps.outboxStore.load("user-1").notices).toEqual([]);
  });

  it("a registro the server turned down after the wait becomes a notice that stays (OE-R4.S5, OE-R5.S1)", async () => {
    const { deps } = renderApp({
      online: false,
      now: FIXTURE_DAY_NOW_MS,
      today: activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await screen.findByText("Pendiente de sincronizar");
    deps.api.failNext("recordEntry", new ApiError("WindowClosed", 422, null));
    act(() => deps.connectivity.setOnline(true));
    const card = await screen.findByText("No pudimos enviar un registro");
    expect(card).toBeInTheDocument();
    expect(
      screen.getByText("Meditar · viernes 2: el plazo para registrarlo ya terminó."),
    ).toBeInTheDocument();
    // Persisted until the member dismisses it, and the pending badge is gone.
    expect(deps.outboxStore.load("user-1").notices).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Pendiente de sincronizar")).toBeNull());
    expect(
      within(card.closest("[role=status]") as HTMLElement).getByRole("button", {
        name: "Entendido",
      }),
    ).toBeInTheDocument();
  });
});
