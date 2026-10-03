import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LimitGrid, limitOptions } from "./LimitGrid.tsx";

describe("limitOptions", () => {
  it("offers 0 to 5, and goes one past the tolerance when that is further", () => {
    expect(limitOptions(4)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(limitOptions(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("caps the grid", () => {
    expect(limitOptions(40)).toHaveLength(13);
    expect(limitOptions(40).at(-1)).toBe(12);
  });
});

describe("LimitGrid (EN-R5)", () => {
  const grid = (value: number | null, onSelect = vi.fn()) =>
    render(<LimitGrid unit="cafés" ideal={2} tolerance={4} value={value} onSelect={onSelect} />);

  it("is a named radio group with 0 first, in the same grid and size as the rest", () => {
    grid(null);
    expect(screen.getByRole("radiogroup", { name: "Cantidad de cafés" })).toBeInTheDocument();
    const labels = screen.getAllByRole("radio").map((radio) => radio.textContent?.[0]);
    expect(labels).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("labels each option with its zone: ideal, tolerance, or over (no per-option points, P3)", () => {
    grid(null);
    const zones = screen.getAllByRole("radio").map((radio) => radio.textContent?.slice(1));
    expect(zones).toEqual(["Ideal", "Ideal", "Ideal", "Tolerancia", "Tolerancia", "Excede"]);
  });

  it("marks only the selected option", () => {
    grid(3);
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => radio.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("3");
  });

  it("selects on press, including 0", async () => {
    const onSelect = vi.fn();
    grid(null, onSelect);
    await userEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    await userEvent.click(screen.getAllByRole("radio")[3] as HTMLElement);
    expect(onSelect.mock.calls.map(([value]) => value)).toEqual([0, 3]);
  });

  it("shows a stored value that is outside the grid, selected, instead of dropping it", () => {
    grid(7);
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => radio.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent(/^7Excede/);
  });

  it("selects nothing by default", () => {
    grid(null);
    expect(
      screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });
});
