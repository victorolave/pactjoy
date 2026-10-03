import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../../adapters/query-persister.ts";
import { ApiError } from "../../ports/api-error.ts";
import {
  activeTodayFixture,
  dayRowFixture,
  noCircleTodayFixture,
} from "../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../testing/memory-storage.ts";
import { renderApp } from "../../testing/render.tsx";
import { seedPersistedToday } from "../../testing/seed-persisted-today.ts";

const NETWORK = () => new ApiError("NetworkError", 0, null);
const OFFLINE =
  "Sin conexión. Estás viendo lo último que se guardó; para registrar necesitas conexión.";

const withRows = () => activeTodayFixture({ rows: [dayRowFixture({ habitName: "Meditar" })] });

describe("reading Today offline (TO-R10)", () => {
  it("shows the last saved Today with the banner, and no writes, when the network fails (TO-S12)", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, withRows());
    const { deps } = renderApp({
      storage,
      online: false,
      today: noCircleTodayFixture(),
      todayFailures: [NETWORK()],
    });
    expect(await screen.findByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar Meditar" })).toBeDisabled();
    expect(deps.api.calls.getToday).toBe(1);
  });

  it("keeps the saved Today when only the request fails and the browser still says online", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, withRows());
    renderApp({ storage, today: noCircleTodayFixture(), todayFailures: [NETWORK()] });
    expect(await screen.findByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(await screen.findByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error state when there is nothing saved (TO-S13)", async () => {
    renderApp({
      storage: new MemoryStorage(),
      online: false,
      today: noCircleTodayFixture(),
      todayFailures: [NETWORK()],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu día.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });

  it("prefers fresh data over the saved Today once the server answers", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, withRows());
    renderApp({ storage, today: noCircleTodayFixture() });
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Meditar" })).not.toBeInTheDocument();
  });

  it("does not hide a server error behind the saved Today as if it were a lost connection", async () => {
    const storage = new MemoryStorage();
    seedPersistedToday(storage, withRows());
    renderApp({
      storage,
      today: noCircleTodayFixture(),
      todayFailures: [new ApiError("Internal", 500, "req-1")],
    });
    expect(await screen.findByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });
});

describe("what is kept between visits", () => {
  it("saves the Today that loaded", async () => {
    const storage = new MemoryStorage();
    renderApp({ storage, today: withRows() });
    await screen.findByRole("heading", { name: "Meditar" });
    await waitFor(() => expect(storage.getItem(STORAGE_KEY) ?? "").toContain("Los de siempre"));
  });

  it("forgets it when the session expires", async () => {
    const storage = new MemoryStorage();
    const { deps } = renderApp({ storage, today: withRows() });
    await screen.findByRole("heading", { name: "Meditar" });
    await waitFor(() => expect(storage.getItem(STORAGE_KEY) ?? "").toContain("Los de siempre"));
    act(() => deps.sessionEvents.expire());
    await waitFor(() => expect(storage.getItem(STORAGE_KEY) ?? "").not.toContain("Los de siempre"));
  });

  it("forgets it when another tab signs out", async () => {
    const storage = new MemoryStorage();
    const { deps } = renderApp({ storage, today: withRows() });
    await screen.findByRole("heading", { name: "Meditar" });
    await waitFor(() => expect(storage.getItem(STORAGE_KEY) ?? "").toContain("Los de siempre"));
    act(() => deps.store.emitExternal(null));
    await waitFor(() => expect(storage.getItem(STORAGE_KEY) ?? "").not.toContain("Los de siempre"));
  });

  it("does not show a previous user's saved Today to the next sign in", async () => {
    const storage = new MemoryStorage();
    const { deps } = renderApp({ storage, today: withRows() });
    await screen.findByRole("heading", { name: "Meditar" });
    act(() => deps.sessionEvents.expire());
    await screen.findByRole("heading", { name: "Entrar" });
    await userEvent.type(screen.getByLabelText("Correo"), "otra@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await userEvent.type(await screen.findByLabelText("Código"), "123456");
    deps.api.setToday(noCircleTodayFixture());
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Meditar" })).not.toBeInTheDocument();
  });
});
