import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  endedTodayFixture,
  pendingItemFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const limitItem = () =>
  pendingItemFixture({
    commitmentId: "commitment-8" as never,
    habitName: "Café",
    measure: {
      unit: "times",
      customLabel: "cafés",
      precision: "integer",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3] } },
    },
  });

const quantityItem = () =>
  pendingItemFixture({
    commitmentId: "commitment-9" as never,
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3] } },
    },
  });

const show = (items = [pendingItemFixture()]) =>
  renderApp({ today: activeTodayFixture({ pendingYesterday: items }) });

describe("the De ayer card (design 15d)", () => {
  it("lists what is pending, with its day, above Para hoy", async () => {
    show();
    const card = (await screen.findByText("De ayer")).closest(".pj-card") as HTMLElement;
    expect(
      within(card).getByText("Puedes registrarlo hasta el final de hoy. Cuenta igual."),
    ).toBeInTheDocument();
    expect(within(card).getByText("Dibujar")).toBeInTheDocument();
    expect(within(card).getByText("Jueves 1")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Para hoy" });
    expect(card.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is on the warm surface of the design, without a border", async () => {
    show();
    const card = (await screen.findByText("De ayer")).closest(".pj-card");
    expect(card).toHaveClass("pj-card--warm");
  });

  it("is not there when nothing is pending, or when the season has ended", async () => {
    show([]);
    await screen.findByRole("heading", { name: "Para hoy" });
    expect(screen.queryByText("De ayer")).not.toBeInTheDocument();
  });

  it("registers a done item for yesterday with one tap", async () => {
    const { deps } = show();
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Dibujar de ayer" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({
      commitmentId: "commitment-7",
      forDate: "2026-10-01",
      value: { kind: "done" },
    });
    expect(
      await screen.findByText("Registro guardado. Un paso más en tu meta."),
    ).toBeInTheDocument();
  });

  it("records Hoy no salió for yesterday, not for today", async () => {
    const { deps } = show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Hoy no salió: Dibujar de ayer" }),
    );
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({
      forDate: "2026-10-01",
      value: { kind: "missed" },
    });
  });

  it("opens the sheet for yesterday when the item has a quantity", async () => {
    const app = show([quantityItem()]);
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Correr de ayer" }));
    expect(app.location()).toBe("/?entry=commitment-9&day=ayer");
  });

  it("does not offer Hoy no salió on a limit: its real value, 0 included, is what counts", async () => {
    show([limitItem()]);
    await screen.findByText("De ayer");
    expect(screen.getByRole("button", { name: "Registrar Café de ayer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hoy no salió: Café/ })).not.toBeInTheDocument();
  });

  it("lists several items, each with its own controls", async () => {
    show([pendingItemFixture(), quantityItem()]);
    await screen.findByText("De ayer");
    expect(screen.getByRole("button", { name: "Registrar Dibujar de ayer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Correr de ayer" })).toBeInTheDocument();
  });

  it("goes away once the server stops listing it", async () => {
    const { deps } = show();
    const register = await screen.findByRole("button", { name: "Registrar Dibujar de ayer" });
    // What the server answers on the refetch after the save: yesterday is no longer pending.
    deps.api.setToday(activeTodayFixture({ pendingYesterday: [] }));
    await userEvent.click(register);
    await waitFor(() => expect(screen.queryByText("De ayer")).not.toBeInTheDocument());
  });

  it("is offered next to a day that is not scheduled today too", async () => {
    renderApp({
      today: activeTodayFixture({
        rows: [dayRowFixture({ scheduledToday: false })],
        pendingYesterday: [pendingItemFixture()],
      }),
    });
    expect(await screen.findByText("De ayer")).toBeInTheDocument();
  });

  it("an ended season shows none", async () => {
    renderApp({ today: endedTodayFixture() });
    await screen.findByText("Temporada terminada");
    expect(screen.queryByText("De ayer")).not.toBeInTheDocument();
  });
});
