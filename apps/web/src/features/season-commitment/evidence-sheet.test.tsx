import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { commitmentProgress, leerRow } from "../../testing/fixtures/season-progress.ts";
import { HistoryGrid } from "./HistoryGrid.tsx";

type View = ReturnType<typeof commitmentProgress>;
type Cell = View["weeks"][number]["cells"][number];

/** The fixture's current week (24a): a late ideal session with a note, then a future slot. */
function withCells(cells: readonly Cell[], view: View = commitmentProgress()): View {
  const [week] = view.weeks;
  return week ? { ...view, weeks: [{ ...week, cells }] } : view;
}

const [lateIdeal, future] = commitmentProgress().weeks[0]?.cells ?? [];

describe("read-only evidence of a history cell (24a, C4)", () => {
  it("the hint now says a cell can be opened", () => {
    render(<HistoryGrid view={commitmentProgress()} />);

    expect(
      screen.getByText(
        "Cada celda es una de tus 5 oportunidades de la semana. Toca una para ver su registro y su nota.",
      ),
    ).toBeTruthy();
  });

  it("only a cell with a registro opens; a future one is not a control", () => {
    render(<HistoryGrid view={commitmentProgress()} />);

    const button = screen.getByRole("button", { name: "Ideal, registrado posteriormente" });
    expect(button).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("shows the day, the value, the note and the late marker, with no photo", async () => {
    render(<HistoryGrid view={commitmentProgress()} />);

    await userEvent.click(screen.getByRole("button", { name: "Ideal, registrado posteriormente" }));

    const sheet = screen.getByRole("dialog", { name: "Martes 22 de septiembre" });
    expect(within(sheet).getByText("30 min")).toBeTruthy();
    expect(within(sheet).getByText("Capítulo 3")).toBeTruthy();
    expect(within(sheet).getByText("Registrado posteriormente")).toBeTruthy();
    expect(within(sheet).queryByText(/foto/i)).toBeNull();
    expect(within(sheet).queryByRole("img", { name: /foto/i })).toBeNull();
  });

  it("Escape closes it and focus returns to the cell", async () => {
    render(<HistoryGrid view={commitmentProgress()} />);
    const cell = screen.getByRole("button", { name: "Ideal, registrado posteriormente" });

    await userEvent.click(cell);
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(cell);
  });

  it("done / not done and an explicit miss read with the app's words", async () => {
    if (lateIdeal === undefined || future === undefined) throw new Error("fixture changed");
    const base = commitmentProgress();
    const view = withCells(
      [
        {
          ...lateIdeal,
          late: false,
          evidence: [
            { ...lateIdeal.evidence[0], value: { kind: "done" }, note: null },
          ] as Cell["evidence"],
        },
        {
          ...lateIdeal,
          status: "missed",
          late: false,
          evidence: [
            { ...lateIdeal.evidence[0], value: { kind: "missed" }, note: null },
          ] as Cell["evidence"],
        },
        future,
      ],
      {
        ...base,
        commitment: leerRow({
          measure: {
            unit: "done",
            schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
          },
        }),
      },
    );
    render(<HistoryGrid view={view} />);

    await userEvent.click(screen.getByRole("button", { name: "Ideal" }));
    expect(within(screen.getByRole("dialog")).getByText("Hecho")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "No salió" }));
    expect(within(screen.getByRole("dialog")).getAllByText("No salió").length).toBeGreaterThan(0);
  });

  it("several registros of one day (summed session) are listed in order", async () => {
    if (lateIdeal === undefined || future === undefined) throw new Error("fixture changed");
    const [first] = lateIdeal.evidence;
    if (first === undefined) throw new Error("fixture changed");
    render(
      <HistoryGrid
        view={withCells([
          {
            ...lateIdeal,
            late: false,
            evidence: [
              {
                ...first,
                recordedOn: first.forDate,
                value: { kind: "quantity", value: "10" },
                note: null,
              },
              {
                ...first,
                recordedOn: first.forDate,
                value: { kind: "quantity", value: "20" },
                note: "Noche",
              },
            ],
          },
          future,
        ])}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ideal" }));
    const items = within(screen.getByRole("dialog")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["10 min", "20 minNoche"]);
    expect(within(screen.getByRole("dialog")).queryByText("Registrado posteriormente")).toBeNull();
  });
});
