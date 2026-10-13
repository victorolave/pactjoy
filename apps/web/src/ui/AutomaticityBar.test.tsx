import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutomaticityBar, automaticityBar } from "./AutomaticityBar.tsx";

describe("automaticityBar", () => {
  it("draws the span between start and end on the 1 to 7 scale", () => {
    const bar = automaticityBar({ from: "3,5", to: "5,8" });
    expect(bar?.left).toBeCloseTo((2.5 / 6) * 100, 5);
    expect(bar?.width).toBeCloseTo((2.3 / 6) * 100, 5);
    const full = automaticityBar({ from: "1", to: "7" });
    expect(full).toEqual({ left: 0, width: 100 });
  });

  it("draws a mark when there is no start, and nothing without an end", () => {
    const mark = automaticityBar({ from: null, to: "4" });
    expect(mark?.left).toBeCloseTo(50 - 1, 5);
    expect(mark?.width).toBe(2);
    expect(automaticityBar({ from: "3", to: null })).toBeNull();
  });

  it("keeps a falling score visible, from the lower value", () => {
    const bar = automaticityBar({ from: "5", to: "4" });
    expect(bar?.left).toBeCloseTo((3 / 6) * 100, 5);
    expect(bar?.width).toBeCloseTo((1 / 6) * 100, 5);
  });

  it("keeps an unchanged score visible as a mark", () => {
    const bar = automaticityBar({ from: "4", to: "4" });
    expect(bar?.width).toBe(2);
  });
});

describe("AutomaticityBar", () => {
  it("is an image named by its label, filled from the start to the end", () => {
    render(<AutomaticityBar from="1" to="7" label="Leer: 1 → 7" />);
    const bar = screen.getByRole("img", { name: "Leer: 1 → 7" });
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.left).toBe("0%");
    expect(fill.style.width).toBe("100%");
  });

  it("draws nothing without an end", () => {
    render(<AutomaticityBar from="3" to={null} label="x" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
