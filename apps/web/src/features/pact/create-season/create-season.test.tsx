import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { SeasonDto } from "../../../ports/wire.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const FIXED_DATE_MS = Date.parse("2026-10-06T12:00:00Z"); // Tuesday, Oct 6 2026

const seasonFixture = (id = "season-1"): SeasonDto => ({
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
  commitments: [],
});

const renderCreateSeason = (circle = soloCircleFixture()) =>
  renderApp({
    path: "/season/new",
    myCircle: circle,
    now: FIXED_DATE_MS,
  });

describe("create season (design 8)", () => {
  it("renders screen 8 defaults: 8 weeks, tomorrow start date, and 2-week cadence", async () => {
    renderCreateSeason();

    expect(await screen.findByText("Andrea & Victor")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Nueva temporada" })).toBeInTheDocument();

    // Duration options
    expect(screen.getByRole("radio", { name: /^8\s*semanas$/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/8 semanas: tiempo para notar el cambio/)).toBeInTheDocument();

    // Start date defaults to tomorrow (Wednesday Oct 7)
    expect(screen.getByRole("button", { name: "Mañana" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Termina el martes 1 de diciembre\./)).toBeInTheDocument();

    // Review cadence defaults to 2
    expect(screen.getByRole("radio", { name: "Cada 2" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Recomendada para 8 semanas\./)).toBeInTheDocument();
  });

  it("updates cadence recommendation when duration changes (WF-R1)", async () => {
    renderCreateSeason();

    await userEvent.click(await screen.findByRole("radio", { name: /^4\s*semanas$/ }));
    expect(screen.getByRole("radio", { name: "Cada semana" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(/Recomendada para 4 semanas\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /^12\s*semanas$/ }));
    expect(screen.getByRole("radio", { name: "Cada 3" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Recomendada para 12 semanas\./)).toBeInTheDocument();
  });

  it("adjusts cadence manually and clears recommendation prefix when not default", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("radio", { name: "Cada semana" }));

    expect(screen.getByRole("radio", { name: "Cada semana" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByText(/Recomendada para 8 semanas\./)).not.toBeInTheDocument();
    expect(screen.getByText("Unos 60 segundos para ver cómo vas.")).toBeInTheDocument();
  });

  it("selects Hoy and updates the end date message", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));

    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mañana" })).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Termina el lunes 30 de noviembre\./)).toBeInTheDocument();
  });

  it("adds a custom date chip when a date is selected via the date picker", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    const dateInput = screen.getByLabelText("Elegir otra fecha");

    // Pick 2026-10-25 (a Sunday)
    fireEvent.change(dateInput, { target: { value: "2026-10-25" } });

    const sundayChip = await screen.findByRole("button", { name: "Domingo 25" });
    expect(sundayChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mañana" })).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("creates season with chosen parameters and navigates to habits screen", async () => {
    const { deps, location } = renderCreateSeason();
    deps.api.setPactResponse("createSeason", seasonFixture("s-new"));

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(location()).toBe("/season/s-new/habits"));
    expect(deps.api.pactCommands).toEqual([
      {
        method: "createSeason",
        args: [
          "circle-1",
          expect.objectContaining({
            lengthWeeks: 8,
            startDate: "2026-10-07",
            reviewCadenceWeeks: 2,
          }),
        ],
      },
    ]);
  });

  it("navigates directly to the pact/habits screen if circle already has a season (WF-R1)", async () => {
    const existingCircle = pairCircleFixture({
      id: "s-existing",
      phase: "pactOpen",
      lengthWeeks: 8,
      week: null,
      approvalCount: 1,
    });
    const { deps, location } = renderCreateSeason(existingCircle);

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(location()).toBe("/season/s-existing/habits"));
    expect(deps.api.pactCommands).toEqual([]);
  });

  it("displays error message when season creation fails", async () => {
    const { deps, location } = renderCreateSeason();
    deps.api.failNext("createSeason", new ApiError("NetworkError", 0, null));

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos crear la temporada. Inténtalo de nuevo.",
    );
    expect(location()).toBe("/season/new");
  });
});
