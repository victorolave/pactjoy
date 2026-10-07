import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { FakePactJoyApi } from "../../../testing/fake-pactjoy-api.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { defaultMeasure } from "./measure-defaults.ts";
import { ScoringPreview } from "./ScoringPreview.tsx";
import { initialWizard } from "./wizard-model.ts";

function ChangingPreview() {
  const [measure, setMeasure] = useState(initialWizard().measure);
  return (
    <>
      <button
        type="button"
        onClick={() => setMeasure({ unit: "done", frequency: { kind: "timesPerWeek", times: 3 } })}
      >
        Change measure
      </button>
      <button
        type="button"
        onClick={() => setMeasure(defaultMeasure("hours", "limit", "weeklyTotal"))}
      >
        Change period
      </button>
      <ScoringPreview measure={measure} />
    </>
  );
}

describe("server scoring preview", () => {
  it("starts immediately after auth is ready, debouncing only subsequent changes for 250 ms", async () => {
    vi.useFakeTimers();
    try {
      const { deps } = renderInProviders(<ChangingPreview />);
      deps.api.setPactResponse("previewScoring", {
        rows: [{ value: "10", progressPercent: "37" }],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(deps.api.calls.previewScoring).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Change measure" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(249);
      });
      expect(deps.api.calls.previewScoring).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(deps.api.calls.previewScoring).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("renders server percentages, never a locally calculated score", async () => {
    const { deps } = renderInProviders(<ScoringPreview measure={initialWizard().measure} />);
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "10", progressPercent: "37" }] });
    expect(screen.getByRole("region", { name: "Así puntúa" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("region", { name: "Así puntúa" })).not.toHaveAttribute("aria-live");
    expect(await screen.findByText("37 %")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("10 min: 37 %");
    expect(screen.getByRole("status")).not.toHaveTextContent("El mínimo cuenta");
    expect(screen.getByRole("progressbar", { name: "10 min" })).toHaveAttribute(
      "aria-valuenow",
      "37",
    );
    expect(deps.api.pactCommands.find((c) => c.method === "previewScoring")?.args[0]).toEqual({
      measure: initialWizard().measure,
      values: ["0", "10", "20", "30", "35"],
    });
  });

  it("retains the previous period, note and unit together while a changed preview is loading", async () => {
    const { deps } = renderInProviders(<ChangingPreview />);
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "10", progressPercent: "33" }] });
    await screen.findByText("33 %");
    const release = deps.api.hold("previewScoring");
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "3", progressPercent: "75" }] });
    await userEvent.click(screen.getByRole("button", { name: "Change period" }));
    await waitFor(() => expect(deps.api.calls.previewScoring).toBe(2));
    expect(screen.getByText("por sesión")).toBeVisible();
    expect(screen.getByText(/El mínimo cuenta/)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "10 min" })).toBeVisible();
    await act(async () => release());
    expect(await screen.findByText("75 %")).toBeVisible();
    expect(screen.getByText("por semana")).toBeVisible();
    expect(screen.getByText(/Por encima de la tolerancia/)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "3 h" })).toBeVisible();
  });

  it("trims custom labels in the first immediate preview request", async () => {
    const measure = defaultMeasure("custom");
    if (measure.unit !== "custom") throw new Error("Custom measure required");
    const { deps } = renderInProviders(
      <ScoringPreview measure={{ ...measure, customLabel: "  vueltas  " }} />,
    );
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "1", progressPercent: "50" }] });
    expect(await screen.findByText("50 %")).toBeVisible();
    expect(deps.api.pactCommands[0]?.args[0]).toMatchObject({
      measure: { customLabel: "vueltas" },
    });
    expect(screen.getByRole("progressbar", { name: "1 vueltas" })).toBeVisible();
  });

  it("debounces changes and keeps the previous rows until the new response arrives", async () => {
    const { deps } = renderInProviders(<ChangingPreview />);
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "10", progressPercent: "33" }] });
    expect(await screen.findByText("33 %")).toBeVisible();
    const release = deps.api.hold("previewScoring");
    deps.api.setPactResponse("previewScoring", {
      rows: [
        { value: "1", progressPercent: "100" },
        { value: "0", progressPercent: "0" },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Change measure" }));
    expect(deps.api.calls.previewScoring).toBe(1);
    expect(screen.getByText("33 %")).toBeVisible();
    await waitFor(() => expect(deps.api.calls.previewScoring).toBe(2));
    expect(screen.getByText("33 %")).toBeVisible();
    await act(async () => release());
    expect(await screen.findByText("Hecho")).toBeVisible();
    expect(screen.getByText("No hecho")).toBeVisible();
    expect(screen.queryByText("33 %")).not.toBeInTheDocument();
  });

  it("offers retry after a failed preview and renders the recovered server result", async () => {
    const failure = vi
      .spyOn(FakePactJoyApi.prototype, "previewScoring")
      .mockRejectedValueOnce(new ApiError("NetworkError", 0, null));
    const { deps } = renderInProviders(<ScoringPreview measure={initialWizard().measure} />);
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "30", progressPercent: "100" }] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    failure.mockRestore();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("100 %")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
