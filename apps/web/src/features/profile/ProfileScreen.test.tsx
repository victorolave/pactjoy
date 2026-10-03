import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../testing/render.tsx";

describe("Perfil", () => {
  it("shows who is signed in", async () => {
    renderApp({ path: "/profile" });
    expect(await screen.findByRole("heading", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
  });

  it("signs out: the server is told, the session is gone and the app goes to the login", async () => {
    const { deps } = renderApp({ path: "/profile" });
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(deps.auth.signedOut).toEqual(["access-1"]);
    expect(deps.store.load()).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("drops the user's saved Today with the session", async () => {
    const { deps } = renderApp({ path: "/" });
    await waitFor(() => expect(deps.api.calls.getToday).toBe(1));
    await userEvent.click(screen.getByRole("link", { name: "Perfil" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Entrar" });
    expect(deps.queryClient.getQueryData(["today"])).toBeUndefined();
  });

  it("signs out once on a double tap", async () => {
    const { deps } = renderApp({ path: "/profile" });
    await userEvent.dblClick(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Entrar" });
    expect(deps.auth.signedOut).toHaveLength(1);
  });
});
