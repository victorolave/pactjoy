import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { todayKey } from "../../../shared/query-keys.ts";
import { activeTodayFixture } from "../../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderApp } from "../../../testing/render.tsx";

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

  it("never celebrates a cached candidate while offline or when its refresh failed", async () => {
    const app = renderApp({ online: false });
    act(() => app.deps.queryClient.setQueryData(todayKey, qualified()));
    await screen.findByRole("heading", { name: "Hola, Victor" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    app.deps.api.failNext("getToday", new ApiError("NetworkError", 0, null));
    act(() => app.deps.connectivity.setOnline(true));
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    await waitFor(() => expect(app.deps.queryClient.getQueryState(todayKey)?.status).toBe("error"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("defers without consuming the milestone while another dialog has focus", async () => {
    const overlay = render(
      <div role="dialog" aria-label="Registro">
        Registro
      </div>,
    );
    const app = renderApp({ today: qualified() });
    await screen.findByRole("heading", { name: "Hola, Victor" });
    expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument();
    overlay.unmount();
    await act(() => app.deps.queryClient.invalidateQueries({ queryKey: todayKey }));
    expect(await screen.findByRole("dialog", { name: TITLE })).toBeVisible();
  });
});
