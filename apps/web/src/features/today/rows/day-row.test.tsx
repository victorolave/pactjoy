import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type DayRow as DayRowData,
  dayRowFixture,
  type Entry,
  entryFixture,
  pointsFixture,
} from "../../../testing/fixtures/today.ts";
import { TodayDateContext } from "../today-date-context.tsx";
import { DayRow } from "./DayRow.tsx";

const show = (row: DayRowData) => render(<DayRow row={row} />);

const quantityDay = (overrides: Partial<DayRowData> = {}) =>
  dayRowFixture({
    habitName: "Correr",
    measure: {
      unit: "km",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "3", ideal: "5" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 4] } },
    },
    ...overrides,
  });

describe("day row (TO-R3)", () => {
  it("shows the habit and its specific days when open", () => {
    show(dayRowFixture());
    expect(screen.getByRole("heading", { name: "Meditar", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Lun · mié · vie")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the thresholds of a reach quantity", () => {
    show(quantityDay());
    expect(screen.getByRole("heading", { name: "Correr" })).toBeInTheDocument();
    expect(screen.getByText("mín. 3 · ideal 5 km")).toBeInTheDocument();
  });

  it("shows the thresholds of a limit quantity", () => {
    show(
      quantityDay({
        habitName: "Café",
        measure: {
          unit: "times",
          customLabel: null,
          precision: "integer",
          target: { direction: "limit", ideal: "1", tolerance: "3" },
          schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0] } },
        },
      }),
    );
    expect(screen.getByText("ideal hasta 1 · tolerancia 3 veces")).toBeInTheDocument();
  });

  it("sums several quantities of today into one line (design 22)", () => {
    show(
      quantityDay({
        opportunity: { state: "logged", graceUntil: null },
        entries: [
          entryFixture({ kind: "quantity", value: "3" }, { entryId: "e1" as Entry["entryId"] }),
          entryFixture({ kind: "quantity", value: "2.5" }, { entryId: "e2" as Entry["entryId"] }),
        ],
      }),
    );
    expect(screen.getByText("Llevas 5,5 km hoy")).toBeInTheDocument();
    expect(screen.queryByText("3 km")).not.toBeInTheDocument();
  });

  it("shows the points a logged day earned next to the title, and none before", () => {
    const { rerender } = render(<DayRow row={dayRowFixture()} />);
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
    rerender(
      <DayRow
        row={dayRowFixture({
          opportunity: { state: "logged", graceUntil: null },
          entries: [entryFixture({ kind: "done" })],
          points: pointsFixture({ perOpportunity: "8", earned: 8, limitPercents: null }),
        })}
      />,
    );
    expect(screen.getByText("+8 pts")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meditar" })).toBeInTheDocument();
  });

  it("says a done row is registered", () => {
    show(
      dayRowFixture({
        opportunity: { state: "logged", graceUntil: null },
        entries: [entryFixture({ kind: "done" })],
      }),
    );
    expect(screen.getByText("Registrado hoy")).toBeInTheDocument();
  });

  it("marks a private commitment for its owner (TO-R8)", () => {
    show(dayRowFixture({ privacy: "private" }));
    expect(screen.getByText("Privado")).toBeInTheDocument();
  });

  it("does not mark a visible commitment as private", () => {
    show(dayRowFixture());
    expect(screen.queryByText("Privado")).not.toBeInTheDocument();
  });

  it("says a day not scheduled today does not fall today", () => {
    show(dayRowFixture({ scheduledToday: false }));
    expect(screen.getByText("No toca hoy")).toBeInTheDocument();
  });

  it("renders the register control it is given for an open row", () => {
    render(<DayRow row={dayRowFixture()} action={<button type="button">Registrar</button>} />);
    expect(screen.getByRole("button", { name: "Registrar" })).toBeInTheDocument();
  });

  it("has no control unless one is given", () => {
    show(dayRowFixture());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says the weekday for an entry that belongs to yesterday (B-W1)", () => {
    render(
      <TodayDateContext.Provider value={{ today: "2026-10-02", refDate: "2026-10-02" }}>
        <DayRow
          row={dayRowFixture({
            opportunity: {
              state: "logged",
              graceUntil: "2026-10-03" as DayRowData["opportunity"]["graceUntil"],
            },
            entries: [
              entryFixture({ kind: "done" }, { forDate: "2026-10-01" as Entry["forDate"] }),
            ],
          })}
        />
      </TodayDateContext.Provider>,
    );
    expect(screen.getByText("Registrado el jueves")).toBeInTheDocument();
    expect(screen.queryByText("Registrado hoy")).not.toBeInTheDocument();
  });

  it("gives a Hoy no salió a neutral glyph, not the done check or the success tone (B-W2)", () => {
    const { container } = render(
      <DayRow
        row={dayRowFixture({
          opportunity: {
            state: "logged",
            graceUntil: "2026-10-03" as DayRowData["opportunity"]["graceUntil"],
          },
          entries: [entryFixture({ kind: "missed" })],
        })}
      />,
    );
    expect(screen.getByText("Hoy no salió")).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "default");
    expect(container.querySelector(".lucide-check")).toBeNull();
    expect(container.querySelector(".lucide-x")).not.toBeNull();
  });

  it("still gives a real done the success tone and the check", () => {
    const { container } = render(
      <DayRow
        row={dayRowFixture({
          opportunity: {
            state: "logged",
            graceUntil: "2026-10-03" as DayRowData["opportunity"]["graceUntil"],
          },
          entries: [entryFixture({ kind: "done" })],
        })}
      />,
    );
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "done");
    expect(container.querySelector(".lucide-check")).not.toBeNull();
  });
});
