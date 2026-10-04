import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PagerDots } from "./PagerDots.tsx";

describe("PagerDots", () => {
  it("says which page it is on, once, as a single image", () => {
    render(<PagerDots count={3} current={1} />);
    expect(screen.getByRole("img", { name: "Pantalla 2 de 3" })).toBeInTheDocument();
  });

  it("draws one dot per page and stretches only the current one", () => {
    render(<PagerDots count={3} current={2} />);
    const dots = [...screen.getByRole("img").children];
    expect(dots).toHaveLength(3);
    expect(dots.map((dot) => dot.className.includes("current"))).toEqual([false, false, true]);
  });
});
