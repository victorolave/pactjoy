import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTodayFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

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
