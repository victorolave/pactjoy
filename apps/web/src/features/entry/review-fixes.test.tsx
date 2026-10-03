import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
  pendingItemFixture,
  pointsFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

const circle = (name: string) => screen.findByRole("button", { name: `Registrar ${name}` });

describe("one-tap: a stale entry id never reaches the undo (WA-W4)", () => {
  it("does not offer to undo a tap whose entry the server has not answered yet", async () => {
    const row = dayRowFixture({ habitName: "Meditar" });
    const { deps } = renderApp({ today: activeTodayFixture({ rows: [row] }) });
    // First tap answers entry-1; the fill then lets go because the server never shows it.
    await userEvent.click(await circle("Meditar"));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    act(() => vi.advanceTimersByTime(4000));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    // Second tap is still in flight: its own entry is unknown, entry-1 is not it.
    deps.api.hold("recordEntry");
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
    expect(screen.queryByRole("dialog", { name: "¿Deshacer registro?" })).not.toBeInTheDocument();
  });

  it("closes the undo question when the entry it was about is gone", async () => {
    const logged: DayRow = {
      ...dayRowFixture({ habitName: "Meditar" }),
      opportunity: { state: "logged", graceUntil: "2026-10-03" as never },
      entries: [entryFixture({ kind: "done" })],
    };
    const { deps } = renderApp({ today: activeTodayFixture({ rows: [logged] }) });
    await userEvent.click(await circle("Meditar"));
    expect(await screen.findByRole("dialog", { name: "¿Deshacer registro?" })).toBeInTheDocument();
    // The server now says the entry is gone (deleted elsewhere): the question has no subject.
    deps.api.setToday(activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] }));
    await act(() => deps.queryClient.invalidateQueries());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "¿Deshacer registro?" })).not.toBeInTheDocument(),
    );
    // ...and when an entry shows up again later, the old question does not come back by itself.
    deps.api.setToday(activeTodayFixture({ rows: [logged] }));
    await act(() => deps.queryClient.invalidateQueries());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Registrar Meditar" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.queryByRole("dialog", { name: "¿Deshacer registro?" })).not.toBeInTheDocument();
  });
});

describe("De ayer: no second registration after the first (WB-3)", () => {
  it("disables both controls once the entry is recorded, and the check does not unfill while the item is listed", async () => {
    const { deps } = renderApp({
      today: activeTodayFixture({ pendingYesterday: [pendingItemFixture()] }),
    });
    const done = await circle("Dibujar de ayer");
    await userEvent.click(done);
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    const miss = screen.getByRole("button", { name: "Ayer no salió: Dibujar" });
    await waitFor(() => expect(miss).toBeDisabled());
    expect(done).toBeDisabled();
    // Past the settle time the check is still filled: the item is still on the list.
    act(() => vi.advanceTimersByTime(5000));
    expect(done).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(miss);
    expect(deps.api.recorded).toHaveLength(1);
  });
});

describe("De ayer: copy of yesterday (WB-6)", () => {
  it("the cross says it was yesterday's that did not go out", async () => {
    renderApp({ today: activeTodayFixture({ pendingYesterday: [pendingItemFixture()] }) });
    await userEvent.click(await screen.findByRole("button", { name: "Ayer no salió: Dibujar" }));
    expect(await screen.findByText("Anotado: ayer no salió.")).toBeInTheDocument();
  });

  it("the limit sheet does not say hoy once Ayer is chosen", async () => {
    const coffee = dayRowFixture({
      commitmentId: "commitment-9" as DayRow["commitmentId"],
      habitName: "Café",
      measure: {
        unit: "times",
        customLabel: "cafés",
        precision: "integer",
        target: { direction: "limit", ideal: "2", tolerance: "4" },
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3, 4] } },
      },
      points: pointsFixture({
        perOpportunity: "3",
        earned: null,
        limitPercents: [100, 100, 100, 75, 50, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    });
    renderApp({
      path: "/?entry=commitment-9&day=ayer",
      today: activeTodayFixture({
        rows: [coffee],
        pendingYesterday: [
          pendingItemFixture({
            commitmentId: "commitment-9" as never,
            habitName: "Café",
            measure: coffee.measure,
            points: coffee.points,
          }),
        ],
      }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Café" });
    expect(within(dialog).getByText("Registra lo de ayer, aunque sea 0.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/de hoy/)).not.toBeInTheDocument();
  });
});

describe("the day of a registro is frozen when it is sent (WB-2, WB-4)", () => {
  const running = (): DayRow =>
    dayRowFixture({
      commitmentId: "commitment-9" as DayRow["commitmentId"],
      habitName: "Correr",
      measure: {
        unit: "km",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "3", ideal: "5" },
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3, 4] } },
      },
    });
  const pendingOf = (row: DayRow) =>
    pendingItemFixture({
      commitmentId: row.commitmentId as never,
      habitName: row.habitName,
      measure: row.measure,
      points: row.points,
    });

  it("a retry reuses its request id only for the same day (the signature includes forDate)", async () => {
    const row = running();
    const { deps } = renderApp({
      path: "/?entry=commitment-9",
      today: activeTodayFixture({ rows: [row], pendingYesterday: [pendingOf(row)] }),
    });
    deps.api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }));
    await within(dialog).findByRole("alert");
    // Same value, another day: it is another entry, with its own id.
    await userEvent.click(within(dialog).getByRole("radio", { name: "Hoy" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    const ids = deps.api.recordAttempts.map((attempt) => attempt.clientRequestId);
    expect(ids[0]).not.toBe(ids[1]);
    expect(deps.api.recordAttempts.map((attempt) => attempt.forDate)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("the confirmation keeps saying ayer after the refetch stops listing the item", async () => {
    const row = running();
    const { deps } = renderApp({
      path: "/?entry=commitment-9",
      today: activeTodayFixture({ rows: [row], pendingYesterday: [pendingOf(row)] }),
    });
    const dialog = await screen.findByRole("dialog", { name: "Correr" });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Ayer/ }));
    // What the server answers after the save: yesterday is no longer pending, and today's row (same
    // commitment) now shows points of its own. A confirmation that flipped to "today" would show them.
    const earnedToday = { ...row, points: { ...row.points, earned: 8 } };
    deps.api.setToday(activeTodayFixture({ rows: [earnedToday], pendingYesterday: [] }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 4 km de ayer" }));
    await screen.findByText("Correr · 4 km · ayer");
    await waitFor(() => expect(deps.api.calls.getToday).toBeGreaterThan(1));
    expect(screen.getByText("Correr · 4 km · ayer")).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ pts/)).not.toBeInTheDocument();
  });
});

describe("a week row's sheet uses its prorated thresholds (WA-W2)", () => {
  it("previews against the week's own minimum and ideal, not the commitment's", async () => {
    const row = weekRowFixture({
      progress: {
        value: null,
        target: { direction: "reach", minimum: "5", ideal: "15" },
        sessionsDone: 0,
        sessionsTarget: 2,
        percent: 0,
      },
    });
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [row] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    // measure says 10 / 30, the prorated week says 5 / 15.
    expect(within(dialog).getByText("20 / 15 min")).toBeInTheDocument();
    expect(within(dialog).getByText(/Ideal alcanzado/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/\+\d+ pts/)).not.toBeInTheDocument();
  });
});

describe("after a save, the confirmation is announced and focused (WA-W5)", () => {
  it("moves focus into the confirmation, announces it, and hides the duplicate illustration", async () => {
    const row = weekRowFixture();
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [row] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const title = await screen.findByText("Registro guardado.");
    const confirmation = title.closest("[role='status']") as HTMLElement;
    expect(confirmation).not.toBeNull();
    expect(confirmation.contains(document.activeElement)).toBe(true);
    expect(confirmation.querySelector("img")).toHaveAttribute("alt", "");
  });
});

describe("closing is idempotent (WA-S4)", () => {
  it("Escape and the button in the same tick close once and leave one toast", async () => {
    const row = weekRowFixture();
    renderApp({ path: "/?entry=commitment-2", today: activeTodayFixture({ rows: [row] }) });
    const dialog = await screen.findByRole("dialog", { name: "Leer" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
    const cta = await screen.findByRole("button", { name: "Seguir con mi día" });
    act(() => {
      fireEvent.click(cta);
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
