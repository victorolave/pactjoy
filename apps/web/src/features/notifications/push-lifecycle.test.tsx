import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { pairCircleFixture } from "../../testing/fixtures/circle.ts";
import { renderApp } from "../../testing/render.tsx";

/**
 * The device registration across the app's life (ADR-0017, REQ-X5..X7): re-synced on every start
 * with a session and a granted permission, removed on sign-out while the session can still call
 * the API.
 */

describe("push device lifecycle", () => {
  it("REQ-X5: an app start with a granted permission registers this device", async () => {
    const { deps } = renderApp({ path: "/", myCircle: pairCircleFixture() });
    await waitFor(() => expect(deps.api.pushDevices.size).toBe(1));
    expect(deps.push.subscribes).toEqual(["BFAKE-VAPID-KEY"]);
  });

  it("a start without a session, or without the permission, registers nothing", async () => {
    const signedOut = renderApp({ path: "/login", signedIn: false });
    await screen.findByRole("heading", { name: "Entrar" });
    expect(signedOut.deps.api.calls.getPushConfig).toBe(0);
  });

  it("REQ-X7: signing out removes this device on the server before the session is cleared", async () => {
    const { deps } = renderApp({ path: "/profile/settings", myCircle: pairCircleFixture() });
    await waitFor(() => expect(deps.api.pushDevices.size).toBe(1));
    const signedInWhenRemoved: boolean[] = [];
    const remove = deps.api.removePushSubscription.bind(deps.api);
    deps.api.removePushSubscription = async (endpoint) => {
      signedInWhenRemoved.push(deps.store.load() !== null);
      await remove(endpoint);
    };

    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(signedInWhenRemoved).toEqual([true]);
    expect(deps.api.pushDevices.size).toBe(0);
    expect(deps.push.device).toBeNull();
  });
});
