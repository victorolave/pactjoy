import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { DevToday } from "./DevToday.tsx";
import { SCENARIOS } from "./scenarios.ts";

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="dev/today/*" element={<DevToday />} />
        <Route path="*" element={<p>otra ruta</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("the dev gallery index", () => {
  it("lists every scenario with a link to it", () => {
    at("/dev/today");
    for (const scenario of SCENARIOS) {
      const link = screen.getByRole("link", { name: (name) => name.includes(scenario.title) });
      expect(link).toHaveAttribute("href", `/dev/today/${scenario.id}`);
    }
  });
});

describe("a scenario renders the real Today screen over the fake API", () => {
  it("shows the mixed rows through the real screen", async () => {
    at("/dev/today/mixed");
    expect(await screen.findByRole("heading", { name: "Para hoy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meditar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esta semana" })).toBeInTheDocument();
  });

  it("shows the all-done card with quantity and points (15b)", async () => {
    at("/dev/today/allDone");
    expect(await screen.findByText("Meditar y Correr 5 km. +21 pts hoy.")).toBeInTheDocument();
  });

  it("shows the day off (15c)", async () => {
    at("/dev/today/nothingToday");
    expect(
      await screen.findByRole("heading", { name: "Hoy no tienes compromisos previstos." }),
    ).toBeInTheDocument();
  });

  it("shows the empty states", async () => {
    at("/dev/today/noCircle");
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
  });

  it("never answers in the loading scenario, so the skeleton stays (15e)", async () => {
    at("/dev/today/loading");
    expect(await screen.findByRole("status", { name: "Cargando Hoy" })).toBeInTheDocument();
  });

  it("fails in the error scenario, with a retry (15f)", async () => {
    at("/dev/today/error");
    expect(await screen.findByText("No pudimos cargar tu día.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("reads offline in the offline scenario, with the banner (15g)", async () => {
    at("/dev/today/offline");
    expect(await screen.findByRole("heading", { name: "Para hoy" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sin conexión" })).toBeInTheDocument();
  });

  it("sends an interaction to the fake API: the tap fills the circle, nothing leaves the page", async () => {
    at("/dev/today/mixed");
    const circle = await screen.findByRole("button", { name: "Registrar Meditar" });
    await userEvent.click(circle);
    expect(circle).toHaveAttribute("aria-pressed", "true");
  });

  it("goes back to the list for a scenario that does not exist", async () => {
    at("/dev/today/nope");
    expect(await screen.findByRole("link", { name: /Activa, filas mixtas/ })).toBeInTheDocument();
  });

  it("offers a way back to the list from a scenario", async () => {
    at("/dev/today/mixed");
    await screen.findByRole("heading", { name: "Para hoy" });
    expect(screen.getByRole("link", { name: /Escenarios/ })).toHaveAttribute("href", "/dev/today");
  });
});
