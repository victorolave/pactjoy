import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepBars } from "./StepBars.tsx";

describe("StepBars", () => {
  it("is one picture with a spoken label, like the pager dots", () => {
    render(<StepBars current={1} total={3} />);
    expect(screen.getByRole("img", { name: "Paso 2 de 3" })).toBeInTheDocument();
  });

  it("draws one bar per step and fills the ones reached", () => {
    const { container } = render(<StepBars current={2} total={4} />);
    const bars = container.querySelectorAll("[data-filled]");
    expect([...bars].map((bar) => bar.getAttribute("data-filled"))).toEqual([
      "true",
      "true",
      "true",
      "false",
    ]);
  });
});
