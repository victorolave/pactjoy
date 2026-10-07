import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { SeasonDto } from "../../../ports/wire.ts";
import { soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const FIXED_DATE_MS = Date.parse("2026-10-06T12:00:00Z");

const twoCommitmentsSeasonFixture = (id = "s-1"): SeasonDto => ({
  id,
  circleId: "circle-1",
  timeZone: "UTC",
  nominalStart: "2026-10-07",
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  approvals: [],
  pactClosedAt: null,
  createdAt: "2026-10-06T12:00:00.000Z",
  version: 1,
  pactRevision: 0,
  commitments: [
    {
      id: "c-meditar",
      memberId: "member-victor",
      habitId: "h-meditar",
      weightPercent: 50,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "done",
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 3 },
        },
      },
      habit: { name: "Meditar", icon: "sparkles" },
    },
    {
      id: "c-leer",
      memberId: "member-victor",
      habitId: "h-leer",
      weightPercent: 50,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "10", ideal: "30" },
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 5 },
        },
      },
      habit: { name: "Leer", icon: "book" },
    },
  ],
});

function renderWeightsScreen({
  season = twoCommitmentsSeasonFixture(),
  circle = soloCircleFixture(),
} = {}) {
  const result = renderApp({
    path: `/season/${season.id}/weights`,
    myCircle: circle,
    now: FIXED_DATE_MS,
  });
  result.deps.api.setPactResponse("getSeason", season);
  return result;
}

describe("weights screen (design 11)", () => {
  it("renders screen 11 with commitments, points, sum bar, and ready CTA", async () => {
    renderWeightsScreen();

    expect(await screen.findByText("Meditar")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "¿Cuánto pesa cada uno?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tienes 1.000 puntos posibles")).toBeInTheDocument();

    // Habit names and initial points
    expect(screen.getByText("Leer")).toBeInTheDocument();
    const pointsLabels = screen.getAllByText("500 pts posibles");
    expect(pointsLabels).toHaveLength(2);

    // Initial 50% values
    const weightLabels = screen.getAllByText("50 %");
    expect(weightLabels).toHaveLength(2);

    // Sum bar
    expect(screen.getByText("Suma 100 %")).toBeInTheDocument();
    expect(screen.getByText("Listo")).toBeInTheDocument();

    const progressBar = screen.getByRole("progressbar", { name: "Suma de pesos" });
    expect(progressBar).toHaveAttribute("aria-valuenow", "100");

    // Hint
    expect(
      screen.getByText("Más peso = más puntos en juego. No cambia lo que tienes que hacer."),
    ).toBeInTheDocument();

    // CTA enabled with 100%
    const cta = screen.getByRole("button", { name: "Revisar el pacto" });
    expect(cta).toBeEnabled();
  });

  it("adjusts weight via steppers, updates points and disables CTA when sum is not 100%", async () => {
    renderWeightsScreen();

    await screen.findByText("Meditar");

    const [plusFirst] = screen.getAllByRole("button", { name: "Sumar 5 %" });
    const [minusFirst] = screen.getAllByRole("button", { name: "Restar 5 %" });
    if (!plusFirst || !minusFirst) throw new Error("stepper buttons not found");

    // Increase first commitment to 55%
    await userEvent.click(plusFirst);

    expect(screen.getByText("55 %")).toBeInTheDocument();
    expect(screen.getByText("550 pts posibles")).toBeInTheDocument();
    expect(screen.getByText("Suma 105 %")).toBeInTheDocument();
    expect(screen.getByText("Te sobran 5 %")).toBeInTheDocument();

    const cta = screen.getByRole("button", { name: "La suma debe ser 100 %" });
    expect(cta).toBeDisabled();

    // Decrease first commitment by 10% (55 -> 50 -> 45%)
    await userEvent.click(minusFirst);
    await userEvent.click(minusFirst);

    expect(screen.getByText("45 %")).toBeInTheDocument();
    expect(screen.getByText("450 pts posibles")).toBeInTheDocument();
    expect(screen.getByText("Suma 95 %")).toBeInTheDocument();
    expect(screen.getByText("Te faltan 5 %")).toBeInTheDocument();
    expect(cta).toBeDisabled();
  });

  it("equalizes weights when clicking 'Repartir por igual'", async () => {
    renderWeightsScreen();

    await screen.findByText("Meditar");
    const [plusFirst] = screen.getAllByRole("button", { name: "Sumar 5 %" });
    const [, minusSecond] = screen.getAllByRole("button", { name: "Restar 5 %" });
    if (!plusFirst || !minusSecond) throw new Error("stepper buttons not found");

    // Make weights unequal: Meditar 60%, Leer 40%
    await userEvent.click(plusFirst);
    await userEvent.click(plusFirst);
    await userEvent.click(minusSecond);
    await userEvent.click(minusSecond);

    expect(screen.getByText("60 %")).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();

    // Click 'Repartir por igual'
    const equalizeBtn = screen.getByRole("button", { name: "Repartir por igual" });
    await userEvent.click(equalizeBtn);

    const weights = screen.getAllByText("50 %");
    expect(weights).toHaveLength(2);
    expect(screen.getByText("Suma 100 %")).toBeInTheDocument();
    expect(screen.getByText("Listo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar el pacto" })).toBeEnabled();
  });

  it("submits changed weights and navigates to the pact review screen", async () => {
    const season = twoCommitmentsSeasonFixture();
    const { deps, location } = renderWeightsScreen({ season });
    deps.api.setPactResponse("editCommitment", season);

    await screen.findByText("Meditar");
    const [plusFirst] = screen.getAllByRole("button", { name: "Sumar 5 %" });
    const [, minusSecond] = screen.getAllByRole("button", { name: "Restar 5 %" });
    if (!plusFirst || !minusSecond) throw new Error("stepper buttons not found");

    // Change to Meditar 55%, Leer 45% (sum = 100%)
    await userEvent.click(plusFirst);
    await userEvent.click(minusSecond);

    const cta = screen.getByRole("button", { name: "Revisar el pacto" });
    await userEvent.click(cta);

    await waitFor(() => expect(location()).toBe("/season/s-1/pact"));

    const editCalls = deps.api.pactCommands.filter((c) => c.method === "editCommitment");
    expect(editCalls).toHaveLength(2);
    expect(editCalls).toEqual([
      {
        method: "editCommitment",
        args: [
          "s-1",
          "c-meditar",
          {
            weightPercent: 55,
            privacy: "visible",
            measure: {
              unit: "done",
              frequency: { kind: "timesPerWeek", times: 3 },
            },
          },
        ],
      },
      {
        method: "editCommitment",
        args: [
          "s-1",
          "c-leer",
          {
            weightPercent: 45,
            privacy: "visible",
            measure: {
              unit: "minutes",
              customLabel: null,
              precision: "integer",
              direction: "reach",
              minimum: "10",
              ideal: "30",
              schedule: {
                period: "perSession",
                frequency: { kind: "timesPerWeek", times: 5 },
              },
            },
          },
        ],
      },
    ]);
  });

  it("navigates without calling editCommitment when weights were not changed", async () => {
    const season = twoCommitmentsSeasonFixture();
    const { deps, location } = renderWeightsScreen({ season });

    await screen.findByText("Meditar");
    const cta = screen.getByRole("button", { name: "Revisar el pacto" });
    await userEvent.click(cta);

    await waitFor(() => expect(location()).toBe("/season/s-1/pact"));
    const editCalls = deps.api.pactCommands.filter((c) => c.method === "editCommitment");
    expect(editCalls).toHaveLength(0);
  });

  it("shows an error message when saving weights fails", async () => {
    const season = twoCommitmentsSeasonFixture();
    const { deps } = renderWeightsScreen({ season });
    deps.api.failNext("editCommitment", new ApiError("InternalError", 500, null));

    await screen.findByText("Meditar");
    const [plusFirst] = screen.getAllByRole("button", { name: "Sumar 5 %" });
    const [, minusSecond] = screen.getAllByRole("button", { name: "Restar 5 %" });
    if (!plusFirst || !minusSecond) throw new Error("stepper buttons not found");

    // Change to Meditar 55%, Leer 45%
    await userEvent.click(plusFirst);
    await userEvent.click(minusSecond);

    const cta = screen.getByRole("button", { name: "Revisar el pacto" });
    await userEvent.click(cta);

    expect(
      await screen.findByText("No pudimos guardar los pesos. Inténtalo de nuevo."),
    ).toBeInTheDocument();
  });

  it("disables decrement button when weight reaches minimum 5%", async () => {
    const season: SeasonDto = {
      ...twoCommitmentsSeasonFixture(),
      commitments: [
        {
          id: "c-low",
          memberId: "member-victor",
          habitId: "h-low",
          weightPercent: 5,
          privacy: "visible",
          kind: "detail",
          measure: {
            unit: "done",
            schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 1 } },
          },
          habit: { name: "Bajo peso", icon: null },
        },
      ],
    };
    renderWeightsScreen({ season });

    await screen.findByText("Bajo peso");
    const minusBtn = screen.getByRole("button", { name: "Restar 5 %" });
    expect(minusBtn).toBeDisabled();
  });

  it("disables increment button when weight reaches maximum 100%", async () => {
    const season: SeasonDto = {
      ...twoCommitmentsSeasonFixture(),
      commitments: [
        {
          id: "c-max",
          memberId: "member-victor",
          habitId: "h-max",
          weightPercent: 100,
          privacy: "visible",
          kind: "detail",
          measure: {
            unit: "done",
            schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 1 } },
          },
          habit: { name: "Max peso", icon: null },
        },
      ],
    };
    renderWeightsScreen({ season });

    await screen.findByText("Max peso");
    const plusBtn = screen.getByRole("button", { name: "Sumar 5 %" });
    expect(plusBtn).toBeDisabled();
  });

  it("renders a skeleton while queries are loading (CRITICAL 2 lesson)", async () => {
    const season = twoCommitmentsSeasonFixture();
    const { deps } = renderWeightsScreen({ season });
    const release = deps.api.hold("getSeason");

    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "La suma debe ser 100 %" })).toBeDisabled();

    release();
    expect(await screen.findByText("Meditar")).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });

  it("renders error state when load fails and supports retry (W3 lesson)", async () => {
    const { deps } = renderWeightsScreen();
    deps.api.failNext("getSeason", new ApiError("NetworkError", 0, null));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.getByText("Revisa tu conexión e inténtalo de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "La suma debe ser 100 %" })).toBeDisabled();

    // Click retry
    const retryBtn = screen.getByRole("button", { name: "Reintentar" });
    await userEvent.click(retryBtn);

    expect(await screen.findByText("Meditar")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables controls while saving is pending (W4 lesson)", async () => {
    const season = twoCommitmentsSeasonFixture();
    const { deps, location } = renderWeightsScreen({ season });
    deps.api.setPactResponse("editCommitment", season);

    await screen.findByText("Meditar");
    const [plusFirst] = screen.getAllByRole("button", { name: "Sumar 5 %" });
    const [, minusSecond] = screen.getAllByRole("button", { name: "Restar 5 %" });
    if (!plusFirst || !minusSecond) throw new Error("stepper buttons not found");

    await userEvent.click(plusFirst);
    await userEvent.click(minusSecond);

    const release = deps.api.hold("editCommitment");
    const cta = screen.getByRole("button", { name: "Revisar el pacto" });
    await userEvent.click(cta);

    // While saving is pending
    expect(cta).toBeDisabled();
    expect(plusFirst).toBeDisabled();
    expect(screen.getByRole("button", { name: "Repartir por igual" })).toBeDisabled();

    release();

    await waitFor(() => expect(location()).toBe("/season/s-1/pact"));
  });
});
