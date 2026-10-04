import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  pendingItemFixture,
  pointsFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("De ayer: copy of yesterday (WB-6)", () => {
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
