import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
} from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

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
