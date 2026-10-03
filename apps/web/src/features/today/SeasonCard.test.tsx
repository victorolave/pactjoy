import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeasonCard } from "./SeasonCard.tsx";
import type { SeasonCardModel } from "./today-view-model.ts";

const model: SeasonCardModel = {
  points: "540",
  consistency: "75 %",
  idealCompletion: "54 %",
  week: 2,
  weekCount: 4,
  weekLabel: "Semana 2 de 4",
  daysLeftLabel: "Quedan 19 días",
};

describe("SeasonCard (TO-R6)", () => {
  it("shows points, consistency, ideal completion, the week and the days left", () => {
    render(<SeasonCard model={model} />);
    expect(screen.getByText("Tu temporada")).toBeInTheDocument();
    expect(screen.getByText("540")).toBeInTheDocument();
    expect(screen.getByText("pts")).toBeInTheDocument();
    expect(screen.getByText("Consistencia 75 %")).toBeInTheDocument();
    expect(screen.getByText("Ideal 54 %")).toBeInTheDocument();
    expect(screen.getByText("Semana 2 de 4")).toBeInTheDocument();
    expect(screen.getByText("Quedan 19 días")).toBeInTheDocument();
  });

  it("shows a dash where the server has nothing counted yet", () => {
    render(<SeasonCard model={{ ...model, consistency: "-", idealCompletion: "-" }} />);
    expect(screen.getByText("Consistencia -")).toBeInTheDocument();
    expect(screen.getByText("Ideal -")).toBeInTheDocument();
  });

  it("draws one week segment per week of the season, hidden from assistive tech", () => {
    const { container } = render(<SeasonCard model={{ ...model, weekCount: 6, week: 3 }} />);
    const hidden = Array.from(container.querySelectorAll("[aria-hidden='true']"));
    const segments = hidden.find((element) => element.children.length > 0);
    expect(segments?.children).toHaveLength(6);
  });
});
