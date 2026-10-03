import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar.tsx";

describe("ProgressBar", () => {
  it("exposes value, range and a readable text to assistive tech", () => {
    render(<ProgressBar value={2} max={3} label="Correr" valueLabel="2 de 3" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(bar).toHaveAttribute("aria-valuetext", "2 de 3");
    expect(screen.getByText("Correr")).toBeInTheDocument();
    expect(screen.getByText("2 de 3")).toBeInTheDocument();
  });

  it("clamps the fill between empty and full", () => {
    const { rerender } = render(<ProgressBar value={5} max={2} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "100%" });
    rerender(<ProgressBar value={-1} max={2} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "0%" });
    rerender(<ProgressBar value={1} max={4} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "25%" });
  });

  it("shows an empty bar when max is zero instead of dividing by it", () => {
    render(<ProgressBar value={1} max={0} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("labels the minimum and ideal marks and places them along the bar", () => {
    render(
      <ProgressBar
        value={10}
        max={30}
        marks={[
          { at: 10, label: "mín. 10" },
          { at: 30, label: "ideal 30 min" },
        ]}
      />,
    );
    const min = screen.getByText("mín. 10");
    const ideal = screen.getByText("ideal 30 min");
    expect(min).toHaveStyle({ left: "33.33333333333333%" });
    expect(ideal).toHaveStyle({ left: "100%" });
  });

  it("renders no marks when none are given", () => {
    render(<ProgressBar value={1} max={2} hint="Va bien" />);
    expect(screen.getByText("Va bien")).toBeInTheDocument();
    expect(screen.queryByText(/mín\./)).not.toBeInTheDocument();
  });
});
