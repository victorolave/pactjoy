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

  it("supports roving tabindex and arrow key navigation across duration options (S1)", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    const radio8 = screen.getByRole("radio", { name: /^8\s*semanas$/ });
    const radio12 = screen.getByRole("radio", { name: /^12\s*semanas$/ });
    const radio4 = screen.getByRole("radio", { name: /^4\s*semanas$/ });

    // Initial roving tabIndex: default 8 is 0, others are -1
    expect(radio8).toHaveAttribute("tabindex", "0");
    expect(radio12).toHaveAttribute("tabindex", "-1");
    expect(radio4).toHaveAttribute("tabindex", "-1");

    // ArrowRight moves from 8 to 12
    radio8.focus();
    fireEvent.keyDown(radio8, { key: "ArrowRight" });
    expect(radio12).toHaveAttribute("aria-checked", "true");
    expect(radio12).toHaveAttribute("tabindex", "0");
    expect(radio8).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(radio12);

    // ArrowRight from 12 wraps around to 4
    fireEvent.keyDown(radio12, { key: "ArrowRight" });
    expect(radio4).toHaveAttribute("aria-checked", "true");
    expect(radio4).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(radio4);

    // ArrowLeft from 4 wraps around to 12
    fireEvent.keyDown(radio4, { key: "ArrowLeft" });
    expect(radio12).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(radio12);
  });

  it("allows re-selecting the same custom date after switching to Hoy/Mañana (W1)", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    const dateInput = screen.getByLabelText("Elegir otra fecha");

    // Select custom date: 2026-10-25
    fireEvent.click(dateInput);
    fireEvent.change(dateInput, { target: { value: "2026-10-25" } });
    const customChip = await screen.findByRole("button", { name: "Domingo 25" });
    expect(customChip).toHaveAttribute("aria-pressed", "true");

    // Switch to Hoy
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    expect(customChip).not.toHaveAttribute("aria-pressed", "true");

    // Click date picker again and select 2026-10-25 again
    fireEvent.click(dateInput);
    fireEvent.change(dateInput, { target: { value: "2026-10-25" } });
    expect(customChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hoy" })).not.toHaveAttribute("aria-pressed", "true");
  });

  it("rejects typed/pasted dates outside [today..today+30] and displays inline error message (W2)", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    const dateInput = screen.getByLabelText("Elegir otra fecha");

    // Date in past (2026-10-05 when fixed date is 2026-10-06)
    fireEvent.change(dateInput, { target: { value: "2026-10-05" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige una fecha entre hoy y el 5 de noviembre.",
    );
    // Start date should remain tomorrow (default)
    expect(screen.getByRole("button", { name: "Mañana" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Lunes 5" })).not.toBeInTheDocument();

    // Date too far ahead (>30 days: 2026-11-10)
    fireEvent.change(dateInput, { target: { value: "2026-11-10" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige una fecha entre hoy y el 5 de noviembre.",
    );
    expect(screen.getByRole("button", { name: "Mañana" })).toHaveAttribute("aria-pressed", "true");

    // Switching to Hoy clears the error message
    await userEvent.click(screen.getByRole("button", { name: "Hoy" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps API 422 StartDateInPast / StartDateTooFarAhead to inline error message (W2)", async () => {
    const { deps, location } = renderCreateSeason();
    deps.api.failNext("createSeason", new ApiError("StartDateInPast", 422, null));

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Elige una fecha entre hoy y el 5 de noviembre.",
    );
    expect(location()).toBe("/season/new");
  });

  it("disables Continue button until circle is loaded (W3)", async () => {
    renderCreateSeason({ circle: null, season: null });

    const continueBtn = screen.getByRole("button", { name: "Continuar" });
    expect(continueBtn).toBeDisabled();
  });

  it("provides a single accessible date picker control without duplicate focus stop (W4, S2)", async () => {
    renderCreateSeason();

    await screen.findByRole("heading", { level: 1, name: "Nueva temporada" });

    // There should NOT be a button named "Otra fecha"
    expect(screen.queryByRole("button", { name: /otra fecha/i })).not.toBeInTheDocument();

    // The single accessible control for "Otra fecha" is the date input
    const dateInput = screen.getByLabelText("Elegir otra fecha");
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).toHaveAttribute("type", "date");
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
