import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MemberProgress } from "../../ports/wire.ts";
import { leerRow, peerMemberProgress } from "../../testing/fixtures/season-progress.ts";
import { MemberSeason } from "./MemberSeason.tsx";

type Started = Extract<MemberProgress, { state: "active" | "ended" }>;

/** Andrea seen by Victor (23d): two visible rows and one private, as in the design. */
function andrea(overrides: Partial<Started> = {}): Started {
  const base = peerMemberProgress();
  return {
    ...base,
    commitments: [
      leerRow({
        commitmentId: "commitment-correr",
        habit: { name: "Correr", icon: "footprints" },
        weightPercent: 30,
        points: 120,
        opportunities: { kept: 11, counted: 13 },
        measure: {
          unit: "done",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
        },
      }),
      leerRow({
        commitmentId: "commitment-meditar",
        habit: { name: "Meditar", icon: "flower" },
        weightPercent: 20,
        points: 96,
        opportunities: { kept: 27, counted: 31 },
        measure: {
          unit: "done",
          schedule: {
            period: "perSession",
            frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
          },
        },
      }),
      { kind: "hidden", commitmentId: "commitment-secret", weightPercent: 30, points: 118 },
    ],
    ...overrides,
  } as Started;
}

describe("MemberSeason (23d)", () => {
  it("shows the member, the season week and the three metrics", () => {
    render(<MemberSeason view={andrea()} onBack={() => {}} />);

    expect(screen.getByRole("heading", { level: 1, name: "Andrea" })).toBeTruthy();
    expect(screen.getByText("Semana 5 de 8")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Andrea" })).toBeTruthy();
    const metrics = screen.getByRole("list", { name: "Andrea" });
    const items = within(metrics)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["Puntos412", "Consistencia88 %", "Ideal81 %"]);
  });

  it("metrics with nothing counted yet show a dash, never 0 %", () => {
    render(
      <MemberSeason
        view={andrea({ points: 0, consistency: null, idealCompletion: null })}
        onBack={() => {}}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Andrea" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["Puntos0", "Consistencia-", "Ideal-"]);
  });

  it("lists her commitments read-only, with points over possible points", () => {
    render(<MemberSeason view={andrea()} onBack={() => {}} />);

    expect(screen.getByRole("heading", { level: 2, name: "Sus compromisos" })).toBeTruthy();
    expect(screen.getByText("Puntos / posibles")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Sus compromisos" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "Correr3 veces/sem · 11 de 13 sesiones120 / 300",
      "MeditarTodos los días · 27 de 31 días96 / 200",
      "Objetivo privadoPeso 30 %118 / 300",
    ]);
    // Read-only: no drilldown, no per-commitment comparison.
    for (const row of rows) {
      expect(within(row).queryByRole("link")).toBeNull();
      expect(within(row).queryByRole("button")).toBeNull();
    }
  });

  it("a private commitment discloses nothing but its weight and points", () => {
    const { container } = render(<MemberSeason view={andrea()} onBack={() => {}} />);

    expect(
      screen.getByText("Los objetivos privados solo muestran su peso y sus puntos."),
    ).toBeTruthy();
    expect(container.innerHTML).not.toContain("commitment-secret");
  });

  it("without private commitments there is no privacy note", () => {
    const visibleOnly = andrea().commitments.filter((c) => c.kind === "detail");
    render(<MemberSeason view={andrea({ commitments: visibleOnly })} onBack={() => {}} />);
    expect(
      screen.queryByText("Los objetivos privados solo muestran su peso y sus puntos."),
    ).toBeNull();
  });

  it("an ended season stays on its last week", () => {
    const view = andrea({
      state: "ended",
      calendar: { today: "2026-10-20", weekIndex: 7, dayOfWeek: 7, daysLeft: 0 },
    });
    render(<MemberSeason view={view} onBack={() => {}} />);
    expect(screen.getByText("Semana 8 de 8")).toBeTruthy();
  });

  it("Volver a Temporada goes back, with a 44 px target from the shared IconButton", async () => {
    const onBack = vi.fn();
    render(<MemberSeason view={andrea()} onBack={onBack} />);

    const back = screen.getByRole("button", { name: "Volver a Temporada" });
    expect(back.className).toContain("pj-iconbtn");
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
