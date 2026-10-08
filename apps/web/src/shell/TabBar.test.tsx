import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { TabBar } from "./TabBar.tsx";

function Where() {
  return <output aria-label="where">{useLocation().pathname}</output>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
      <Where />
    </MemoryRouter>,
  );

describe("TabBar", () => {
  it("offers the four tabs in order inside a Principal navigation", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const labels = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
    expect(labels).toEqual(["Hoy", "Temporada", "Círculo", "Perfil"]);
  });

  it.each([
    ["/", "Hoy"],
    ["/season", "Temporada"],
    ["/season/s/members/m", "Temporada"],
    ["/season/s/commitments/c", "Temporada"],
    ["/circle", "Círculo"],
    ["/profile", "Perfil"],
  ])("marks only the tab of %s as the current page", (path, label) => {
    renderAt(path);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(current.map((a) => a.textContent)).toEqual([label]);
  });

  it("never underlines its links (the vendored styles assume buttons)", () => {
    renderAt("/");
    for (const link of screen.getAllByRole("link")) expect(link.className).toMatch(/item/);
  });

  it("does not mark Hoy as current on another route", () => {
    renderAt("/profile");
    expect(screen.getByRole("link", { name: "Hoy" })).not.toHaveAttribute("aria-current");
  });

  it("navigates to the tab route on press", async () => {
    renderAt("/");
    await userEvent.click(screen.getByRole("link", { name: "Perfil" }));
    expect(screen.getByLabelText("where")).toHaveTextContent("/profile");
    await userEvent.click(screen.getByRole("link", { name: "Temporada" }));
    expect(screen.getByLabelText("where")).toHaveTextContent("/season");
  });
});
