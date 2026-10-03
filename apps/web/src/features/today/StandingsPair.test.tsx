import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StandingsPair } from "./StandingsPair.tsx";

const pair = {
  kind: "pair",
  rank: 2,
  participantCount: 3,
  viewerPoints: 540,
  otherName: "Andrea",
  otherPoints: 620,
  difference: 80,
} as const;

describe("StandingsPair (TO-R7)", () => {
  it("shows the viewer's rank, the neighbour, both scores and the gap", () => {
    render(<StandingsPair model={pair} viewerName="Victor" />);
    expect(screen.getByText("Vas 2.º de 3")).toBeInTheDocument();
    expect(screen.getByText("Andrea 620 · Tú 540")).toBeInTheDocument();
    expect(screen.getByText("80 pts de diferencia")).toBeInTheDocument();
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("aria-label"))).toEqual([
      "Andrea",
      "Victor",
    ]);
  });

  it("says one point in the singular", () => {
    render(<StandingsPair model={{ ...pair, difference: 1 }} viewerName="Victor" />);
    expect(screen.getByText("1 pt de diferencia")).toBeInTheDocument();
  });

  it("says a tie plainly and leads with the viewer when level", () => {
    render(
      <StandingsPair
        model={{ ...pair, rank: 1, otherPoints: 540, difference: 0 }}
        viewerName="Victor"
      />,
    );
    expect(screen.getByText("Van empatados")).toBeInTheDocument();
    expect(screen.getByText("Vas 1.º de 3")).toBeInTheDocument();
  });

  it("puts the viewer first when they are ahead", () => {
    render(
      <StandingsPair
        model={{ ...pair, rank: 1, otherPoints: 500, viewerPoints: 540, difference: 40 }}
        viewerName="Victor"
      />,
    );
    expect(screen.getByText("Tú 540 · Andrea 500")).toBeInTheDocument();
  });

  it("with a single participant shows only the viewer", () => {
    render(<StandingsPair model={{ kind: "solo", points: 540 }} viewerName="Victor" />);
    expect(screen.getByText("Tú 540 pts")).toBeInTheDocument();
    expect(screen.queryByText(/diferencia/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("uses a neutral name for the viewer's avatar when the name is unknown", () => {
    render(<StandingsPair model={{ kind: "solo", points: 540 }} viewerName={null} />);
    expect(screen.getByRole("img", { name: "Tú" })).toBeInTheDocument();
  });
});
