import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { todayKey } from "../../../shared/query-keys.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  pendingItemFixture,
  weekRowFixture,
} from "../../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderApp } from "../../../testing/render.tsx";
import { seedPersistedToday } from "../../../testing/seed-persisted-today.ts";

const NOT_LOADED = "Hoy todavía no se cargó; conéctate para registrar.";
// The fixture's day is Friday 2026-10-02 (America/Bogota, UTC-5).
const NEXT_MORNING = Date.parse("2026-10-03T13:00:00Z"); // 08:00 on 2026-10-03
const SAME_DAY = Date.parse("2026-10-02T15:00:00Z"); // 10:00 on 2026-10-02
const offline = new ApiError("NetworkError", 0, null);
const day = () => activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] });

describe("a saved Today whose day is over on the phone (C1)", () => {
  it("never queues a tap against the saved day once midnight passed offline", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, day());
    const app = renderApp({
      online: false,
      storage,
      today: day(),
      now: NEXT_MORNING,
      todayFailures: [offline, offline],
    });
    expect(await screen.findByText(NOT_LOADED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar Meditar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hoy no salió: Meditar" })).not.toBeInTheDocument();
    expect(app.deps.outboxStore.load("user-1").items).toEqual([]);
  });

  it("also closes a day the server sent in this session when midnight passes without a connection", async () => {
    const app = renderApp({ today: day(), now: SAME_DAY });
    await screen.findByRole("button", { name: "Registrar Meditar" });
    act(() => app.deps.connectivity.setOnline(false));
    app.deps.api.failNext("getToday", offline);
    app.deps.clock.advanceSeconds(22 * 60 * 60);
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    expect(await screen.findByText(NOT_LOADED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar Meditar" })).not.toBeInTheDocument();
  });

  it("does not open a record sheet for the saved day from its link, but does for De ayer", async () => {
    const storage = new MemoryStorage();
    const view = activeTodayFixture({
      rows: [weekRowFixture()],
      // Still inside its grace on the phone, so De ayer may offer it (an expired one is hidden, N1).
      pendingYesterday: [
        pendingItemFixture({
          commitmentId: "commitment-2" as never,
          graceUntil: "2026-10-03" as never,
        }),
      ],
    });
    seedPersistedToday(storage, view);
    const failures = [offline, offline];
    const today = renderApp({
      online: false,
      storage,
      today: view,
      now: NEXT_MORNING,
      path: "/?entry=commitment-2",
      todayFailures: failures,
    });
    await screen.findByText(NOT_LOADED);
    expect(screen.queryByRole("dialog", { name: "Leer" })).not.toBeInTheDocument();
    today.unmount();
    seedPersistedToday(storage, view);
    renderApp({
      online: false,
      storage,
      today: view,
      now: NEXT_MORNING,
      path: "/?entry=commitment-2&day=ayer",
      todayFailures: failures,
    });
    const sheet = await screen.findByRole("dialog", { name: "Leer" });
    // Hoy would fall back to the saved day: on a stale day the sheet offers only Ayer.
    expect(within(sheet).queryByRole("radio", { name: "Hoy" })).not.toBeInTheDocument();
    expect(within(sheet).getByText(/Se guardará para el/)).toBeInTheDocument();
  });

  it("closes the day too when the new day's refetch fails with a server error, online", async () => {
    const app = renderApp({ today: day(), now: SAME_DAY });
    await screen.findByRole("button", { name: "Registrar Meditar" });
    app.deps.api.failNext("getToday", new ApiError("Internal", 500, null));
    app.deps.clock.advanceSeconds(22 * 60 * 60);
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    expect(await screen.findByText(NOT_LOADED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar Meditar" })).not.toBeInTheDocument();
  });

  it("does not say the day is not loaded while it is loading online; it opens once the server answers", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, day());
    const app = renderApp({ storage, today: day(), now: NEXT_MORNING });
    const release = app.deps.api.hold("getToday");
    await screen.findByRole("heading", { name: "Meditar" });
    expect(screen.queryByText(NOT_LOADED)).not.toBeInTheDocument();
    // Still closed until the server vouches for the day.
    expect(screen.queryByRole("button", { name: "Registrar Meditar" })).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole("button", { name: "Registrar Meditar" })).toBeEnabled();
  });

  it("keeps recording open offline while the saved day is still today on the phone", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, day());
    const app = renderApp({
      online: false,
      storage,
      today: day(),
      now: SAME_DAY,
      todayFailures: [offline, offline],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    await waitFor(() => expect(app.deps.outboxStore.load("user-1").items).toHaveLength(1));
    expect(screen.queryByText(NOT_LOADED)).not.toBeInTheDocument();
  });

  it("trusts the server's day when it answered in this session and the connection is up", async () => {
    // A phone clock ahead of the server must not close recording while the server can be asked.
    renderApp({ today: day(), now: NEXT_MORNING });
    expect(await screen.findByRole("button", { name: "Registrar Meditar" })).toBeEnabled();
    expect(screen.queryByText(NOT_LOADED)).not.toBeInTheDocument();
  });

  it("does not offer a De ayer item whose grace is over on the phone (N1)", async () => {
    // The saved day's yesterday (2026-10-01) closed with 2026-10-02; the phone is at 2026-10-03.
    const storage = new MemoryStorage();
    const view = activeTodayFixture({
      rows: [dayRowFixture({ habitName: "Meditar" })],
      pendingYesterday: [pendingItemFixture()],
    });
    seedPersistedToday(storage, view);
    const app = renderApp({
      online: false,
      storage,
      today: view,
      now: NEXT_MORNING,
      todayFailures: [offline, offline],
    });
    await screen.findByText(NOT_LOADED);
    expect(
      screen.queryByRole("button", { name: "Registrar Dibujar de ayer" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Dibujar")).not.toBeInTheDocument();
    expect(app.deps.outboxStore.load("user-1").items).toEqual([]);
  });

  it("leaves a De ayer item still inside its grace to the member", async () => {
    const storage = new MemoryStorage();
    const view = activeTodayFixture({
      rows: [dayRowFixture({ habitName: "Meditar" })],
      pendingYesterday: [pendingItemFixture({ graceUntil: "2026-10-03" as never })],
    });
    seedPersistedToday(storage, view);
    renderApp({
      online: false,
      storage,
      today: view,
      now: NEXT_MORNING,
      todayFailures: [offline, offline],
    });
    await screen.findByText(NOT_LOADED);
    expect(screen.getByRole("button", { name: "Registrar Dibujar de ayer" })).toBeEnabled();
  });
});
