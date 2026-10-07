import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { SeasonDto } from "../../../ports/wire.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const FIXED_DATE_MS = Date.parse("2026-10-06T12:00:00Z");

const pairSeasonFixture = (
  status: "pactOpen" | "active" = "pactOpen",
  approvals: SeasonDto["approvals"] = [],
): SeasonDto => ({
  id: "s-1",
  circleId: "circle-1",
  timeZone: "UTC",
  nominalStart: "2026-10-07",
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status,
  approvals,
  pactClosedAt: status === "active" ? "2026-10-06T12:00:00.000Z" : null,
  createdAt: "2026-10-06T12:00:00.000Z",
  version: 1,
  pactRevision: 0,
  commitments: [
    {
      id: "c-1",
      memberId: "member-victor",
      habitId: "h-leer",
      weightPercent: 40,
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
    {
      id: "c-2",
      memberId: "member-victor",
      habitId: "h-gym",
      weightPercent: 60,
      privacy: "private",
      kind: "detail",
      measure: {
        unit: "done",
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 3 },
        },
      },
      habit: { name: "Gym", icon: "dumbbell" },
    },
    {
      id: "c-3",
      memberId: "member-andrea",
      habitId: "h-correr",
      weightPercent: 50,
      privacy: "visible",
      kind: "detail",
      measure: {
        unit: "km",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "2", ideal: "5" },
        schedule: {
          period: "perSession",
          frequency: { kind: "timesPerWeek", times: 3 },
        },
      },
      habit: { name: "Correr", icon: "footprints" },
    },
    {
      id: "c-4",
      memberId: "member-andrea",
      weightPercent: 50,
      kind: "hidden",
    },
  ],
});

function renderPact(options?: {
  season?: SeasonDto;
  circle?: ReturnType<typeof pairCircleFixture>;
  path?: string;
}) {
  const season = options?.season ?? pairSeasonFixture();
  const circle = options?.circle ?? pairCircleFixture();
  const path = options?.path ?? `/season/${season.id}/pact`;
  const result = renderApp({
    path,
    myCircle: circle,
    now: FIXED_DATE_MS,
  });
  result.deps.api.setPactResponse("getSeason", season);
  return result;
}

describe("PactScreen: Screen 12a (Review and Approve)", () => {
  it("renders the meta line, member groupings, and commitment rows with privacy rules", async () => {
    renderPact();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Revisa el pacto antes de aceptar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/8 semanas · 7 oct – 1 dic · revisión cada 2 semanas/),
    ).toBeInTheDocument();

    // Viewer's group
    expect(screen.getByText("Tus compromisos")).toBeInTheDocument();
    expect(screen.getByText("Leer")).toBeInTheDocument();
    expect(screen.getByText(/5 veces por semana · mín. 10 · ideal 30 min/)).toBeInTheDocument();
    expect(screen.getByText("40 %")).toBeInTheDocument();

    // Viewer's private commitment still shows habit name
    expect(screen.getByText("Gym")).toBeInTheDocument();

    // Andrea's group
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.getByText("Correr")).toBeInTheDocument();

    // Andrea's hidden commitment shows "Meta privada" and only weight, no habit name
    expect(screen.getByText("Meta privada")).toBeInTheDocument();
    expect(screen.getByText("Solo Andrea ve los detalles")).toBeInTheDocument();

    // Both members initially have Pendiente badge
    expect(screen.getAllByText("Pendiente")).toHaveLength(2);

    // Footnote
    expect(
      screen.getByText(/Mientras el pacto no esté cerrado, cada uno puede editar sus compromisos/),
    ).toBeInTheDocument();
  });

  it("submits approval sending expectedPactRevision", async () => {
    const { deps } = renderPact();
    const approveBtn = await screen.findByRole("button", { name: "Aprobar el pacto" });

    // Mock approval response where viewer is now approved
    const approvedSeason: SeasonDto = {
      ...pairSeasonFixture(),
      approvals: [{ memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" }],
    };
    deps.api.setPactResponse("approvePact", approvedSeason);

    await userEvent.click(approveBtn);

    // Transitions to 12b waiting
    expect(await screen.findByRole("heading", { name: "Esperando a Andrea" })).toBeInTheDocument();
  });

  it("handles StaleSeason error by showing inline error and refetching", async () => {
    const { deps } = renderPact();
    const approveBtn = await screen.findByRole("button", { name: "Aprobar el pacto" });

    deps.api.failNext("approvePact", new ApiError("StaleSeason", 409, null));

    await userEvent.click(approveBtn);

    expect(await screen.findByText("El pacto cambió. Revísalo de nuevo.")).toBeInTheDocument();
  });

  it("handles CommitmentWeightsNotFull error by showing inline error and navigating to weights", async () => {
    const { deps, location } = renderPact();
    const approveBtn = await screen.findByRole("button", { name: "Aprobar el pacto" });

    deps.api.failNext("approvePact", new ApiError("CommitmentWeightsNotFull", 409, null));

    await userEvent.click(approveBtn);

    expect(await screen.findByText("La suma debe ser 100 %")).toBeInTheDocument();
    const weightsBtn = screen.getByRole("button", { name: "Repartir pesos" });
    await userEvent.click(weightsBtn);

    expect(location()).toBe("/season/s-1/weights");
  });

  it("prevents double submit on approve while request is pending", async () => {
    const { deps } = renderPact();
    const approveBtn = await screen.findByRole("button", { name: "Aprobar el pacto" });

    const release = deps.api.hold("approvePact");
    deps.api.setPactResponse("approvePact", {
      ...pairSeasonFixture(),
      approvals: [{ memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" }],
    });

    await userEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();

    // Secondary submit attempt ignored
    await userEvent.click(approveBtn);

    release();
    expect(await screen.findByRole("heading", { name: "Esperando a Andrea" })).toBeInTheDocument();
    expect(deps.api.calls.approvePact).toBe(1);
  });

  it("navigates to habits screen on Editar mis compromisos", async () => {
    const { location } = renderPact();
    const editBtn = await screen.findByRole("button", { name: "Editar mis compromisos" });

    await userEvent.click(editBtn);

    expect(location()).toBe("/season/s-1/habits");
  });
});

describe("PactScreen: Screen 12b (Waiting)", () => {
  it("renders waiting state with member status card, dynamic approval count, and lets viewer withdraw approval", async () => {
    const waitingSeason = pairSeasonFixture("pactOpen", [
      { memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" },
    ]);
    const { deps } = renderPact({ season: waitingSeason });

    expect(await screen.findByRole("heading", { name: "Esperando a Andrea" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aprobaste el pacto. Cuando Andrea lo apruebe, quedará cerrado y te avisaremos.",
      ),
    ).toBeInTheDocument();

    // Member status card
    expect(screen.getByText("Tú")).toBeInTheDocument();
    expect(screen.getByText("Aprobado")).toBeInTheDocument();
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();

    // Dynamic approval count note (S2: las 2 aprobaciones)
    expect(screen.getByText(/las 2 aprobaciones se reinician/)).toBeInTheDocument();

    // Actions present on 12b
    expect(screen.getByRole("button", { name: "Ver el pacto" })).toBeInTheDocument();
    const withdrawBtn = screen.getByRole("button", { name: "Retirar mi aprobación" });

    // Withdraw approval
    const resetSeason: SeasonDto = {
      ...waitingSeason,
      approvals: [],
    };
    deps.api.setPactResponse("withdrawApproval", resetSeason);

    await userEvent.click(withdrawBtn);

    // Transitions back to 12a review
    expect(
      await screen.findByRole("heading", { name: "Revisa el pacto antes de aceptar" }),
    ).toBeInTheDocument();
  });

  it("renders 'Ver el pacto' action and allows viewing pact commitments and returning", async () => {
    const waitingSeason = pairSeasonFixture("pactOpen", [
      { memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" },
    ]);
    renderPact({ season: waitingSeason });

    const viewPactBtn = await screen.findByRole("button", { name: "Ver el pacto" });
    await userEvent.click(viewPactBtn);

    // Now viewing 12a review
    expect(
      await screen.findByRole("heading", { name: "Revisa el pacto antes de aceptar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Leer")).toBeInTheDocument();

    // Clicking Volver returns to 12b waiting
    const backBtn = screen.getByRole("button", { name: "Volver" });
    await userEvent.click(backBtn);

    expect(await screen.findByRole("heading", { name: "Esperando a Andrea" })).toBeInTheDocument();
  });

  it("prevents double submit on withdraw approval while request is pending", async () => {
    const waitingSeason = pairSeasonFixture("pactOpen", [
      { memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" },
    ]);
    const { deps } = renderPact({ season: waitingSeason });

    const withdrawBtn = await screen.findByRole("button", { name: "Retirar mi aprobación" });
    const release = deps.api.hold("withdrawApproval");
    deps.api.setPactResponse("withdrawApproval", {
      ...waitingSeason,
      approvals: [],
    });

    await userEvent.click(withdrawBtn);
    expect(withdrawBtn).toBeDisabled();

    // Secondary click attempt
    await userEvent.click(withdrawBtn);

    release();
    expect(
      await screen.findByRole("heading", { name: "Revisa el pacto antes de aceptar" }),
    ).toBeInTheDocument();
    expect(deps.api.calls.withdrawApproval).toBe(1);
  });
});

describe("PactScreen: Solo Circle Rule", () => {
  it("immediately closes the pact and transitions to 14a celebration upon approval in a 1-member circle", async () => {
    const firstCommitment = pairSeasonFixture().commitments[0];
    const soloSeason: SeasonDto = {
      ...pairSeasonFixture(),
      commitments: firstCommitment ? [firstCommitment] : [],
    };
    const { deps } = renderPact({ season: soloSeason, circle: soloCircleFixture() });

    const approveBtn = await screen.findByRole("button", { name: "Aprobar el pacto" });

    const closedSeason: SeasonDto = {
      ...soloSeason,
      status: "active",
      pactClosedAt: "2026-10-06T12:00:00Z",
      approvals: [{ memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" }],
    };
    deps.api.setPactResponse("approvePact", closedSeason);

    await userEvent.click(approveBtn);

    // Directly transitions to 14a celebration
    expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeInTheDocument();
    expect(screen.getByText("🤝")).toBeInTheDocument();
  });
});

describe("PactScreen: Screen 14a (Celebration)", () => {
  it("renders celebration and Continuar sets seen-flag and navigates to Today", async () => {
    const closedSeason = pairSeasonFixture("active", [
      { memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" },
      { memberId: "member-andrea", approvedAt: "2026-10-06T12:00:00Z" },
    ]);
    const { location, deps } = renderPact({ season: closedSeason });

    expect(await screen.findByRole("heading", { name: "Pacto cerrado" })).toBeInTheDocument();
    expect(screen.getByText("🤝")).toBeInTheDocument();
    expect(screen.getByText(/Andrea y tú empiezan/)).toBeInTheDocument();
    expect(screen.getByText("4 compromisos · 8 semanas")).toBeInTheDocument();

    const continueBtn = screen.getByRole("button", { name: "Continuar" });
    await userEvent.click(continueBtn);

    expect(deps.device.get("pact-closed-seen:s-1")).toBe("1");
    expect(location()).toBe("/");
  });

  it("redirects to Today if pact-closed-seen flag is already set", async () => {
    const closedSeason = pairSeasonFixture("active", [
      { memberId: "member-victor", approvedAt: "2026-10-06T12:00:00Z" },
      { memberId: "member-andrea", approvedAt: "2026-10-06T12:00:00Z" },
    ]);
    const { location, deps } = renderPact({ season: closedSeason });
    deps.device.set("pact-closed-seen:s-1", "1");

    await waitFor(() => {
      expect(location()).toBe("/");
    });
  });
});
