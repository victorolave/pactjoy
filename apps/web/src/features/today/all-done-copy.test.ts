import { describe, expect, it } from "vitest";
import { dayRowFixture, type Entry, entryFixture } from "../../testing/fixtures/today.ts";
import { allDoneDetail } from "./all-done-copy.ts";

const TODAY = "2026-10-02";

const done = (habitName: string) =>
  dayRowFixture({
    habitName,
    opportunity: { state: "logged", graceUntil: null },
    entries: [entryFixture({ kind: "done" })],
  });

const minutes = (habitName: string, ...values: string[]) =>
  dayRowFixture({
    habitName,
    measure: {
      unit: "minutes",
      customLabel: null,
      precision: "integer",
      target: { direction: "reach", minimum: "10", ideal: "30" },
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [4] } },
    },
    opportunity: { state: "logged", graceUntil: null },
    entries: values.map((value, index) =>
      entryFixture({ kind: "quantity", value }, { entryId: `e${index}` as Entry["entryId"] }),
    ),
  });

describe("allDoneDetail (design 15b)", () => {
  it("lists a quantity with its unit and a done by name, then the day's points", () => {
    expect(allDoneDetail([minutes("Leer", "30"), done("Dibujar")], TODAY, 14)).toBe(
      "Leer 30 min y Dibujar. +14 pts hoy.",
    );
  });

  it("joins three or more the Spanish way", () => {
    expect(allDoneDetail([done("A"), done("B"), done("C")], TODAY, 0)).toBe("A, B y C.");
  });

  it("sums several entries of the same quantity", () => {
    expect(allDoneDetail([minutes("Leer", "20", "10")], TODAY, 0)).toBe("Leer 30 min.");
  });

  it("names a single item on its own", () => {
    expect(allDoneDetail([done("Meditar")], TODAY, 0)).toBe("Meditar.");
  });

  it("leaves the points out when there are none, zero or not given", () => {
    expect(allDoneDetail([done("Meditar")], TODAY, 0)).toBe("Meditar.");
    expect(allDoneDetail([done("Meditar")], TODAY, undefined as unknown as number)).toBe(
      "Meditar.",
    );
  });

  it("says a point in the singular", () => {
    expect(allDoneDetail([done("Meditar")], TODAY, 1)).toBe("Meditar. +1 pt hoy.");
  });

  it("lists a day marked Hoy no salió by name too, with no quantity", () => {
    const missed = dayRowFixture({
      habitName: "Gym",
      opportunity: { state: "logged", graceUntil: null },
      entries: [entryFixture({ kind: "missed" })],
    });
    expect(allDoneDetail([done("Meditar"), missed], TODAY, 8)).toBe("Meditar y Gym. +8 pts hoy.");
  });

  it("counts only the day on display", () => {
    const old = minutes("Leer", "30");
    const yesterday = {
      ...old,
      entries: [
        entryFixture(
          { kind: "quantity", value: "30" },
          { forDate: "2026-10-01" as Entry["forDate"] },
        ),
      ],
    };
    expect(allDoneDetail([yesterday], TODAY, 0)).toBe("Leer.");
  });
});
