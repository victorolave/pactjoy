import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type SeasonStandingsRow, Standings } from "./standings.tsx";

const createEntry = (overrides: Partial<SeasonStandingsRow> = {}): SeasonStandingsRow => ({
  memberId: "member-1",
  displayName: "Victor",
  isViewer: true,
  rank: 1,
  points: 400,
  ...overrides,
});

describe("Standings", () => {
  const season = { lengthWeeks: 8 };
  const calendar = { weekIndex: 4, daysLeft: 25 };

  it("renders nothing for a solo circle (memberCount <= 1)", () => {
    const { container } = render(
      <Standings
        standings={{ memberCount: 1, rows: [createEntry()] }}
        season={season}
        calendar={calendar}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  describe("pair circle (memberCount === 2)", () => {
    const pairRows = [
      createEntry({
        memberId: "member-andrea",
        displayName: "Andrea",
        isViewer: false,
        rank: 1,
        points: 412,
      }),
      createEntry({
        memberId: "member-victor",
        displayName: "Victor",
        isViewer: true,
        rank: 2,
        points: 400,
      }),
    ];

    it("renders standings list and gap copy for 0-20 pts difference", () => {
      render(
        <Standings
          standings={{ memberCount: 2, rows: pairRows }}
          season={season}
          calendar={calendar}
        />,
      );
      expect(screen.getByText("Así va la temporada")).toBeInTheDocument();
      expect(screen.getByText("Puntos acumulados")).toBeInTheDocument();
      expect(screen.getByText("Andrea")).toBeInTheDocument();
      expect(screen.getByText("Victor")).toBeInTheDocument();
      expect(screen.getByText("412 pts")).toBeInTheDocument();
      expect(screen.getByText("400 pts")).toBeInTheDocument();
      expect(
        screen.getByText("12 pts de diferencia. La temporada sigue muy pareja."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Ver la temporada de Andrea" }),
      ).toBeInTheDocument();
    });

    it.each([
      [401, 400, 4, 8, "1 pt de diferencia. La temporada sigue muy pareja."],
      [400, 400, 4, 8, "Mismos puntos. La temporada sigue muy pareja."],
      [460, 400, 4, 8, "60 pts de diferencia. Todavía quedan 3 semanas."],
      [460, 400, 6, 8, "60 pts de diferencia. Todavía queda 1 semana."],
      [520, 400, 4, 8, "120 pts de diferencia. Tu progreso también tiene su propio ritmo."],
    ])(
      "formats gap copy correctly for points (%i, %i) and week (%i of %i)",
      (p1, p2, wIndex, lWeeks, expected) => {
        const rows = [
          createEntry({
            memberId: "member-andrea",
            displayName: "Andrea",
            isViewer: false,
            points: p1,
          }),
          createEntry({
            memberId: "member-victor",
            displayName: "Victor",
            isViewer: true,
            points: p2,
          }),
        ];
        render(
          <Standings
            standings={{ memberCount: 2, rows }}
            season={{ lengthWeeks: lWeeks }}
            calendar={{ weekIndex: wIndex, daysLeft: 10 }}
          />,
        );
        expect(screen.getByText(expected)).toBeInTheDocument();
      },
    );

    it("navigates to peer when clicking peer link", () => {
      const onNavigateToMember = vi.fn();
      render(
        <Standings
          standings={{ memberCount: 2, rows: pairRows }}
          season={season}
          calendar={calendar}
          onNavigateToMember={onNavigateToMember}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ver la temporada de Andrea" }));
      expect(onNavigateToMember).toHaveBeenCalledWith("member-andrea");
    });
  });

  describe("multi-member circle (memberCount >= 3)", () => {
    const multiRows = [
      createEntry({
        memberId: "member-andrea",
        displayName: "Andrea",
        isViewer: false,
        rank: 1,
        points: 412,
      }),
      createEntry({
        memberId: "member-victor",
        displayName: "Victor",
        isViewer: true,
        rank: 2,
        points: 400,
      }),
      createEntry({
        memberId: "member-bruno",
        displayName: "Bruno",
        isViewer: false,
        rank: 3,
        points: 350,
      }),
    ];

    it("renders all member rows without pair gap copy or single peer link", () => {
      render(
        <Standings
          standings={{ memberCount: 3, rows: multiRows }}
          season={season}
          calendar={calendar}
        />,
      );
      expect(screen.getByText("Andrea")).toBeInTheDocument();
      expect(screen.getByText("Victor")).toBeInTheDocument();
      expect(screen.getByText("Bruno")).toBeInTheDocument();
      expect(screen.queryByText(/pts de diferencia/)).toBeNull();
      expect(screen.queryByText(/Ver la temporada de/)).toBeNull();
    });

    it("allows clicking peer rows to navigate in 3-6 circle", () => {
      const onNavigateToMember = vi.fn();
      render(
        <Standings
          standings={{ memberCount: 3, rows: multiRows }}
          season={season}
          calendar={calendar}
          onNavigateToMember={onNavigateToMember}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Ver la temporada de Andrea" }));
      expect(onNavigateToMember).toHaveBeenCalledWith("member-andrea");
      fireEvent.click(screen.getByRole("button", { name: "Ver la temporada de Bruno" }));
      expect(onNavigateToMember).toHaveBeenCalledWith("member-bruno");
    });
  });

  describe("all-zero unnumbered standings", () => {
    it("renders rows without rank numbers when rank is null", () => {
      const zeroRows = [
        createEntry({
          memberId: "member-andrea",
          displayName: "Andrea",
          isViewer: false,
          rank: null,
          points: 0,
        }),
        createEntry({
          memberId: "member-victor",
          displayName: "Victor",
          isViewer: true,
          rank: null,
          points: 0,
        }),
      ];
      render(
        <Standings
          standings={{ memberCount: 2, rows: zeroRows }}
          season={season}
          calendar={calendar}
        />,
      );
      expect(screen.queryByText("1")).toBeNull();
      expect(screen.queryByText("2")).toBeNull();
      expect(screen.getByText("Mismos puntos. La temporada sigue muy pareja.")).toBeInTheDocument();
    });
  });
});
