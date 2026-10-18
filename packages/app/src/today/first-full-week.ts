import { graceDeadline, type ScoreInput, seasonDay, weeklySeries } from "@pactjoy/engine";

/** Earliest fully kept, final week; minimum is enough (owner decision, 2026-10-18). */
export function firstFullWeek(input: ScoreInput): number | null {
  return (
    weeklySeries(input).find((week) => {
      const first = week.week * 7;
      const last = first + 6;
      // Sparse schedules can have no editable opportunities before the calendar week ends.
      const pending = input.pauses.some(
        (pause) =>
          pause.decision.kind === "pending" &&
          pause.startDay <= last &&
          (pause.end.kind === "open" || pause.end.lastDay >= first),
      );
      return (
        !pending &&
        input.today > graceDeadline(seasonDay(last)) &&
        week.final &&
        week.opportunities > 0 &&
        week.kept === week.opportunities
      );
    })?.week ?? null
  );
}
