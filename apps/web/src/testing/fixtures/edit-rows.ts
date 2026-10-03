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

export const renderToday = (rows: TodayRow[], path = "/") =>
  renderApp({ path, today: activeTodayFixture({ rows }) });

export const quantity = (value: string, id = "entry-1", note: string | null = null) =>
  entryFixture({ kind: "quantity", value }, { entryId: entryId(id), note });
