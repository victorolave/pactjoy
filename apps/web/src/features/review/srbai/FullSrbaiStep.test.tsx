import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StepChrome } from "../chrome.ts";
import { FullSrbaiStep } from "./FullSrbaiStep.tsx";

const chrome: StepChrome = {
  onBack: () => {},
  backLabel: "Volver",
  backIcon: "chevron-left",
  progress: null,
};

const base = {
  chrome,
  habitName: "Leer",
  paused: false,
  position: { index: 0, total: 4 },
  nextName: "Inglés" as string | null,
  slots: [null, null, null, null] as readonly (number | null)[],
  onAnswer: () => {},
  onNext: () => {},
  pending: false,
  offline: false,
  error: null as string | null,
};

describe("FullSrbaiStep (35a, 13)", () => {
  it("shows one commitment with its four phrases, a 1 to 7 scale each, and the privacy note", () => {
    render(<FullSrbaiStep {...base} />);
    expect(screen.getByText("Compromiso 1 de 4 · Leer")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "¿Cuánto te identificas con cada frase hoy?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Solo tú verás estas respuestas.")).toBeInTheDocument();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(4);
    expect(groups[0]).toHaveAccessibleName("«Leer»: lo hago automáticamente.");
    expect(groups[2]).toHaveAccessibleName("«Leer»: lo hago sin pensar.");
    for (const group of groups) {
      expect(
        within(group)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    }
    expect(screen.getByText("1 · Nada de acuerdo")).toBeInTheDocument();
    expect(screen.getByText("7 · Totalmente")).toBeInTheDocument();
  });

  it("reports the item and the score that were chosen and marks the answered one pressed", async () => {
    const onAnswer = vi.fn();
    render(<FullSrbaiStep {...base} slots={[5, null, null, null]} onAnswer={onAnswer} />);
    const [first, second] = screen.getAllByRole("group") as [HTMLElement, HTMLElement];
    expect(within(first).getByRole("button", { name: "5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(first).getByRole("button", { name: "4" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(within(second).getByRole("button", { name: "3" }));
    expect(onAnswer).toHaveBeenCalledWith(1, 3);
  });

  it("asks for the four answers before it lets the member move on", () => {
    render(<FullSrbaiStep {...base} slots={[5, 4, 5, null]} />);
    expect(screen.getByRole("button", { name: "Responde las 4 frases" })).toBeDisabled();
  });

  it("names the next commitment on the button once the four are answered", async () => {
    const onNext = vi.fn();
    render(<FullSrbaiStep {...base} slots={[5, 4, 5, 4]} onNext={onNext} />);
    const next = screen.getByRole("button", { name: "Siguiente: Inglés" });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("finishes the review on the last commitment", () => {
    render(
      <FullSrbaiStep
        {...base}
        position={{ index: 3, total: 4 }}
        nextName={null}
        slots={[5, 4, 5, 4]}
      />,
    );
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeEnabled();
  });

  it("tags a paused commitment, which is still asked about", () => {
    render(<FullSrbaiStep {...base} habitName="Gym" paused />);
    expect(screen.getByText("Compromiso 1 de 4 · Gym (en pausa)")).toBeInTheDocument();
  });

  it("blocks the last step while saving or offline, and says why offline", () => {
    const last = {
      ...base,
      position: { index: 3, total: 4 },
      nextName: null,
      slots: [5, 4, 5, 4] as const,
    };
    const { rerender } = render(<FullSrbaiStep {...last} pending />);
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    rerender(<FullSrbaiStep {...last} offline />);
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
  });

  it("shows a failure to save above the button", () => {
    render(<FullSrbaiStep {...base} slots={[5, 4, 5, 4]} error="Algo salió mal." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Algo salió mal.");
  });
});
