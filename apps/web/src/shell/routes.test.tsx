import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../testing/render.tsx";

const renderAt = (path: string, signedIn = true) => renderApp({ path, signedIn });

describe("AppRoutes", () => {
  it("shows Perfil when its tab is pressed (WF-S3)", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("link", { name: "Perfil" }));
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
  });

  it.each([
    ["/season", "Temporada"],
    ["/circle", "Círculo"],
  ])("renders %s with the tab bar", (path, title) => {
    renderAt(path);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders /profile with the tab bar, titled Perfil and showing the member's name", async () => {
    renderAt("/profile");
    expect(screen.getByRole("heading", { level: 1, name: "Perfil" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Victor" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders Today at / inside a main landmark with the tab bar", () => {
    renderAt("/");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders /login without the tab bar", () => {
    renderAt("/login", false);
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("sends an unknown path to Today", () => {
    renderAt("/nope");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a visitor without a session from Today to /login", () => {
    renderAt("/", false);
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
  });

  it("sends a signed-in user from /login to Today", () => {
    renderAt("/login");
    expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  });
});
