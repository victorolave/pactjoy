import type { CommitmentProgressView } from "@pactjoy/app";
import type { CommitmentProgressDto } from "./progress.ts";
import { presentDetail } from "./progress-member.ts";

type Started = Extract<CommitmentProgressView, { state: "active" | "ended" }>;
type Week = Started["weeks"][number];
type Cell = Week["cells"][number];

function presentCell(cell: Cell): Cell {
  return {
    kind: cell.kind,
    date: cell.date,
    status: cell.status,
    progressPercent: cell.progressPercent,
    late: cell.late,
    evidence: cell.evidence.map((entry) => ({
      forDate: entry.forDate,
      recordedOn: entry.recordedOn,
      value:
        entry.value.kind === "quantity"
          ? { kind: "quantity", value: entry.value.value }
          : { kind: entry.value.kind },
      note: entry.note,
    })),
  };
}

/** Explicit wire whitelist (ADR-0011): no entry, request or user ids can reach the client. */
export function presentCommitmentProgress(view: CommitmentProgressView): CommitmentProgressDto {
  if (view.state === "notStarted") return { state: "notStarted", seasonId: view.seasonId };
  const { id, timeZone, lengthWeeks, actualStart, lastDay } = view.season;
  const { today, weekIndex, dayOfWeek, daysLeft } = view.calendar;
  return {
    state: view.state,
    viewerId: view.viewerId,
    season: { id, timeZone, lengthWeeks, actualStart, lastDay },
    calendar: { today, weekIndex, dayOfWeek, daysLeft },
    memberId: view.memberId,
    commitment: presentDetail(view.commitment),
    weeks: view.weeks.map((week) => ({
      weekIndex: week.weekIndex,
      start: week.start,
      end: week.end,
      timing: week.timing,
      facts: {
        counted: week.facts.counted,
        editable: week.facts.editable,
        final: week.facts.final,
      },
      status: week.status,
      sessionsDone: week.sessionsDone,
      sessionsTarget: week.sessionsTarget,
      cells: week.cells.map(presentCell),
    })),
    scoring: {
      perOpportunityPoints: view.scoring.perOpportunityPoints,
      opportunityCount: view.scoring.opportunityCount,
      curve:
        view.scoring.curve === null
          ? null
          : view.scoring.curve.map((row) => ({
              value: row.value,
              progressPercent: row.progressPercent,
            })),
    },
  };
}
