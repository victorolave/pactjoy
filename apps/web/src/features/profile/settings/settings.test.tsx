import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NO_CIRCLE, pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const SETTINGS = "/profile/settings";

describe("Ajustes (design 40, Q6)", () => {
  it("has the email, leaving the circle, signing out and the notifications row (PS-R4, ADR-0017)", async () => {
    renderApp({ path: SETTINGS, myCircle: pairCircleFixture() });
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeInTheDocument();
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Salir del círculo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avisos" })).toBeInTheDocument();
    expect(screen.getByText("Notificaciones")).toBeInTheDocument();
    for (const deferred of ["Apariencia", "Eliminar cuenta"]) {
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

describe("the notifications row (REQ-N1..N4, ADR-0017)", () => {
  const row = () => within(screen.getByRole("region", { name: "Avisos" }));

  it("SC-N1: granted and registered reads Activadas, with no action", async () => {
    renderApp({ path: SETTINGS, standalone: true });
    expect(await row().findByText("Activadas")).toBeInTheDocument();
    expect(row().queryByRole("button", { name: "Activar notificaciones" })).not.toBeInTheDocument();
  });

  it("SC-N1: not asked yet reads Desactivadas; Activar asks from the tap and registers", async () => {
    const user = userEvent.setup();
    const { deps } = renderApp({
      path: SETTINGS,
      standalone: true,
      notificationPermission: "default",
      notificationStepDone: true,
    });
    expect(await row().findByText("Desactivadas")).toBeInTheDocument();
    await user.click(row().getByRole("button", { name: "Activar notificaciones" }));
    expect(deps.notifications.requests).toBe(1);
    expect(await row().findByText("Activadas")).toBeInTheDocument();
    expect(deps.api.pushDevices.size).toBe(1);
  });

  it("SC-N2: denied reads Bloqueadas and points to the phone's settings, with no Activar", async () => {
    renderApp({ path: SETTINGS, standalone: true, notificationPermission: "denied" });
    expect(await row().findByText("Bloqueadas")).toBeInTheDocument();
    expect(row().getByText("Actívalas en los ajustes del iPhone.")).toBeInTheDocument();
    expect(row().queryByRole("button", { name: "Activar notificaciones" })).not.toBeInTheDocument();
  });

  it("SC-N3: in a browser tab without push it asks to install the app, and never asks permission", async () => {
    const { deps } = renderApp({
      path: SETTINGS,
      standalone: false,
      pushSupported: false,
      notificationPermission: "default",
    });
    expect(await row().findByText("No disponibles")).toBeInTheDocument();
    expect(
      row().getByText("Instala PactJoy en tu pantalla de inicio para recibir avisos."),
    ).toBeInTheDocument();
    expect(deps.notifications.requests).toBe(0);
  });

  it("a server without push reads No disponibles", async () => {
    renderApp({ path: SETTINGS, standalone: true, pushServer: false });
    expect(await row().findByText("No disponibles")).toBeInTheDocument();
  });

  it("REQ-N4: offline, Activar is disabled and says why", async () => {
    renderApp({
      path: SETTINGS,
      standalone: true,
      notificationPermission: "default",
      notificationStepDone: true,
      online: false,
    });
    expect(await row().findByRole("button", { name: "Activar notificaciones" })).toBeDisabled();
    expect(row().getByText("Sin conexión.")).toBeInTheDocument();
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
