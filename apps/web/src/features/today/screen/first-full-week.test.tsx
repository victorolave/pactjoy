import type { TodayView } from "@pactjoy/app";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { todayKey } from "../../../shared/query-keys.ts";
import { activeTodayFixture, FIXTURE_DAY_NOW_MS } from "../../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderApp } from "../../../testing/render.tsx";
import { seedPersistedToday } from "../../../testing/seed-persisted-today.ts";

const TITLE = "Tu primera semana completa";
const qualified = () => activeTodayFixture({ firstFullWeek: 1 });

describe("first full week celebration on Today", () => {
  it("celebrates the server's qualifying week once, then returns to working Today controls", async () => {
    const deviceStorage = new MemoryStorage();
    const app = renderApp({ today: qualified(), deviceStorage });
    const dialog = await screen.findByRole("dialog", { name: TITLE });
    expect(dialog).toHaveTextContent(
      "En la semana 2 cumpliste tu mínimo en todas tus oportunidades activas.",
    );
    expect(within(dialog).getByRole("button", { name: "Seguir con mi día" })).toHaveFocus();
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    expect(screen.getByRole("dialog", { name: TITLE })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Seguir con mi día" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeEnabled();
    expect(app.deps.haptics.taps).toBe(1);
    app.unmount();
    renderApp({ today: qualified(), deviceStorage });
    await screen.findByRole("heading", { name: "Hola, Victor" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["member", "season"])("allows a new %s to celebrate independently", async (scope) => {
    const deviceStorage = new MemoryStorage();
    const app = renderApp({ today: qualified(), deviceStorage });
    await screen.findByRole("dialog", { name: TITLE });
    await userEvent.keyboard("{Escape}");
    app.unmount();
    const view = qualified();
    renderApp({
      deviceStorage,
      today:
        scope === "member"
          ? { ...view, viewerId: "another-member" as typeof view.viewerId }
          : { ...view, season: { ...view.season, id: "another-season" as typeof view.season.id } },
    });
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeVisible();
  });

  it.each([null, undefined, -1, 4, 0.5])(
    "ignores unavailable or malformed week %s",
    async (week) => {
      renderApp({
        today:
          week === undefined ? activeTodayFixture() : activeTodayFixture({ firstFullWeek: week }),
      });
      await screen.findByRole("heading", { name: "Hola, Victor" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("never celebrates a saved candidate while offline or when its refresh failed", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, qualified());
    const offline = new ApiError("NetworkError", 0, null);
    const app = renderApp({ online: false, storage, todayFailures: [offline, offline] });
    await screen.findByRole("heading", { name: "Hola, Victor" });
    await waitFor(() => expect(app.deps.api.calls.getToday).toBeGreaterThan(0));
    // The saved qualified view is what Today shows: the candidate really is in the cache.
    expect(app.deps.queryClient.getQueryData<TodayView>(todayKey)).toMatchObject({
      firstFullWeek: 1,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => app.deps.connectivity.setOnline(true));
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    await waitFor(() => expect(app.deps.queryClient.getQueryState(todayKey)?.status).toBe("error"));
    expect(app.deps.queryClient.getQueryData<TodayView>(todayKey)).toMatchObject({
      firstFullWeek: 1,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never celebrates a view written into the cache rather than fetched from the server", async () => {
    const app = renderApp();
    await screen.findByRole("heading", { name: "Hola, Victor" });
    await waitFor(() =>
      expect(app.deps.queryClient.getQueryState(todayKey)?.status).toBe("success"),
    );
    act(() => app.deps.queryClient.setQueryData(todayKey, qualified()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.deps.queryClient.getQueryData<TodayView>(todayKey)).toMatchObject({
      firstFullWeek: 1,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("celebrates a fetched view when Today mounts again, with no new request", async () => {
    // Another dialog holds it back on the first visit; coming back within the fresh time refetches nothing.
    const overlay = render(
      <div role="dialog" aria-label="Registro">
        Registro
      </div>,
    );
    const app = renderApp({ today: qualified() });
    await screen.findByRole("heading", { name: "Hola, Victor" });
    await waitFor(() =>
      expect(app.deps.queryClient.getQueryState(todayKey)?.status).toBe("success"),
    );
    await userEvent.click(screen.getByRole("link", { name: "Círculo" }));
    overlay.unmount();
    const requests = app.deps.api.calls.getToday;
    await userEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeVisible();
    expect(app.deps.api.calls.getToday).toBe(requests);
  });

  it("remains dismissible when device persistence is denied", async () => {
    const deviceStorage = new MemoryStorage();
    deviceStorage.setItem = () => {
      throw new Error("blocked storage");
    };
    const app = renderApp({ today: qualified(), deviceStorage });
    const dialog = await screen.findByRole("dialog", { name: TITLE });
    await userEvent.click(within(dialog).getByRole("button", { name: "Seguir con mi día" }));
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("after an offline entry is sent, the server's next Today both settles it and celebrates", async () => {
    // One query function serves both: the celebration needs the view marked as the server's, the
    // outbox needs the start of the fetch that came after its send.
    const storage = new MemoryStorage();
    seedPersistedToday(storage, qualified());
    const offline = new ApiError("NetworkError", 0, null);
    const app = renderApp({
      online: false,
      now: FIXTURE_DAY_NOW_MS,
      storage,
      today: qualified(),
      todayFailures: [offline],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Registrar Meditar" }));
    expect(await screen.findByText("Registrado en este teléfono")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument();
    act(() => app.deps.connectivity.setOnline(true));
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeVisible();
    await waitFor(() => expect(app.deps.api.calls.recordEntry).toBe(1));
    await waitFor(() =>
      expect(screen.queryByText("Registrado en este teléfono")).not.toBeInTheDocument(),
    );
    expect(app.deps.outboxStore.load("user-1").items).toEqual([]);
  });

  it("defers without consuming the milestone while another dialog has focus", async () => {
    const overlay = render(
      <div role="dialog" aria-label="Registro">
        Registro
      </div>,
    );
    const app = renderApp({ today: qualified() });
    await screen.findByRole("heading", { name: "Hola, Victor" });
    await waitFor(() =>
      expect(app.deps.queryClient.getQueryState(todayKey)?.status).toBe("success"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument();
    const requests = app.deps.api.calls.getToday;
    // Closing the other dialog alone reveals it: no refetch needed.
    overlay.unmount();
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeVisible();
    expect(app.deps.api.calls.getToday).toBe(requests);
  });
});
