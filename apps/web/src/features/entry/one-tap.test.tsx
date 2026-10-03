import type { TodayRow } from "@pactjoy/app";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  endedTodayFixture,
  entryFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { renderApp } from "../../testing/render.tsx";

const SAVED = "Registro guardado. Un paso más en tu meta.";

const openDone = (overrides: Partial<DayRow> = {}) =>
  dayRowFixture({ habitName: "Meditar", ...overrides });

const renderRow = (...rows: TodayRow[]) => renderApp({ today: activeTodayFixture({ rows }) });

const tapDone = async (habit = "Meditar") =>
  userEvent.click(await screen.findByRole("button", { name: `Registrar ${habit}` }));

describe("one tap done (EN-R1)", () => {
  it("records a done entry once and offers to undo it (EN-S1)", async () => {
    const { deps } = renderRow(openDone());
    await tapDone();
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    expect(deps.api.recorded).toEqual([
      {
        seasonId: "season-1",
        commitmentId: "commitment-1",
        forDate: "2026-10-02",
        value: { kind: "done" },
        note: null,
        clientRequestId: "id-1",
      },
    ]);
    // The server stays the source of truth: Today is refetched, nothing is computed here.
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("deletes exactly the entry it created when undone (EN-S2)", async () => {
    const { deps } = renderRow(openDone());
    await tapDone();
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(deps.api.deleted).toEqual(["entry-1"]));
    expect(await screen.findByText("Registro deshecho.")).toBeInTheDocument();
  });

  it("shows an error toast, and Reintentar sends the same clientRequestId (EN-S3)", async () => {
    const { deps } = renderRow(openDone());
    deps.api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    await tapDone();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos guardar el registro.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(deps.api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual(["id-1", "id-1"]);
  });

  it("issues a new request id for a new tap", async () => {
    const { deps } = renderRow(openDone());
    await tapDone();
    await screen.findByText(SAVED);
    await tapDone();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(2));
    expect(deps.api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["id-1", "id-2"]);
  });

  it("sends one request on a double tap and disables the button while saving (EN-S4)", async () => {
    const { deps } = renderRow(openDone());
    const release = deps.api.hold("recordEntry");
    const button = await screen.findByRole("button", { name: "Registrar Meditar" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    expect(deps.api.calls.recordEntry).toBe(1);
    release();
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(deps.api.recorded).toHaveLength(1);
  });

  it("tells an undo failure and offers to retry it", async () => {
    const { deps } = renderRow(openDone());
    await tapDone();
    deps.api.failNext("deleteEntry", new ApiError("NetworkError", 0, null));
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos deshacer el registro.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(deps.api.deleteAttempts).toEqual(["entry-1", "entry-1"]));
    expect(deps.api.deleted).toEqual(["entry-1"]);
  });
});

describe("the day an entry lands on (C-W4)", () => {
  it("sends the server's today as the entry's day", async () => {
    const { deps } = renderRow(openDone());
    await tapDone();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-02");
  });

  it("records on the day the user saw even if midnight passed since the screen loaded", async () => {
    const { deps } = renderRow(openDone());
    await screen.findByRole("button", { name: "Registrar Meditar" });
    // The server's clock moves to the next day, but the screen on display still shows the old one.
    deps.api.setToday(activeTodayFixture({ today: "2026-10-03" as never, rows: [openDone()] }));
    await tapDone();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-02");
  });

  it("records on the season's last day during the grace period after it ended", async () => {
    const { deps } = renderApp({
      today: endedTodayFixture({
        rows: [openDone({ opportunity: { state: "open", graceUntil: "2026-10-26" as never } })],
      }),
    });
    await tapDone();
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    // Season: 4 weeks from 2026-09-28, so the last day is 2026-10-25 while today is 2026-10-27.
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-25");
  });

  it("sends the same day for Hoy no salió", async () => {
    const { deps } = renderRow(openDone());
    await userEvent.click(await screen.findByRole("button", { name: "Hoy no salió: Meditar" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]?.forDate).toBe("2026-10-02");
  });
});

describe("Hoy no salió (EN-R2)", () => {
  it("records a missed entry (EN-S5)", async () => {
    const { deps } = renderRow(openDone());
    await userEvent.click(await screen.findByRole("button", { name: "Hoy no salió: Meditar" }));
    await waitFor(() => expect(deps.api.recorded).toHaveLength(1));
    expect(deps.api.recorded[0]).toMatchObject({ value: { kind: "missed" }, note: null });
    expect(
      await screen.findByText(/hoy no salió/i, { selector: "[role=status] *" }),
    ).toBeInTheDocument();
  });

  it("is not offered on week rows, which only open the sheet (EN-S6)", async () => {
    renderRow(weekRowFixture());
    await screen.findByRole("heading", { name: "Leer" });
    expect(screen.queryByRole("button", { name: /Hoy no salió/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("explains a 422 MissedNotAllowed inline in the row", async () => {
    const { deps } = renderRow(openDone());
    deps.api.failNext("recordEntry", new ApiError("MissedNotAllowed", 422, "req-9"));
    await userEvent.click(await screen.findByRole("button", { name: "Hoy no salió: Meditar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este compromiso no admite «Hoy no salió».",
    );
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
});

describe("failures that mean the day is closed (EN-R8)", () => {
  it("shows a code-specific message in the row and refetches Today (EN-S14)", async () => {
    const { deps } = renderRow(openDone());
    deps.api.failNext("recordEntry", new ApiError("WindowClosed", 409, "req-2"));
    await tapDone();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ya no se puede registrar este día.");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    await waitFor(() => expect(deps.api.calls.getToday).toBe(2));
  });

  it("clears the inline message on the next attempt", async () => {
    const { deps } = renderRow(openDone());
    deps.api.failNext("recordEntry", new ApiError("WindowClosed", 409, "req-2"));
    await tapDone();
    await screen.findByRole("alert");
    await tapDone();
    await screen.findByText(SAVED);
    expect(screen.queryByText("Ya no se puede registrar este día.")).not.toBeInTheDocument();
  });
});

describe("rows that cannot be written", () => {
  it("offers no register control on a logged, closed, paused or not-today row", async () => {
    renderRow(
      openDone({
        habitName: "Logged",
        opportunity: { state: "logged", graceUntil: null },
        entries: [entryFixture({ kind: "done" })],
      }),
      openDone({ habitName: "Closed", opportunity: { state: "closed", graceUntil: null } }),
      openDone({ habitName: "Paused", opportunity: { state: "paused", graceUntil: null } }),
      openDone({ habitName: "Elsewhere", scheduledToday: false }),
    );
    await screen.findByRole("heading", { name: "Logged" });
    // The logged row can be edited; nothing else has a control.
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Editar registro de Logged",
    ]);
  });

  it("opens the sheet on a quantity row instead of recording at once", async () => {
    const { deps } = renderRow(
      dayRowFixture({
        habitName: "Correr",
        measure: {
          unit: "km",
          customLabel: null,
          precision: "integer",
          target: { direction: "reach", minimum: "3", ideal: "5" },
          schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
        },
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Correr" }));
    expect(await screen.findByRole("dialog", { name: "Correr" })).toBeInTheDocument();
    expect(deps.api.calls.recordEntry).toBe(0);
  });
});
