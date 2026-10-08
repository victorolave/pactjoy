import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import type { CommitmentProgress } from "../../ports/wire.ts";
import { progressRoutePatterns, progressRoutes } from "../../shared/season-progress-routes.ts";
import type { FakePactJoyApi } from "../../testing/fake-pactjoy-api.ts";
import { commitmentProgress, leerRow } from "../../testing/fixtures/season-progress.ts";
import { renderInProviders } from "../../testing/render.tsx";
import { CommitmentScreen } from "./CommitmentScreen.tsx";

const SEASON = "season-1";
const LEER = "commitment-leer";
type Started = ReturnType<typeof commitmentProgress>;

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

/** Opens the detail as a link would; `from: "today"` is the state Today's link passes. */
function open(script: (api: FakePactJoyApi) => void, from?: "today") {
  const target = progressRoutes.commitment(SEASON, LEER);
  return renderInProviders(
    <Scripted script={script}>
      <Routes>
        <Route path="/launch" element={<Navigate to={target} state={{ from }} replace />} />
        <Route path={progressRoutePatterns.commitment} element={<CommitmentScreen />} />
        <Route path="/" element={<Where />} />
        <Route path={progressRoutes.overview} element={<Where />} />
      </Routes>
    </Scripted>,
    { path: "/launch" },
  );
}

const showing = (view: CommitmentProgress, from?: "today") =>
  open((api) => api.progress.setCommitmentProgress(SEASON, LEER, view), from);

/** 24b: Gym, done / not done, paused today; its paused cell is striped. */
function pausedGym(): Started {
  const base = commitmentProgress();
  const [week] = base.weeks;
  return {
    ...base,
    commitment: leerRow({
      habit: { name: "Gym", icon: "dumbbell" },
      weightPercent: 30,
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
      points: 91,
      consistency: 54,
      opportunities: { kept: 7, counted: 13 },
      pause: "paused",
    }),
    weeks: week
      ? [
          {
            ...week,
            cells: [
              ...week.cells,
              { ...week.cells[1], status: "paused" } as Started["weeks"][number]["cells"][number],
            ],
          },
        ]
      : [],
    scoring: { perOpportunityPoints: "13.04", opportunityCount: 23, curve: null },
  };
}

describe("CommitmentScreen (24a)", () => {
  it("shows the commitment, its points, metrics and streak", async () => {
    showing(commitmentProgress());

    expect(await screen.findByRole("heading", { level: 1, name: "Leer" })).toBeTruthy();
    expect(screen.getByText("Visible para el círculo")).toBeTruthy();
    expect(
      screen.getByText("5 veces por semana · mínimo 10 min, ideal 30 min · peso 25 %"),
    ).toBeTruthy();
    expect(screen.getByText("105 de 250 pts")).toBeTruthy();
    expect(screen.getByText("19 de 22 oportunidades")).toBeTruthy();
    expect(screen.getByText("del ideal completado")).toBeTruthy();
    expect(screen.getByText("86 %")).toBeTruthy();
    expect(screen.getByText("0 semanas")).toBeTruthy();
    expect(screen.getByText("1 semana")).toBeTruthy();
    expect(
      screen.getByText(
        "Una semana suma a la racha cuando cumples las 5 de 5. Esta semana llevas 1 de 5.",
      ),
    ).toBeTruthy();
  });

  it("the history: one row per week, cells named with the legend's words", async () => {
    showing(commitmentProgress());

    const history = await screen.findByRole("list", { name: "Historial" });
    const [row] = within(history).getAllByRole("listitem");
    expect(row?.textContent).toContain("S5");
    // The cell backed by a registro is a button since C4; its name is the same legend label.
    const cells = within(row as HTMLElement).getAllByRole("button");
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Ideal, registrado posteriormente",
    ]);
    expect(
      screen.getByText(
        "Cada celda es una de tus 5 oportunidades de la semana. Toca una para ver su registro y su nota.",
      ),
    ).toBeTruthy();
    for (const legend of ["Ideal", "Mínimo", "No salió", "Registrado posteriormente", "Hoy"]) {
      expect(screen.getAllByText(legend).length).toBeGreaterThan(0);
    }
  });

  it("Cómo puntúa uses the engine's curve and per-opportunity value", async () => {
    showing(commitmentProgress());

    const card = (await screen.findByText("Cómo puntúa")).parentElement as HTMLElement;
    expect(within(card).getByText("5 min")).toBeTruthy();
    expect(
      within(card)
        .getAllByText(/^\d+ %$/)
        .map((cell) => cell.textContent),
    ).toEqual(["0 %", "33 %", "100 %"]);
    expect(within(card).getByText("Cada oportunidad vale hasta 6 pts.")).toBeTruthy();
  });

  it("Cómo puntúa pairs each value with its progress for assistive tech (review S2)", async () => {
    showing(commitmentProgress());

    const card = (await screen.findByText("Cómo puntúa")).parentElement as HTMLElement;
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["5 min: 0 %", "10 min: 33 %", "30 min: 100 %"]);
  });

  it("the cells hint sits under the history card, inside its section (review S1)", async () => {
    showing(commitmentProgress());

    const section = await screen.findByRole("region", { name: "Historial" });
    expect(
      within(section).getByText(/^Cada celda es una de tus 5 oportunidades de la semana\./),
    ).toBeTruthy();
  });

  it("deferred workflows leave no trace: no stage, reminder, pause action or photo", async () => {
    showing(commitmentProgress());

    await screen.findByRole("heading", { level: 1, name: "Leer" });
    for (const text of [/Recordatorio/, /Pausar/, /En desarrollo/, /Nuevo/, /foto/, /Reanudar/]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    // Only the way back and the read-only history cell (C4) are controls.
    expect(
      screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Volver a Temporada", "Ideal, registrado posteriormente"]);
  });

  it("a private commitment of mine says Privado", async () => {
    const view = commitmentProgress();
    showing({ ...view, commitment: { ...view.commitment, privacy: "private" } });

    expect(await screen.findByText("Privado")).toBeTruthy();
    expect(screen.queryByText("Visible para el círculo")).toBeNull();
  });
});

describe("CommitmentScreen (24b, done / not done, paused)", () => {
  it("shows the compact points card, the paused tag and the striped cell", async () => {
    showing(pausedGym());

    expect(await screen.findByRole("heading", { level: 1, name: "Gym" })).toBeTruthy();
    expect(screen.getByText("3 veces por semana · hecho / no hecho · peso 30 %")).toBeTruthy();
    expect(screen.getByText("En pausa")).toBeTruthy();
    expect(screen.getByText("Consistencia 54 %").parentElement?.textContent).toBe(
      "Consistencia 54 % · 7 de 13 oportunidades",
    );
    expect(screen.getByText("En hecho / no hecho, consistencia e ideal coinciden.")).toBeTruthy();
    expect(screen.queryByText("Cómo puntúa")).toBeNull();
    expect(screen.getByRole("img", { name: "Pausa" })).toBeTruthy();
  });
});

describe("CommitmentScreen navigation and states", () => {
  it("back goes to Temporada by default", async () => {
    showing(commitmentProgress());

    await userEvent.click(await screen.findByRole("button", { name: "Volver a Temporada" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/season");
  });

  it("opened from Today, back returns to Today", async () => {
    showing(commitmentProgress(), "today");

    await userEvent.click(await screen.findByRole("button", { name: "Volver" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/");
  });

  it("a season that has not started sends back to the overview", async () => {
    showing({ state: "notStarted", seasonId: SEASON });

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
  });

  it.each([400, 403, 404])(
    "a %i is not a connection error: back to the overview",
    async (status) => {
      open((api) =>
        api.progress.failNext("getCommitmentProgress", new ApiError("NotFound", status, null)),
      );

      await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("a failed load shows the 23c message; Reintentar reads again", async () => {
    open((api) => {
      api.progress.failNext("getCommitmentProgress", new ApiError("NetworkError", 0, null));
      api.progress.setCommitmentProgress(SEASON, LEER, commitmentProgress());
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No pudimos cargar la temporada.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Leer" })).toBeTruthy();
  });
});
