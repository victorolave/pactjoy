import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StepChrome } from "../chrome.ts";
import { ItemOneStep } from "./ItemOneStep.tsx";

const chrome: StepChrome = {
  onBack: () => {},
  backLabel: "Volver",
  backIcon: "chevron-left",
  progress: null,
};

const commitments = [
  { commitmentId: "a", habitName: "Leer", paused: false },
  { commitmentId: "b", habitName: "Inglés", paused: false },
  { commitmentId: "c", habitName: "Dibujar", paused: false },
  { commitmentId: "d", habitName: "Gym", paused: true },
];

const base = {
  chrome,
  commitments,
  answers: {} as Record<string, readonly (number | null)[]>,
  onAnswer: () => {},
  onFinish: () => {},
  pending: false,
  offline: false,
  error: null as string | null,
};

describe("ItemOneStep (35c)", () => {
  it("lists every commitment on one screen with the first phrase of the SRBAI", () => {
    render(<ItemOneStep {...base} />);
    expect(screen.getByText("Última pregunta · solo para ti")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "¿Cuánto te identificas con esta frase?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 · nada de acuerdo — 7 · totalmente")).toBeInTheDocument();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(4);
    expect(groups[0]).toHaveAccessibleName("«Leer»: lo hago automáticamente.");
    expect(groups[1]).toHaveAccessibleName("«Inglés»: lo hago automáticamente.");
  });

  it("tags a paused commitment but still asks about it", () => {
    render(<ItemOneStep {...base} />);
    expect(screen.getAllByRole("group")[3]).toHaveAccessibleName(
      "«Gym»: lo hago automáticamente. (en pausa)",
    );
    expect(screen.getByText("«Gym»: lo hago automáticamente. (en pausa)")).toBeInTheDocument();
  });

  it("reports the commitment and score and marks the chosen one", async () => {
    const onAnswer = vi.fn();
    render(<ItemOneStep {...base} answers={{ b: [3, null, null, null] }} onAnswer={onAnswer} />);
    const groups = screen.getAllByRole("group");
    expect(within(groups[1] as HTMLElement).getByRole("button", { name: "3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(groups[0] as HTMLElement).getByRole("button", { name: "6" }));
    expect(onAnswer).toHaveBeenCalledWith("a", 6);
  });

  it("finishes with 'Terminar revisión' only when every commitment has an answer", async () => {
    const onFinish = vi.fn();
    const { rerender } = render(
      <ItemOneStep {...base} answers={{ a: [5, null, null, null] }} onFinish={onFinish} />,
    );
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    rerender(
      <ItemOneStep
        {...base}
        answers={{
          a: [5, null, null, null],
          b: [3, null, null, null],
          c: [4, null, null, null],
          d: [2, null, null, null],
        }}
        onFinish={onFinish}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Terminar revisión" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("blocks saving while pending or offline and shows a failure", () => {
    const answered = Object.fromEntries(
      commitments.map((c) => [c.commitmentId, [4, null, null, null]]),
    );
    const { rerender } = render(<ItemOneStep {...base} answers={answered} pending />);
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    rerender(<ItemOneStep {...base} answers={answered} offline />);
    expect(screen.getByRole("button", { name: "Terminar revisión" })).toBeDisabled();
    expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
    rerender(<ItemOneStep {...base} answers={answered} error="No pudimos guardar tu revisión." />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos guardar tu revisión.");
  });
});
