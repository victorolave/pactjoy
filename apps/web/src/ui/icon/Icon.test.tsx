import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, type IconName } from "./Icon.tsx";

describe("Icon", () => {
  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<Icon name="sun" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("becomes a labelled image when given a label", () => {
    render(<Icon name="circle-check" label="Registrado" />);
    expect(screen.getByRole("img", { name: "Registrado" })).toBeInTheDocument();
  });

  it("renders the glyph that its name maps to", () => {
    const names: IconName[] = ["sun", "calendar-days", "users", "user-round", "circle-check"];
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).toHaveClass(`lucide-${name}`);
      unmount();
    }
  });

  it("takes its size from a design token, not a literal", () => {
    const { container } = render(<Icon name="sun" size="lg" />);
    expect(container.querySelector("svg")).toHaveStyle({
      width: "var(--icon-lg)",
      height: "var(--icon-lg)",
    });
  });

  it("defaults to the medium token and the design-system stroke", () => {
    const { container } = render(<Icon name="sun" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ width: "var(--icon-md)" });
    expect(svg).toHaveAttribute("stroke-width", "1.8");
  });
});
