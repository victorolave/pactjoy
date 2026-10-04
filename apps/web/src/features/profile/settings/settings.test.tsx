import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NO_CIRCLE, pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const SETTINGS = "/profile/settings";

describe("Ajustes (design 40, Q6)", () => {
  it("has only the email, leaving the circle and signing out (PS-R4)", async () => {
    renderApp({ path: SETTINGS, myCircle: pairCircleFixture() });
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Salir del círculo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    for (const deferred of ["Apariencia", "Notificaciones", "Eliminar cuenta"]) {
      expect(screen.queryByText(deferred)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("does not offer leaving without a circle (PS-S4)", async () => {
    renderApp({
      path: SETTINGS,
      myCircle: NO_CIRCLE,
      today: noCircleTodayFixture(),
      nameDraft: "Vic",
    });
    await screen.findByRole("heading", { name: "Ajustes" });
    expect(screen.queryByRole("button", { name: "Salir del círculo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });
});

describe("signing out from Ajustes (PS-R5)", () => {
  it("tells the server, ends the session and goes to the login", async () => {
    const { deps } = renderApp({ path: SETTINGS, myCircle: pairCircleFixture() });
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(deps.auth.signedOut).toEqual(["access-1"]);
    expect(deps.store.load()).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("drops the saved Today, the circle and the name draft, and keeps the device flags (PS-S5)", async () => {
    const { deps } = renderApp({ path: "/", myCircle: pairCircleFixture(), nameDraft: "Vic" });
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    deps.device.set("welcomeSeen", "1");
    await userEvent.click(screen.getByRole("link", { name: "Perfil" }));
    await userEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Entrar" });
    expect(deps.queryClient.getQueryData(["today"])).toBeUndefined();
    expect(deps.queryClient.getQueryData(["myCircle"])).toBeUndefined();
    expect(deps.device.get("nameDraft")).toBeNull();
    expect(deps.device.get("welcomeSeen")).toBe("1");
  });

  it("signs out once on a double tap", async () => {
    const { deps } = renderApp({ path: SETTINGS, myCircle: pairCircleFixture() });
    await userEvent.dblClick(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Entrar" });
    expect(deps.auth.signedOut).toHaveLength(1);
  });
});

describe("leaving the circle from Ajustes (design 40c)", () => {
  it("opens the sheet, leaves, and lands on Today with no circle instead of the name step", async () => {
    const { deps, location } = renderApp({
      path: SETTINGS,
      myCircle: pairCircleFixture(),
      today: noCircleTodayFixture(),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Salir del círculo" }));
    expect(await screen.findByText("¿Salir de Andrea & Victor?")).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Salir del círculo" }),
    );
    await waitFor(() => expect(location()).toBe("/"));
    expect(deps.api.calls.leaveCircle).toBe(1);
    expect(deps.device.get("nameDraft")).toBe("Victor");
    expect(screen.queryByRole("heading", { name: "Tu nombre" })).not.toBeInTheDocument();
  });
});
