import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.tsx";

describe("Badge", () => {
  it("shows its text", () => {
    render(<Badge tone="success">Registrado</Badge>);
    expect(screen.getByText("Registrado")).toBeInTheDocument();
  });

  it("adds a decorative icon before the text when given one", () => {
    const { container } = render(
      <Badge tone="pending" icon="circle-check">
        En pausa
      </Badge>,
    );
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("has no icon by default", () => {
    const { container } = render(<Badge>Neutral</Badge>);
    expect(container.querySelector("svg")).toBeNull();
  });
});
