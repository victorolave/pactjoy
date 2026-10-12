import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { designSummary, interimFullFixture } from "../../../testing/fixtures/review.ts";
import type { StepChrome } from "../chrome.ts";
import { PeriodSummaryStep } from "./PeriodSummaryStep.tsx";

const chrome = (onBack = vi.fn()): StepChrome => ({
  onBack,
  backLabel: "Cerrar",
  backIcon: "x",
  progress: <span>barras</span>,
});

describe("PeriodSummaryStep (33)", () => {
  it("shows the period, the three totals and one line per commitment, as designed", () => {
    render(<PeriodSummaryStep chrome={chrome()} draft={interimFullFixture()} onNext={() => {}} />);
    expect(screen.getByText("Revisión privada · semanas 3 y 4")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Así fueron tus dos últimas semanas" }),
    ).toBeInTheDocument();
    const totals = screen.getByRole("region", { name: "Totales del periodo" });
    expect(within(totals).getByText("Consistencia").nextSibling).toHaveTextContent("83 %");
    expect(within(totals).getByText("Ideal").nextSibling).toHaveTextContent("77 %");
    expect(within(totals).getByText("Puntos").nextSibling).toHaveTextContent("+184");
    const list = screen.getByRole("list", { name: "Compromisos del periodo" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText("Leer").parentElement).toHaveTextContent("9 de 10 · ideal 80 %");
    expect(within(list).getByText("Inglés").parentElement).toHaveTextContent(
      "2 de 2 semanas · ideal 72 %",
    );
  });

  it("says the last week's figures can still change while its grace period is open", () => {
    const open = interimFullFixture({ summary: designSummary(false) });
    const { rerender } = render(
      <PeriodSummaryStep chrome={chrome()} draft={open} onNext={() => {}} />,
    );
    expect(
      screen.getByText("Las cifras de la última semana todavía pueden cambiar."),
    ).toBeInTheDocument();
    rerender(
      <PeriodSummaryStep chrome={chrome()} draft={interimFullFixture()} onNext={() => {}} />,
    );
    expect(
      screen.queryByText("Las cifras de la última semana todavía pueden cambiar."),
    ).not.toBeInTheDocument();
  });

  it("shows a dash for the totals and a plain line for a commitment with nothing counted", () => {
    const base = designSummary();
    const draft = interimFullFixture({
      summary: {
        ...base,
        totals: { consistencyPercent: null, idealPercent: null, points: 0 },
        commitments: [
          {
            ...(base.commitments[3] as (typeof base.commitments)[number]),
            kept: 0,
            counted: 0,
            consistencyPercent: null,
            idealPercent: null,
            points: 0,
          },
        ],
      },
    });
    render(<PeriodSummaryStep chrome={chrome()} draft={draft} onNext={() => {}} />);
    const totals = screen.getByRole("region", { name: "Totales del periodo" });
    expect(within(totals).getByText("Consistencia").nextSibling).toHaveTextContent("–");
    expect(screen.getByText("Sin oportunidades en el periodo")).toBeInTheDocument();
  });

  it("continues with the button and closes with the X of the top row", async () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <PeriodSummaryStep chrome={chrome(onBack)} draft={interimFullFixture()} onNext={onNext} />,
    );
    expect(screen.getByText("barras")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
