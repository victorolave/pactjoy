import type { TodayRow } from "@pactjoy/app";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { myPauseRequestsFixture, pauseRequestFixture } from "../../../testing/fixtures/pause.ts";
import {
  type DayRow,
  dayRowFixture,
  entryFixture,
  todayPauseFixture,
  type WeekRow,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { TodayRowCard } from "./TodayRowCard.tsx";

const show = (row: TodayRow, action?: ReactNode, below?: ReactNode) =>
  render(<TodayRowCard row={row} action={action} below={below} />);

const control = <button type="button">Registrar</button>;

const state = (value: DayRow["opportunity"]["state"], overrides: Partial<DayRow> = {}) =>
  dayRowFixture({ opportunity: { state: value, graceUntil: null }, ...overrides });

describe("TodayRowCard routing (TO-R5)", () => {
  it("renders a day row and the control it is given while the row is open", () => {
    show(dayRowFixture(), control);
    expect(screen.getByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("offers the control on a logged row too (it opens the edit)", () => {
    show(state("logged"), control);
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("never offers a control on a closed row, and says it is closed", () => {
    show(state("closed"), control);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Cerrado")).toBeInTheDocument();
  });

  it("never offers a control on a day that does not fall today", () => {
    show(dayRowFixture({ scheduledToday: false }), control);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["paused", "onHold"] as const)(
    "renders a %s row read-only, whatever the caller offers",
    (value) => {
      show(state(value), control);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText(value === "paused" ? "En pausa" : "En espera")).toBeInTheDocument();
    },
  );

  it("shows the content under a writable row, and hides it on a closed one", () => {
    const note = <p>Aviso en la fila</p>;
    const { unmount } = show(dayRowFixture(), undefined, note);
    expect(screen.getByText("Aviso en la fila")).toBeInTheDocument();
    unmount();
    show(state("closed"), undefined, note);
    expect(screen.queryByText("Aviso en la fila")).not.toBeInTheDocument();
  });

  it("gives the row one padding only: the card is flush and the content insets itself", () => {
    show(dayRowFixture());
    expect(screen.getByRole("article")).toHaveClass("pj-card--flush");
  });

  it("routes a week row to the week card", () => {
    show(weekRowFixture(), control);
    expect(screen.getByText("2 de 3 esta semana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("does not ask for a control when the week is closed", () => {
    show(weekRowFixture({ opportunity: { state: "closed", graceUntil: null } }), control);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("changes waiting on the phone (OE-R7, design 15g)", () => {
  const localDone = dayRowFixture({
    entries: [entryFixture({ kind: "done" }, { entryId: "local:a" as never })],
  });

  it("a pending record says so under the title and carries the badge, with no points", () => {
    const earned = dayRowFixture({
      ...localDone,
      points: { ...localDone.points, earned: 8 },
    });
    render(<TodayRowCard row={earned} pending="record" />);
    expect(screen.getByText("Registrado en este teléfono")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
    expect(screen.queryByText(/pts?$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Registrado hoy")).not.toBeInTheDocument();
  });

  it("a pending edit keeps the server's points and says the change is on the phone", () => {
    const logged = weekRowFixture({
      points: { ...weekRowFixture().points, earned: 12 },
    });
    render(<TodayRowCard row={logged} pending="edit" />);
    expect(screen.getByText("Cambio guardado en este teléfono")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
    expect(screen.getByText("+12 pts")).toBeInTheDocument();
  });

  it("a pending delete says it was deleted on the phone", () => {
    render(<TodayRowCard row={dayRowFixture()} pending="delete" />);
    expect(screen.getByText("Borrado en este teléfono")).toBeInTheDocument();
    expect(screen.getByText("Pendiente de sincronizar")).toBeInTheDocument();
  });

  it("shows neither the line nor the badge when nothing is pending", () => {
    render(<TodayRowCard row={dayRowFixture()} />);
    expect(screen.queryByText("Pendiente de sincronizar")).not.toBeInTheDocument();
    expect(screen.queryByText(/en este teléfono/)).not.toBeInTheDocument();
  });

  it("an open day row with a pending record looks done (the filled circle's row)", () => {
    render(<TodayRowCard row={localDone} pending="record" />);
    const glyph = screen.getByRole("article").querySelector('[data-tone="done"]');
    expect(glyph).not.toBeNull();
  });
});

describe("week row (TO-R4)", () => {
  it("shows sessions done of target and today's bar for timesPerWeek (TO-S7)", () => {
    show(weekRowFixture());
    expect(screen.getByRole("heading", { name: "Leer" })).toBeInTheDocument();
    expect(screen.getByText("2 de 3 esta semana")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "30");
    expect(screen.getByText("mín. 10")).toBeInTheDocument();
    expect(screen.getByText("ideal 30 min")).toBeInTheDocument();
    // The percent label is gone: the bar and its marks say it.
    expect(screen.queryByText(/\d+ %/)).not.toBeInTheDocument();
  });

  it("fills a session bar with today's amount, neutral below the minimum and gradient from it", () => {
    const logged = (value: string) =>
      weekRowFixture({
        entries: [entryFixture({ kind: "quantity", value })],
        opportunity: { state: "logged", graceUntil: null },
      });
    const { unmount } = show(logged("5"));
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({
      background: "var(--ink-400)",
    });
    unmount();
    show(logged("20"));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({
      background: "var(--gradient-together)",
    });
  });

  it("gives a reach quantity on a day row the same bar, and a done row none", () => {
    show(
      dayRowFixture({
        measure: {
          unit: "km",
          customLabel: null,
          precision: "integer",
          target: { direction: "reach", minimum: "3", ideal: "5" },
          schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
        },
      }),
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
    expect(screen.getByText("ideal 5 km")).toBeInTheDocument();
  });

  it("shows value over ideal for a weekly total, with the minimum and ideal marks", () => {
    const row: WeekRow = weekRowFixture({
      habitName: "Inglés",
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "60", ideal: "150" },
        schedule: { period: "weeklyTotal" },
      },
      progress: {
        value: "90",
        target: { direction: "reach", minimum: "60", ideal: "150" },
        sessionsDone: 0,
        sessionsTarget: 1,
        percent: 40,
      },
    });
    show(row);
    expect(screen.getByText("90 / 150 min esta semana")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "150");
    expect(screen.getByText("mín. 60")).toBeInTheDocument();
    expect(screen.getByText("ideal 150 min")).toBeInTheDocument();
  });

  it("starts a weekly total from zero when nothing has been logged", () => {
    const row = weekRowFixture({
      measure: {
        unit: "km",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "10", ideal: "20" },
        schedule: { period: "weeklyTotal" },
      },
      progress: {
        value: null,
        target: { direction: "reach", minimum: "10", ideal: "20" },
        sessionsDone: 0,
        sessionsTarget: 1,
        percent: 0,
      },
    });
    show(row);
    expect(screen.getByText("0 / 20 km esta semana")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("shows no bar when the server has no progress (TO-R4)", () => {
    show(weekRowFixture({ progress: null }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("3 veces por semana")).toBeInTheDocument();
  });
});

describe("a pause that has not started yet (PS-12)", () => {
  const ahead = (overrides: Parameters<typeof todayPauseFixture>[0] = {}) =>
    dayRowFixture({ pause: todayPauseFixture(overrides) });

  it("keeps the open row writable and offers to cancel the approved pause ahead", async () => {
    const { deps } = renderInProviders(<TodayRowCard row={ahead()} action={control} />);
    deps.api.setMyPauseRequests(
      myPauseRequestsFixture({
        mine: [pauseRequestFixture({ status: "approved", startDate: "2026-10-05" })],
      }),
    );
    await deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar pausa" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar pausa" }),
    );
    await waitFor(() => expect(deps.api.calls.resumePause).toBe(1));
  });

  it("offers to cancel a pending request ahead", async () => {
    renderInProviders(
      <TodayRowCard row={ahead({ status: "pending", canResume: false, canCancel: true })} />,
    );
    expect(await screen.findByRole("button", { name: "Cancelar solicitud" })).toBeInTheDocument();
  });

  it("shows no pause control on a row without a pause", () => {
    show(dayRowFixture(), control);
    expect(screen.queryByRole("button", { name: /pausa|solicitud/i })).not.toBeInTheDocument();
  });
});
