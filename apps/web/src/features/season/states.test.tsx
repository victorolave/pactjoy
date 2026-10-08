import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import type { SeasonProgress } from "../../ports/wire.ts";
import {
  isFirstDayZero,
  SeasonError,
  SeasonFirstDayZero,
  SeasonScreen,
  SeasonSkeleton,
} from "./states.tsx";

const mockUseMyCircle = vi.fn();
const mockUseSeasonProgress = vi.fn();

vi.mock("../circle/index.ts", () => ({
  useMyCircle: () => mockUseMyCircle(),
}));

vi.mock("../season-progress-data/index.ts", () => ({
  useSeasonProgress: (seasonId: string) => mockUseSeasonProgress(seasonId),
}));

function makeFirstDayZeroProgress(overrides?: Partial<SeasonProgress>): SeasonProgress {
  return {
    state: "active",
    viewerId: "m-victor",
    season: {
      id: "season-1",
      timeZone: "America/Santiago",
      lengthWeeks: 8,
      actualStart: "2026-08-25",
      lastDay: "2026-10-19",
    },
    calendar: {
      today: "2026-08-25",
      weekIndex: 0,
      dayOfWeek: 1,
      daysLeft: 55,
    },
    circle: {
      id: "circle-1",
      name: "Andrea & Victor",
    },
    own: {
      points: 0,
      consistency: null,
      idealCompletion: null,
      commitments: [
        {
          kind: "detail",
          commitmentId: "c-1",
          habit: { name: "Correr", icon: "footprints" },
          weightPercent: 30,
          privacy: "visible",
          measure: {
            unit: "done",
            schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
          },
          opportunities: { kept: 0, counted: 0 },
          streak: { unit: "week", current: 0, best: 0 },
          pause: "none",
          points: 0,
          consistency: null,
          idealCompletion: null,
        },
      ],
    },
    standings: {
      memberCount: 2,
      rows: [
        {
          memberId: "m-andrea",
          displayName: "Andrea",
          isViewer: false,
          rank: null,
          points: 0,
        },
        {
          memberId: "m-victor",
          displayName: "Victor",
          isViewer: true,
          rank: null,
          points: 0,
        },
      ],
    },
    weeks: [],
    ...overrides,
  } as SeasonProgress;
}

describe("isFirstDayZero", () => {
  it("returns true on week 1, day 1 when all standings points are 0", () => {
    const progress = makeFirstDayZeroProgress();
    expect(isFirstDayZero(progress)).toBe(true);
  });

  it("returns true for solo circles on week 1, day 1 when own points are 0", () => {
    const progress = makeFirstDayZeroProgress({
      standings: { memberCount: 1, rows: [] },
      circle: { id: "circle-solo", name: "Victor" },
      own: {
        points: 0,
        consistency: null,
        idealCompletion: null,
        commitments: [],
      },
    });
    expect(isFirstDayZero(progress)).toBe(true);
  });

  it("returns false when season is not started", () => {
    const notStarted: SeasonProgress = { state: "notStarted", seasonId: "season-1" };
    expect(isFirstDayZero(notStarted)).toBe(false);
  });

  it("returns false if someone in standings has points > 0", () => {
    const progress = makeFirstDayZeroProgress({
      standings: {
        memberCount: 2,
        rows: [
          { memberId: "m-andrea", displayName: "Andrea", isViewer: false, rank: 1, points: 20 },
          { memberId: "m-victor", displayName: "Victor", isViewer: true, rank: null, points: 0 },
        ],
      },
    });
    expect(isFirstDayZero(progress)).toBe(false);
  });

  it("returns false on day 2 of week 1 even if points are 0", () => {
    const progress = makeFirstDayZeroProgress({
      calendar: {
        today: "2026-08-26",
        weekIndex: 0,
        dayOfWeek: 2,
        daysLeft: 54,
      },
    });
    expect(isFirstDayZero(progress)).toBe(false);
  });

  it("returns false on week 2 even if points are 0", () => {
    const progress = makeFirstDayZeroProgress({
      calendar: {
        today: "2026-09-01",
        weekIndex: 1,
        dayOfWeek: 1,
        daysLeft: 48,
      },
    });
    expect(isFirstDayZero(progress)).toBe(false);
  });
});

describe("SeasonFirstDayZero (Screen 23b)", () => {
  it("renders 23b header, welcome card with caminar illustration and pair copy", () => {
    const progress = makeFirstDayZeroProgress();
    render(
      <MemoryRouter>
        <SeasonFirstDayZero progress={progress} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Andrea & Victor · 8 semanas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Semana 1 de 8" })).toBeInTheDocument();
    expect(screen.getByText("25 ago – 19 oct · día 1")).toBeInTheDocument();

    const progressbar = screen.getByRole("progressbar", { name: "Progreso de la temporada" });
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute("aria-valuenow", "1");

    const img = screen.getByRole("img", {
      name: "Una mujer camina con una cinta de color a su alrededor",
    });
    expect(img).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { level: 2, name: "La temporada empieza hoy." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan los dos.",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Así va la temporada")).toBeInTheDocument();
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.getByText("Victor")).toBeInTheDocument();
    expect(screen.getAllByText("0 pts")).toHaveLength(2);
    expect(screen.getByText("Todavía nadie ha registrado.")).toBeInTheDocument();
  });

  it("renders copy for 3–6 member circles", () => {
    const progress = makeFirstDayZeroProgress({
      circle: { id: "circle-3", name: "Los Tres" },
      standings: {
        memberCount: 3,
        rows: [
          { memberId: "m-1", displayName: "Andrea", isViewer: false, rank: null, points: 0 },
          { memberId: "m-2", displayName: "Carlos", isViewer: false, rank: null, points: 0 },
          { memberId: "m-3", displayName: "Victor", isViewer: true, rank: null, points: 0 },
        ],
      },
    });

    render(
      <MemoryRouter>
        <SeasonFirstDayZero progress={progress} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Cada uno tiene 1.000 puntos posibles, repartidos según sus compromisos. Aquí verás cómo avanzan todos.",
      ),
    ).toBeInTheDocument();
  });

  it("renders copy for solo circle, hides standings and displays commitments", () => {
    const progress = makeFirstDayZeroProgress({
      circle: { id: "circle-solo", name: "Mi Círculo" },
      standings: {
        memberCount: 1,
        rows: [],
      },
      own: {
        points: 0,
        consistency: null,
        idealCompletion: null,
        commitments: [
          {
            kind: "detail",
            commitmentId: "c-solo-1",
            habit: { name: "Meditar", icon: "flower-2" },
            weightPercent: 40,
            privacy: "visible",
            measure: {
              unit: "done",
              schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
            },
            opportunities: { kept: 0, counted: 0 },
            streak: { unit: "day", current: 0, best: 0 },
            pause: "none",
            points: 0,
            consistency: null,
            idealCompletion: null,
          },
        ],
      },
    });

    render(
      <MemoryRouter>
        <SeasonFirstDayZero progress={progress} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Tienes 1.000 puntos posibles, repartidos según tus compromisos. Aquí verás cómo avanzas.",
      ),
    ).toBeInTheDocument();

    expect(screen.queryByText("Así va la temporada")).not.toBeInTheDocument();
    expect(screen.getByText("Tus compromisos")).toBeInTheDocument();
    expect(screen.getByText("Meditar")).toBeInTheDocument();
  });
});

describe("SeasonError (Screen 23c)", () => {
  it("renders 23c error state with reassurance copy, icon and retry button", () => {
    const onRetry = vi.fn();
    render(
      <SeasonError circleName="Andrea & Victor" lengthWeeks={8} weekNumber={5} onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Andrea & Victor · 8 semanas")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Semana 5 de 8" })).toBeInTheDocument();

    expect(screen.getByText("No pudimos cargar la temporada.")).toBeInTheDocument();
    expect(
      screen.getByText("Tus registros están a salvo. Inténtalo de nuevo."),
    ).toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: "Reintentar" });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders simple 'Temporada' header when circle/season metadata is unavailable", () => {
    render(<SeasonError onRetry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Temporada" })).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar la temporada.")).toBeInTheDocument();
  });

  it("renders 'Temporada' when weekNumber is undefined even if circleName and lengthWeeks are provided", () => {
    render(
      <SeasonError
        circleName="Andrea & Victor"
        lengthWeeks={8}
        weekNumber={undefined}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Temporada" })).toBeInTheDocument();
    expect(screen.queryByText("Semana 1 de 8")).toBeNull();
  });

  it("moves focus to the alert container on mount (S1)", () => {
    render(<SeasonError onRetry={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveFocus();
  });
});

describe("SeasonSkeleton", () => {
  it("renders loading skeleton with accessible status", () => {
    render(<SeasonSkeleton />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});

describe("SeasonScreen (Connected Container)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders SeasonSkeleton while myCircle is loading", () => {
    mockUseMyCircle.mockReturnValue({ data: undefined, isError: false, fetchStatus: "fetching" });
    mockUseSeasonProgress.mockReturnValue({ data: undefined, isError: false });

    render(
      <MemoryRouter>
        <SeasonScreen />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders SeasonError when myCircle fails", () => {
    const refetch = vi.fn();
    mockUseMyCircle.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error("Network error"),
      refetch,
    });
    mockUseSeasonProgress.mockReturnValue({ data: undefined, isError: false });

    render(
      <MemoryRouter>
        <SeasonScreen />
      </MemoryRouter>,
    );

    expect(screen.getByText("No pudimos cargar la temporada.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("redirects to / when user has no circle", () => {
    mockUseMyCircle.mockReturnValue({
      data: { circle: null, season: null },
      isError: false,
    });

    render(
      <MemoryRouter initialEntries={["/season"]}>
        <Routes>
          <Route path="/season" element={<SeasonScreen />} />
          <Route path="/" element={<div>Home View</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Home View")).toBeInTheDocument();
  });

  it("redirects to /season/new when circle has no season", () => {
    mockUseMyCircle.mockReturnValue({
      data: { circle: { id: "c-1", name: "Amigos" }, season: null },
      isError: false,
    });

    render(
      <MemoryRouter initialEntries={["/season"]}>
        <Routes>
          <Route path="/season" element={<SeasonScreen />} />
          <Route path="/season/new" element={<div>Create Season View</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Create Season View")).toBeInTheDocument();
  });

  it("redirects to pact route when season phase is pactOpen", () => {
    mockUseMyCircle.mockReturnValue({
      data: {
        circle: { id: "c-1", name: "Amigos" },
        season: { id: "s-open", phase: "pactOpen", lengthWeeks: 8 },
      },
      isError: false,
    });

    render(
      <MemoryRouter initialEntries={["/season"]}>
        <Routes>
          <Route path="/season" element={<SeasonScreen />} />
          <Route path="/season/s-open/pact" element={<div>Pact View</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Pact View")).toBeInTheDocument();
  });

  it("renders SeasonError when season progress query fails", () => {
    const refetch = vi.fn();
    mockUseMyCircle.mockReturnValue({
      data: {
        circle: { id: "c-1", name: "Andrea & Victor" },
        season: { id: "s-1", phase: "active", lengthWeeks: 8 },
      },
      isError: false,
    });
    mockUseSeasonProgress.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error("Server error"),
      refetch,
    });

    render(
      <MemoryRouter>
        <SeasonScreen />
      </MemoryRouter>,
    );

    expect(screen.getByText("No pudimos cargar la temporada.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Temporada" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404])(
    "redirects to / when season progress query fails with non-recoverable status %i (W2)",
    (status) => {
      mockUseMyCircle.mockReturnValue({
        data: {
          circle: { id: "c-1", name: "Andrea & Victor" },
          season: { id: "s-1", phase: "active", lengthWeeks: 8 },
        },
        isError: false,
      });
      mockUseSeasonProgress.mockReturnValue({
        data: undefined,
        isError: true,
        error: new ApiError("Error", status, "req-1"),
      });

      render(
        <MemoryRouter initialEntries={["/season"]}>
          <Routes>
            <Route path="/season" element={<SeasonScreen />} />
            <Route path="/" element={<div>Home View</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText("Home View")).toBeInTheDocument();
      expect(screen.queryByText("No pudimos cargar la temporada.")).not.toBeInTheDocument();
    },
  );

  it.each([400, 403, 404])(
    "redirects to / when myCircle query fails with non-recoverable status %i (W2)",
    (status) => {
      mockUseMyCircle.mockReturnValue({
        data: undefined,
        isError: true,
        error: new ApiError("Error", status, "req-1"),
      });

      render(
        <MemoryRouter initialEntries={["/season"]}>
          <Routes>
            <Route path="/season" element={<SeasonScreen />} />
            <Route path="/" element={<div>Home View</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText("Home View")).toBeInTheDocument();
      expect(screen.queryByText("No pudimos cargar la temporada.")).not.toBeInTheDocument();
    },
  );

  it("renders SeasonFirstDayZero (23b) on day 1 with 0 points", () => {
    const progress = makeFirstDayZeroProgress();
    mockUseMyCircle.mockReturnValue({
      data: {
        circle: { id: "c-1", name: "Andrea & Victor" },
        season: { id: "s-1", phase: "active", lengthWeeks: 8 },
      },
      isError: false,
    });
    mockUseSeasonProgress.mockReturnValue({
      data: progress,
      isError: false,
    });

    render(
      <MemoryRouter>
        <SeasonScreen />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "La temporada empieza hoy." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Todavía nadie ha registrado.")).toBeInTheDocument();
  });

  it("renders SeasonOverview (23a) when points exist or after day 1", () => {
    const progress = makeFirstDayZeroProgress({
      calendar: {
        today: "2026-08-27",
        weekIndex: 0,
        dayOfWeek: 3,
        daysLeft: 53,
      },
      own: {
        points: 400,
        consistency: 84,
        idealCompletion: 78,
        commitments: [],
      },
      standings: {
        memberCount: 2,
        rows: [
          { memberId: "m-1", displayName: "Andrea", isViewer: false, rank: 1, points: 412 },
          { memberId: "m-2", displayName: "Victor", isViewer: true, rank: 2, points: 400 },
        ],
      },
    });

    mockUseMyCircle.mockReturnValue({
      data: {
        circle: { id: "c-1", name: "Andrea & Victor" },
        season: { id: "s-1", phase: "active", lengthWeeks: 8 },
      },
      isError: false,
    });
    mockUseSeasonProgress.mockReturnValue({
      data: progress,
      isError: false,
    });

    render(
      <MemoryRouter>
        <SeasonScreen />
      </MemoryRouter>,
    );

    expect(screen.getByText("Tu temporada")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.queryByText("La temporada empieza hoy.")).not.toBeInTheDocument();
  });
});
