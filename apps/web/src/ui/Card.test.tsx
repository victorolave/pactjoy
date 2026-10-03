import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card.tsx";

describe("Card", () => {
  it("renders its children in a div by default", () => {
    const { container } = render(<Card>Contenido</Card>);
    expect(screen.getByText("Contenido")).toBeInTheDocument();
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("renders as the element it is told to, keeping extra attributes", () => {
    render(
      <Card as="article" aria-label="Leer">
        Leer
      </Card>,
    );
    const card = screen.getByRole("article", { name: "Leer" });
    expect(card.tagName).toBe("ARTICLE");
  });

  it("renders as a list item for use inside a list", () => {
    render(
      <ul>
        <Card as="li">Uno</Card>
        <Card as="li">Dos</Card>
      </ul>,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Uno", "Dos"]);
  });
});
