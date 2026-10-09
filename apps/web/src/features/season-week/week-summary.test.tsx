import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import type { WeekSummary } from "../../ports/wire.ts";
import { progressRoutePatterns, progressRoutes } from "../../shared/season-progress-routes.ts";
import type { FakePactJoyApi } from "../../testing/fake-pactjoy-api.ts";
import { weekSummary } from "../../testing/fixtures/season-progress.ts";
import { renderInProviders } from "../../testing/render.tsx";
import { WeeklyBanner } from "./WeeklyBanner.tsx";
import { WeekSummaryScreen } from "./WeekSummaryScreen.tsx";

const SEASON = "season-1";

/** Scripts the fake before any child mounts, so the first read already has its answer. */
function Scripted(props: {
  readonly script: (api: FakePactJoyApi) => void;
  readonly children: ReactNode;
}) {
  const api = usePactJoyApi() as FakePactJoyApi;
  useState(() => props.script(api));
  return props.children;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function open(path: string, script: (api: FakePactJoyApi) => void = () => {}) {
  return renderInProviders(
    <Scripted script={script}>
      <Routes>
        <Route path={progressRoutePatterns.week} element={<WeekSummaryScreen />} />
        <Route path="/" element={<Where />} />
        <Route path={progressRoutes.overview} element={<Where />} />
      </Routes>
    </Scripted>,
    { path },
  );
}

const showing = (summary: WeekSummary) =>
  open(progressRoutes.week(SEASON, summary.weekIndex), (api) =>
    api.progress.setWeekSummary(SEASON, summary.weekIndex, summary),
  );

describe("WeekSummaryScreen (25b, 25c)", () => {
  it("the best week: meta, headline, metrics, breakdown and the pair's circle line", async () => {
    showing(weekSummary());

    expect(await screen.findByRole("heading", { level: 1 })).toHaveProperty(
      "textContent",
      "Tu mejor semana hasta ahora.",
    );
    expect(screen.getByText("Semana 4 de 8 · 15–21 sep")).toBeTruthy();
    const metrics = within(screen.getByRole("list", { name: "Tu mejor semana hasta ahora." }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(metrics).toEqual(["Puntos+96", "Consistencia83 %", "Ideal76 %"]);
    expect(screen.getByText("Leer").parentElement?.textContent).toBe("Leer4 de 5 · +20 pts");
    expect(screen.getByText("En el círculo: Andrea +87 · tú +96")).toBeTruthy();
    expect(screen.queryByText(/Todavía tienes oportunidades/)).toBeNull();
  });

  it("a difficult week (25c): its headline and the weeks still left, no comparison", async () => {
    showing(weekSummary({ headline: "difficult", consistency: 40, weeksLeft: 6 }));

    expect(await screen.findByText("Esta semana ha costado más.")).toBeTruthy();
    expect(screen.getByText("Todavía tienes oportunidades: quedan 6 semanas.")).toBeTruthy();
  });

  it("with no verifiable fact there is no headline: the week and its dates are the heading", async () => {
    showing(weekSummary({ headline: null }));

    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Semana 4 de 8 · 15–21 sep");
    expect(screen.queryByText("Tu mejor semana hasta ahora.")).toBeNull();
  });

  it("solo or a circle of 3–6 gets no circle line", async () => {
    showing(weekSummary({ circle: null }));

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/En el círculo/)).toBeNull();
  });

  it("nothing counted yet reads an em dash, never 0 %", async () => {
    showing(weekSummary({ consistency: null, idealCompletion: null, headline: null }));

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it.each([
    ["Cerrar", "button"],
    ["Seguir con mi día", "button"],
  ] as const)("%s returns to Today", async (name, role) => {
    showing(weekSummary());

    await userEvent.click(await screen.findByRole(role, { name }));
    expect((await screen.findByTestId("where")).textContent).toBe("/");
  });

  it("a malformed week index never reaches the API: back to the overview", async () => {
    const { deps } = open(`/season/${SEASON}/weeks/abc/summary`);

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
    expect((deps.api as FakePactJoyApi).progress.calls.getWeekSummary).toBe(0);
  });

  it.each([400, 403, 404])(
    "a %i is not a connection error: back to the overview",
    async (status) => {
      open(progressRoutes.week(SEASON, 3), (api) =>
        api.progress.failNext("getWeekSummary", new ApiError("NotFound", status, null)),
      );

      await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("a failed load shows the 23c message; Reintentar reads again", async () => {
    open(progressRoutes.week(SEASON, 3), (api) => {
      api.progress.failNext("getWeekSummary", new ApiError("NetworkError", 0, null));
      api.progress.setWeekSummary(SEASON, 3, weekSummary());
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No pudimos cargar la temporada.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Tu mejor semana hasta ahora.")).toBeTruthy();
  });

  describe("screen scroll and list clipping regression (owner bug)", () => {
    const fourCommitments: WeekSummary["commitments"] = [
      {
        commitmentId: "c-leer",
        habit: { name: "Leer", icon: "book" },
        measure: {
          unit: "done",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
        },
        points: 0,
        progress: {
          value: null,
          target: { direction: "reach", minimum: "3", ideal: "3" },
          sessionsDone: 0,
          sessionsTarget: 3,
          percent: 0,
        },
      },
      {
        commitmentId: "c-meditar",
        habit: { name: "Meditar", icon: "sparkles" },
        measure: {
          unit: "done",
          schedule: {
            period: "perSession",
            frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
          },
        },
        points: 4,
        progress: {
          value: null,
          target: { direction: "reach", minimum: "7", ideal: "7" },
          sessionsDone: 1,
          sessionsTarget: 7,
          percent: 14,
        },
      },
      {
        commitmentId: "c-ingles",
        habit: { name: "Inglés", icon: "globe" },
        measure: {
          unit: "minutes",
          customLabel: null,
          precision: "integer",
          target: { direction: "reach", minimum: "120", ideal: "150" },
          schedule: {
            period: "weeklyTotal",
          },
        },
        points: 0,
        progress: {
          value: "30",
          target: { direction: "reach", minimum: "120", ideal: "150" },
          sessionsDone: 1,
          sessionsTarget: 1,
          percent: 20,
        },
      },
      {
        commitmentId: "c-cafe",
        habit: { name: "Máximo 1 café al día", icon: "coffee" },
        measure: {
          unit: "done",
          schedule: {
            period: "perSession",
            frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
          },
        },
        points: 0,
        progress: {
          value: null,
          target: { direction: "reach", minimum: "7", ideal: "7" },
          sessionsDone: 0,
          sessionsTarget: 7,
          percent: 0,
        },
      },
    ];

    it.each([
      [375, 667, "iPhone SE"],
      [390, 844, "iPhone 12/13/14"],
    ])(
      "renders all habits and reachable CTA without clipping at %ix%i (%s)",
      async (width, height) => {
        const originalInnerWidth = window.innerWidth;
        const originalInnerHeight = window.innerHeight;
        window.innerWidth = width;
        window.innerHeight = height;

        try {
          showing(
            weekSummary({
              viewerId: "member-andrea",
              headline: "difficult",
              consistency: 6,
              idealCompletion: 3,
              points: 4,
              weeksLeft: 6,
              commitments: fourCommitments,
              circle: [
                { memberId: "member-victor", displayName: "Victor", points: 47 },
                { memberId: "member-andrea", displayName: "Andrea", points: 4 },
              ],
            }),
          );

          // Header & headline from the real iPhone screenshot
          expect(await screen.findByText("Esta semana ha costado más.")).toBeTruthy();
          expect(screen.getByText("Todavía tienes oportunidades: quedan 6 semanas.")).toBeTruthy();

          // All 4 habits from the real iPhone screenshot are present in the DOM
          expect(screen.getByText("Leer")).toBeTruthy();
          expect(screen.getByText("Meditar")).toBeTruthy();
          expect(screen.getByText("Inglés")).toBeTruthy();
          expect(screen.getByText("Máximo 1 café al día")).toBeTruthy();

          // The list card wrapping them has flush class and no max-height or height clipping
          const card = screen.getByText("Leer").closest(".pj-card");
          expect(card).not.toBeNull();
          expect(card).toHaveClass("pj-card--flush");
          expect(card?.getAttribute("style") ?? "").not.toMatch(/max-height|height:\s*\d/);

          // Circle and CTA button are present and reachable
          expect(screen.getByText("En el círculo: Victor +47 · tú +4")).toBeTruthy();
          const cta = screen.getByRole("button", { name: "Seguir con mi día" });
          expect(cta).toBeTruthy();
        } finally {
          window.innerWidth = originalInnerWidth;
          window.innerHeight = originalInnerHeight;
        }
      },
    );
  });
});

describe("WeeklyBanner (25a)", () => {
  it("names the closed week and its result, and opens it", async () => {
    const onOpen = vi.fn();
    render(<WeeklyBanner summary={weekSummary()} onOpen={onOpen} />);

    expect(screen.getByText("Semana 4 cerrada")).toBeTruthy();
    expect(screen.getByText("+96 pts · consistencia 83 %")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Ver" });
    expect(open.getAttribute("aria-describedby")).toBeTruthy();
    await userEvent.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
