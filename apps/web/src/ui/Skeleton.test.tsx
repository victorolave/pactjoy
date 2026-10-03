import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton.tsx";

describe("Skeleton", () => {
  it("is invisible to assistive tech: the screen announces loading itself", () => {
    const { container } = render(<Skeleton shape="card" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("draws one block per line when asked for lines", () => {
    const { container } = render(<Skeleton shape="line" lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it("draws a single block by default", () => {
    const { container } = render(<Skeleton shape="circle" />);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});
