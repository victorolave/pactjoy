import { readFileSync } from "node:fs";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  entryFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const open = (): DayRow => dayRowFixture({ habitName: "Dibujar" });
const logged = (): DayRow => ({
  ...open(),
  opportunity: { state: "logged", graceUntil: "2026-10-03" as never },
  entries: [entryFixture({ kind: "done" })],
  points: { perOpportunity: "8", earned: 8, limitPercents: null },
});

const render = (row: DayRow) => renderApp({ today: activeTodayFixture({ rows: [row] }) });
const circle = () => screen.findByRole("button", { name: "Registrar Dibujar" });

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("the one-tap motion (design 16)", () => {
  it("fills the circle at once, before the server answers, without disabling it", async () => {
    const { deps } = render(open());
    const release = deps.api.hold("recordEntry");
    const button = await circle();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    // Disabling it would grey the border mid-transition: the double tap is guarded instead.
    expect(button).toBeEnabled();
    expect(await screen.findByText("Registrado hoy")).toBeInTheDocument();
    release();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
  });

  it("sends one request on a double tap", async () => {
    const { deps } = render(open());
    const release = deps.api.hold("recordEntry");
    await userEvent.dblClick(await circle());
    expect(deps.api.calls.recordEntry).toBe(1);
    release();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
  });

  it("gives a light haptic tap on the tap, as the prototype does", async () => {
    const { deps } = render(open());
    await userEvent.click(await circle());
    expect(deps.haptics.taps).toBe(1);
  });

  it("keeps the same button element through the whole transition (no remount)", async () => {
    const { deps } = render(open());
    const button = await circle();
    await userEvent.click(button);
    deps.api.setToday(activeTodayFixture({ rows: [logged()] }));
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
    expect(screen.getByRole("button", { name: "Registrar Dibujar" })).toBe(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("reverts the fill and shows the retry toast when the server fails", async () => {
    const { deps } = render(open());
    deps.api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    const button = await circle();
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos guardar el registro.");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Registrado hoy")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("lets go of the optimistic fill if the server never shows the entry", async () => {
    const { deps } = render(open());
    const button = await circle();
    await userEvent.click(button);
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(button).toHaveAttribute("aria-pressed", "true");
    act(() => vi.advanceTimersByTime(4000));
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("collapses 'Hoy no salió' with the tap instead of unmounting it, so the row does not jump", async () => {
    const { container } = render(open());
    const button = await circle();
    const missed = screen.getByRole("button", { name: "Hoy no salió: Dibujar" });
    const wrap = missed.closest("[data-open]");
    expect(wrap).toHaveAttribute("data-open", "true");
    await userEvent.click(button);
    expect(container.contains(missed)).toBe(true);
    expect(wrap).toHaveAttribute("data-open", "false");
    // Out of reach while collapsed.
    expect(wrap).toHaveAttribute("aria-hidden", "true");
    expect(within(wrap as HTMLElement).getByRole("button", { hidden: true })).toBeDisabled();
  });

  it("shows the points when the server's number arrives, rising in", async () => {
    const { deps } = render(open());
    const button = await circle();
    // What the refetch after the save will answer.
    deps.api.setToday(activeTodayFixture({ rows: [logged()] }));
    await userEvent.click(button);
    expect(await screen.findByText("+8 pts")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the motion respects reduced motion", () => {
  const css = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

  it.each(["./check-circle.module.css", "../today/rows/rows.module.css"])(
    "%s calms its animation and transition under prefers-reduced-motion",
    (file) => {
      expect(css(file)).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    },
  );
});
