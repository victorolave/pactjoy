import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ButtonLink } from "./ButtonLink.tsx";

describe("ButtonLink", () => {
  it("is a link to the path, styled with the design system's button classes", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/circle/new" variant="ghost" size="sm" block>
          Crear
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Crear" });
    expect(link).toHaveAttribute("href", "/circle/new");
    expect(link).toHaveClass("pj-btn", "pj-btn--ghost", "pj-btn--sm", "pj-btn--block");
  });
});
