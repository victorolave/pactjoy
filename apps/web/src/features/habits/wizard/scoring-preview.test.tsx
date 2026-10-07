import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { renderInProviders } from "../../../testing/render.tsx";
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
      <ScoringPreview measure={measure} />
    </>
  );
}

describe("server scoring preview", () => {
  it("renders server percentages, never a locally calculated score", async () => {
    const { deps } = renderInProviders(<ScoringPreview measure={initialWizard().measure} />);
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "10", progressPercent: "37" }] });
    expect(screen.getByRole("region", { name: "Así puntúa" })).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(await screen.findByText("37 %")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "10 min" })).toHaveAttribute(
      "aria-valuenow",
      "37",
    );
    expect(deps.api.pactCommands.find((c) => c.method === "previewScoring")?.args[0]).toEqual({
      measure: initialWizard().measure,
      values: ["0", "10", "20", "30", "35"],
    });
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
    const { deps } = renderInProviders(<ScoringPreview measure={initialWizard().measure} />);
    deps.api.failNext("previewScoring", new ApiError("NetworkError", 0, null));
    deps.api.setPactResponse("previewScoring", { rows: [{ value: "30", progressPercent: "100" }] });
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("100 %")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
