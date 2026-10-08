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
