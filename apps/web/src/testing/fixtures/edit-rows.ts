import type { TodayRow } from "@pactjoy/app";
import { renderApp } from "../render.tsx";
import {
  activeTodayFixture,
  type DayRow,
  dayRowFixture,
  type Entry,
  entryFixture,
  type WeekRow,
  weekRowFixture,
} from "./today.ts";

export const entryId = (value: string) => value as Entry["entryId"];

export const reading = (entries: Entry[], overrides: Partial<WeekRow> = {}): WeekRow =>
  weekRowFixture({
    entries,
    opportunity: {
      state: "logged",
      graceUntil: "2026-10-03" as WeekRow["opportunity"]["graceUntil"],
    },
    ...overrides,
  });

export const meditation = (entries: Entry[], overrides: Partial<DayRow> = {}): DayRow =>
  dayRowFixture({
    entries,
    opportunity: {
      state: "logged",
      graceUntil: "2026-10-03" as DayRow["opportunity"]["graceUntil"],
    },
    ...overrides,
  });

export const coffee = (entries: Entry[]): DayRow =>
  dayRowFixture({
    commitmentId: "commitment-5" as DayRow["commitmentId"],
    habitName: "Café",
    entries,
    opportunity: {
      state: "logged",
      graceUntil: "2026-10-03" as DayRow["opportunity"]["graceUntil"],
    },
    measure: {
      unit: "times",
      customLabel: null,
      precision: "integer",
      target: { direction: "limit", ideal: "2", tolerance: "4" },
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    },
  });

export const renderToday = (rows: TodayRow[], path = "/") =>
  renderApp({ path, today: activeTodayFixture({ rows }) });

export const quantity = (value: string, id = "entry-1", note: string | null = null) =>
  entryFixture({ kind: "quantity", value }, { entryId: entryId(id), note });
