import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type DayRow as DayRowData,
  dayRowFixture,
  type Entry,
  entryFixture,
} from "../../../testing/fixtures/today.ts";
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

  it("shows what was logged, and every entry of the day", () => {
    show(
      quantityDay({
        opportunity: { state: "logged", graceUntil: null },
        entries: [
          entryFixture({ kind: "quantity", value: "3" }, { entryId: "e1" as Entry["entryId"] }),
          entryFixture({ kind: "quantity", value: "2.5" }, { entryId: "e2" as Entry["entryId"] }),
        ],
      }),
    );
    expect(screen.getByText("3 km")).toBeInTheDocument();
    expect(screen.getByText("2,5 km")).toBeInTheDocument();
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
});
