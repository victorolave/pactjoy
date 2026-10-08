import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { weekSummaryKey } from "../../../shared/query-keys.ts";
import { pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import {
  activeSeasonProgress,
  commitmentProgress,
  weekSummary,
} from "../../../testing/fixtures/season-progress.ts";
import { activeTodayFixture, endedTodayFixture } from "../../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderApp } from "../../../testing/render.tsx";

const DAY = "2026-09-22";
const NOW = Date.parse(`${DAY}T12:00:00Z`);
const firstDay = () => {
  const base = activeTodayFixture();
  return activeTodayFixture({
    today: DAY as typeof base.today,
    timeZone: "Europe/Madrid" as typeof base.timeZone,
    season: { ...base.season, actualStart: "2026-08-25" as typeof base.today, lengthWeeks: 8 },
    summary: { ...base.summary, week: 5, weekCount: 8 },
  });
};

function setup(today = firstDay(), now = NOW, deviceStorage = new MemoryStorage()) {
  const app = renderApp({
    today,
    now,
    deviceStorage,
    myCircle: pairCircleFixture({
      id: "season-1",
      phase: "active",
      lengthWeeks: 8,
      week: 5,
      approvalCount: 2,
    }),
  });
  app.deps.api.progress.setWeekSummary("season-1", 3, weekSummary());
  return app;
}

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("Today weekly summary integration (25a)", () => {
  it.each([1, 2, 6])(
    "places the live card after the greeting without replacing entries (%i members)",
    async (count) => {
      const today = firstDay();
      const app = setup({
        ...today,
        standings: { ...today.standings, eligibleParticipantCount: count },
      });
      const card = await screen.findByText("Semana 4 cerrada");
      expect(screen.getByText("+96 pts · consistencia 83 %")).toBeVisible();
      const greeting = screen.getByRole("heading", { name: "Hola, Victor" });
      const entries = screen.getByRole("heading", { name: "Para hoy" });
      expect(
        greeting.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(card.compareDocumentPosition(entries) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Registrar Meditar" }));
      await waitFor(() => expect(app.deps.api.calls.recordEntry).toBe(1));
      expect(screen.getByRole("link", { name: "Leer" })).toBeVisible();
    },
  );

  it("opening consumes only this device's flag; close stays dismissed, Temporada can reopen", async () => {
    const storage = new MemoryStorage();
    const app = setup(firstDay(), NOW, storage);
    app.deps.api.progress.setSeasonProgress("season-1", activeSeasonProgress());
    await userEvent.click(await screen.findByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("button", { name: "Seguir con mi día" })).toBeVisible();
    expect(app.location()).toBe("/season/season-1/weeks/3/summary");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    await screen.findByRole("heading", { name: "Hola, Victor" });
    expect(screen.queryByText("Semana 4 cerrada")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Temporada" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ver" }));
    expect(await screen.findByRole("button", { name: "Seguir con mi día" })).toBeVisible();
    app.unmount();
    const same = setup(firstDay(), NOW, storage);
    await screen.findByRole("heading", { name: "Hola, Victor" });
    expect(screen.queryByText("Semana 4 cerrada")).not.toBeInTheDocument();
    same.unmount();
    setup();
    expect(await screen.findByText("Semana 4 cerrada")).toBeVisible();
  });

  it.each(["2026-08-25", "2026-09-23"])(
    "does not fetch a summary on ineligible day %s",
    async (day) => {
      const today = firstDay();
      const app = setup(
        { ...today, today: day as typeof today.today },
        Date.parse(`${day}T12:00Z`),
      );
      await screen.findByRole("heading", { name: "Hola, Victor" });
      expect(screen.queryByRole("button", { name: "Ver" })).not.toBeInTheDocument();
      expect(app.deps.api.calls.getWeekSummary).toBe(0);
    },
  );

  it("retries a failed summary independently, keeping registration controls", async () => {
    const app = setup();
    app.deps.api.progress.failNext("getWeekSummary", new ApiError("NetworkError", 0, null));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar la temporada.");
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Semana 4 cerrada")).toBeVisible();
  });

  it("renders updated live summary figures after invalidation, never a local score", async () => {
    const app = setup();
    await screen.findByText("+96 pts · consistencia 83 %");
    app.deps.api.progress.setWeekSummary(
      "season-1",
      3,
      weekSummary({ points: 102, consistency: 90 }),
    );
    await act(() =>
      app.deps.queryClient.invalidateQueries({ queryKey: weekSummaryKey("season-1", 3) }),
    );
    expect(await screen.findByText("+102 pts · consistencia 90 %")).toBeVisible();
  });

  it.each(["day", "week", "paused"])(
    "%s title opens detail with Today back origin, independently of entry controls",
    async (kind) => {
      const today = firstDay();
      const row = today.rows[kind === "week" ? 1 : 0];
      if (!row) throw new Error("fixture row required");
      const app = setup({
        ...today,
        rows: [
          {
            ...row,
            opportunity:
              kind === "paused" ? { state: "paused", graceUntil: null } : row.opportunity,
          },
        ],
      });
      app.deps.api.progress.setCommitmentProgress(
        "season-1",
        row.commitmentId,
        commitmentProgress(),
      );
      const link = await screen.findByRole("link", { name: row.habitName });
      expect(link).toHaveAttribute("href", `/season/season-1/commitments/${row.commitmentId}`);
      await userEvent.click(link);
      await userEvent.click(await screen.findByRole("button", { name: "Volver" }));
      expect(app.location()).toBe("/");
      expect(await screen.findByRole("heading", { name: "Hola, Victor" })).toBeVisible();
    },
  );

  it.each(["timer", "resume"])(
    "expires at season-local midnight via %s even if Today refetch fails",
    async (mode) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const app = setup(firstDay(), Date.parse(`${DAY}T21:59:59Z`));
      await screen.findByText("Semana 4 cerrada");
      app.deps.api.failNext("getToday", new ApiError("NetworkError", 0, null));
      if (mode === "resume") act(() => focusManager.setFocused(false));
      app.deps.clock.advanceSeconds(2);
      if (mode === "resume") act(() => focusManager.setFocused(true));
      else await act(() => vi.advanceTimersByTimeAsync(2000));
      await waitFor(() => expect(screen.queryByText("Semana 4 cerrada")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeVisible();
      expect(app.deps.api.calls.getToday).toBeGreaterThan(1);
    },
  );

  it("refreshes Today after final-season grace expires without requiring focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const old = endedTodayFixture();
    const app = renderApp({ today: old, now: Date.parse("2026-10-28T04:59:59Z") });
    await screen.findByText("Temporada terminada");
    const score = old.summary.score;
    if (score.kind !== "scored") throw new Error("scored fixture required");
    app.deps.api.setToday({
      ...old,
      summary: { ...old.summary, score: { ...score, points: 777 } },
    });
    app.deps.clock.advanceSeconds(2);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText("777")).toBeVisible();
  });

  it("keeps the banner through the 25-hour DST day, expiring only at Madrid midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const today = firstDay();
    const app = setup(
      {
        ...today,
        today: "2026-10-25" as typeof today.today,
        season: { ...today.season, actualStart: "2026-09-27" as typeof today.today },
      },
      Date.parse("2026-10-25T00:59:59Z"),
    );
    await screen.findByText("Semana 4 cerrada");
    app.deps.clock.advanceSeconds(2);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Semana 4 cerrada")).toBeVisible();
    app.deps.clock.advanceSeconds(22 * 60 * 60);
    await act(() => vi.advanceTimersByTimeAsync(22 * 60 * 60 * 1000));
    expect(screen.queryByText("Semana 4 cerrada")).not.toBeInTheDocument();
  });

  it("includes the final week's live summary on the first day after the season ends", async () => {
    const today = firstDay();
    const app = setup(
      { ...today, state: "ended", today: "2026-10-20" as typeof today.today },
      Date.parse("2026-10-20T12:00Z"),
    );
    app.deps.api.progress.setWeekSummary(
      "season-1",
      7,
      weekSummary({ weekIndex: 7, weeksLeft: 0 }),
    );
    expect(await screen.findByText("Semana 8 cerrada")).toBeVisible();
    expect(screen.getByText("Temporada terminada")).toBeVisible();
  });
});
