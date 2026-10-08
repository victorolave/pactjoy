import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SeasonCommitmentRow, type SeasonCommitmentRowData } from "./commitment-row.tsx";

const createRow = (overrides: Partial<SeasonCommitmentRowData> = {}): SeasonCommitmentRowData => ({
  kind: "detail",
  commitmentId: "commitment-leer",
  habit: { name: "Leer", icon: "book" },
  weightPercent: 25,
  privacy: "visible",
  measure: {
    unit: "minutes",
    customLabel: null,
    precision: "decimal",
    target: { direction: "reach", minimum: "10", ideal: "30" },
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 5 } },
  },
  points: 105,
  consistency: 86,
  idealCompletion: 76,
  opportunities: { kept: 19, counted: 22 },
  streak: { unit: "week", current: 0, best: 1 },
  pause: "none",
  ...overrides,
});

describe("SeasonCommitmentRow", () => {
  it("renders habit name, weight, consistency and points over possible", () => {
    render(<SeasonCommitmentRow row={createRow()} />);
    expect(screen.getByText("Leer")).toBeInTheDocument();
    expect(screen.getByText("25 % · consistencia 86 %")).toBeInTheDocument();
    expect(screen.getByText("105 / 250")).toBeInTheDocument();
  });

  it("renders weight only when consistency is null", () => {
    render(<SeasonCommitmentRow row={createRow({ consistency: null })} />);
    expect(screen.getByText("Leer")).toBeInTheDocument();
    expect(screen.getByText("25 %")).toBeInTheDocument();
    expect(screen.queryByText(/consistencia/)).toBeNull();
    expect(screen.getByText("105 / 250")).toBeInTheDocument();
  });

  it("renders 'En pausa' badge when commitment is paused", () => {
    render(<SeasonCommitmentRow row={createRow({ pause: "paused" })} />);
    expect(screen.getByText("Leer")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();
    expect(screen.getByText("105 / 250")).toBeInTheDocument();
  });

  it("renders opportunities subtitle for specificDays schedule per design 23a", () => {
    render(
      <SeasonCommitmentRow
        row={createRow({
          weightPercent: 20,
          measure: {
            unit: "done",
            schedule: {
              period: "perSession",
              frequency: { kind: "specificDays", weekdays: [1, 3, 5] },
            },
          },
          opportunities: { kept: 12, counted: 13 },
        })}
      />,
    );
    expect(screen.getByText("20 % · 12 de 13 días previstos")).toBeInTheDocument();
  });

  it("triggers onSelect callback when clicked", () => {
    const onSelect = vi.fn();
    render(<SeasonCommitmentRow row={createRow()} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Leer/ }));
    expect(onSelect).toHaveBeenCalledWith("commitment-leer");
  });
});
