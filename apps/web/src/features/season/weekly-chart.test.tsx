import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  activeSeasonProgress,
  endedSeasonProgress,
} from "../../testing/fixtures/season-progress.ts";
import { SeasonWeeklyChart } from "./weekly-chart.tsx";

describe("SeasonWeeklyChart", () => {
  it("renders the 23a paired weekly chart for an active circle of two members", () => {
    const progress = activeSeasonProgress({ memberCount: 2 });
    const { container } = render(<SeasonWeeklyChart progress={progress} />);

    // 1. Header & Legend
    expect(screen.getAllByText("Puntos por semana")).toHaveLength(2);
    expect(screen.getAllByText("Tú")).toHaveLength(2);
    expect(screen.getAllByText("Andrea")).toHaveLength(2);

    // 2. Week labels
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`S${i}`)).toBeInTheDocument();
    }
    // S5 is current week label
    const s5 = screen.getByText("S5");
    expect(s5.className).toContain("weekLabelCurrent");

    // 3. Footer copy
    expect(
      screen.getByText(
        "Esta semana, en curso: tú +20 · Andrea +21. Tu mejor semana fue la 1 (+90).",
      ),
    ).toBeInTheDocument();

    // 4. Accessible table for screen readers
    expect(screen.getByRole("table", { name: "Puntos por semana" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Semana" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tú" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Andrea" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Semana 1" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Semana 5" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Semana 8" })).toBeInTheDocument();

    // Visual chart grid is aria-hidden
    const grids = container.querySelectorAll("[aria-hidden='true']");
    expect(grids.length).toBeGreaterThanOrEqual(2);
  });

  it("returns null for solo circles (memberCount === 1)", () => {
    const progress = activeSeasonProgress({ memberCount: 1 });
    const { container } = render(<SeasonWeeklyChart progress={progress} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Puntos por semana")).toBeNull();
  });

  it("returns null for circles of 3 to 6 members", () => {
    const p3 = activeSeasonProgress({ memberCount: 3 });
    const { container: c3 } = render(<SeasonWeeklyChart progress={p3} />);
    expect(c3).toBeEmptyDOMElement();

    const p4 = activeSeasonProgress({ memberCount: 4 });
    const { container: c4 } = render(<SeasonWeeklyChart progress={p4} />);
    expect(c4).toBeEmptyDOMElement();

    const p6 = activeSeasonProgress({ memberCount: 6 });
    const { container: c6 } = render(<SeasonWeeklyChart progress={p6} />);
    expect(c6).toBeEmptyDOMElement();
  });

  it("returns null when season state is notStarted", () => {
    const { container } = render(
      <SeasonWeeklyChart progress={{ state: "notStarted", seasonId: "season-1" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders correctly for an ended season with all past weeks", () => {
    const progress = endedSeasonProgress();
    render(<SeasonWeeklyChart progress={progress} />);

    expect(screen.getAllByText("Puntos por semana")).toHaveLength(2);
    // In ended season, there is no current week clause; only best week
    expect(screen.queryByText(/Esta semana, en curso/)).toBeNull();
    expect(screen.getByText("Tu mejor semana fue la 1 (+90).")).toBeInTheDocument();
  });

  it("omits best week clause when no past week has strictly positive points", () => {
    const base = activeSeasonProgress({ memberCount: 2 });
    // Season on week index 0 (first week, no past weeks)
    const week0Progress: typeof base = {
      ...base,
      calendar: { ...base.calendar, weekIndex: 0, dayOfWeek: 2 },
      weeks: base.weeks.map((w) => ({
        ...w,
        timing: w.weekIndex === 0 ? "current" : "future",
        members: w.members.map((m) => ({
          ...m,
          points: w.weekIndex === 0 ? 15 : null,
        })),
      })),
    };

    render(<SeasonWeeklyChart progress={week0Progress} />);

    expect(screen.getAllByText("Puntos por semana")).toHaveLength(2);
    expect(screen.getByText("Esta semana, en curso: tú +15 · Andrea +15.")).toBeInTheDocument();
    expect(screen.queryByText(/Tu mejor semana/)).toBeNull();
  });

  it("scales bar heights relative to highest points when points exceed 100", () => {
    const base = activeSeasonProgress({ memberCount: 2 });
    const highPointsProgress: typeof base = {
      ...base,
      weeks: base.weeks.map((w) => ({
        ...w,
        members: w.members.map((m) => ({
          ...m,
          points: w.weekIndex === 0 && m.memberId === "member-victor" ? 200 : m.points,
        })),
      })),
    };

    const { container } = render(<SeasonWeeklyChart progress={highPointsProgress} />);
    expect(screen.getAllByText("Puntos por semana")).toHaveLength(2);

    // 200 pts is maximum, so week 1 viewer bar is 100% height (200 / 200 = 100%)
    const bars = container.querySelectorAll("span[style*='height']");
    const heights = Array.from(bars).map((b) => (b as HTMLElement).style.height);
    expect(heights).toContain("100%");
  });
});
