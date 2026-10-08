import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  activeSeasonProgress,
  firstDaySeasonProgress,
} from "../../testing/fixtures/season-progress.ts";
import { SeasonOverview } from "./overview.tsx";

describe("SeasonOverview", () => {
  it("renders the complete 23a season overview for an active pair season", () => {
    const progress = activeSeasonProgress({ memberCount: 2 });
    const onNavigateToMember = vi.fn();
    const onNavigateToCommitment = vi.fn();

    render(
      <SeasonOverview
        progress={progress}
        onNavigateToMember={onNavigateToMember}
        onNavigateToCommitment={onNavigateToCommitment}
        chartSlot={<div data-testid="weekly-chart">Grafico semanal</div>}
      />,
    );

    // 1. Header & Calendar
    expect(screen.getByText("Los Pactos · 8 semanas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Semana 5 de 8" })).toBeInTheDocument();
    expect(screen.getByText("25 ago – 19 oct · día 3 de esta semana")).toBeInTheDocument();

    const progressBar = screen.getByRole("progressbar", { name: "Progreso de la temporada" });
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "5");
    expect(progressBar).toHaveAttribute("aria-valuemax", "8");

    // 2. Tu temporada
    expect(screen.getByRole("heading", { level: 2, name: "Tu temporada" })).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("de 1.000")).toBeInTheDocument();
    expect(screen.getByText("84 %")).toBeInTheDocument();
    expect(screen.getByText("mínimo cumplido")).toBeInTheDocument();
    expect(screen.getByText("78 %")).toBeInTheDocument();
    expect(screen.getByText("del ideal completado")).toBeInTheDocument();

    // 3. Standings
    expect(screen.getByText("Así va la temporada")).toBeInTheDocument();
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.getByText("Victor")).toBeInTheDocument();
    expect(
      screen.getByText("12 pts de diferencia. La temporada sigue muy pareja."),
    ).toBeInTheDocument();

    // 4. Chart slot
    expect(screen.getByTestId("weekly-chart")).toBeInTheDocument();

    // 5. Tus compromisos
    expect(screen.getByRole("heading", { level: 2, name: "Tus compromisos" })).toBeInTheDocument();
    expect(screen.getByText("Puntos / posibles")).toBeInTheDocument();
    expect(screen.getByText("Leer")).toBeInTheDocument();
    expect(screen.getByText("25 % · consistencia 86 %")).toBeInTheDocument();
    expect(screen.getByText("105 / 250")).toBeInTheDocument();
    expect(screen.getByText("Gym")).toBeInTheDocument();
    expect(screen.getByText("En pausa")).toBeInTheDocument();

    // Interactions
    fireEvent.click(screen.getByRole("button", { name: /Leer/ }));
    expect(onNavigateToCommitment).toHaveBeenCalledWith("commitment-leer");

    fireEvent.click(screen.getByRole("button", { name: "Ver la temporada de Andrea" }));
    expect(onNavigateToMember).toHaveBeenCalledWith("member-andrea");
  });

  it("hides standings in a solo circle while showing metrics and commitments", () => {
    const progress = activeSeasonProgress({ memberCount: 1 });
    render(<SeasonOverview progress={progress} />);

    expect(screen.queryByText("Así va la temporada")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Tu temporada" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Tus compromisos" })).toBeInTheDocument();
  });

  it("shows standings with 3-6 members without gap copy", () => {
    const progress = activeSeasonProgress({ memberCount: 4 });
    render(<SeasonOverview progress={progress} />);

    expect(screen.getByText("Así va la temporada")).toBeInTheDocument();
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.getByText("Victor")).toBeInTheDocument();
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText("Carla")).toBeInTheDocument();
    expect(screen.queryByText(/pts de diferencia/)).toBeNull();
  });

  it("renders '—' for null consistency and idealCompletion", () => {
    const progress = firstDaySeasonProgress();
    render(<SeasonOverview progress={progress} />);

    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
