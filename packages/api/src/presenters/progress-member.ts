import type { MemberProgressView } from "@pactjoy/app";
import type { MemberProgressDto } from "./progress.ts";

type Detail = Extract<MemberProgressView, { scope: "own" }>["commitments"][number];

/** A commitment row its viewer may fully see; shared with the commitment detail presenter. */
export function presentDetail(row: Detail): Detail {
  return {
    kind: "detail",
    commitmentId: row.commitmentId,
    habit: { name: row.habit.name, icon: row.habit.icon },
    weightPercent: row.weightPercent,
    privacy: row.privacy,
    measure: row.measure,
    points: row.points,
    consistency: row.consistency,
    idealCompletion: row.idealCompletion,
    opportunities: { kept: row.opportunities.kept, counted: row.opportunities.counted },
    streak: { unit: row.streak.unit, current: row.streak.current, best: row.streak.best },
    pause: row.pause,
  };
}

/** Explicit wire whitelist; a private row never inherits detail or repository fields. */
export function presentMemberProgress(view: MemberProgressView): MemberProgressDto {
  if (view.state === "notStarted") return { state: "notStarted", seasonId: view.seasonId };
  const { id, timeZone, lengthWeeks, actualStart, lastDay } = view.season;
  const { today, weekIndex, dayOfWeek, daysLeft } = view.calendar;
  const base = {
    state: view.state,
    viewerId: view.viewerId,
    season: { id, timeZone, lengthWeeks, actualStart, lastDay },
    calendar: { today, weekIndex, dayOfWeek, daysLeft },
    member: { memberId: view.member.memberId, displayName: view.member.displayName },
    points: view.points,
    consistency: view.consistency,
    idealCompletion: view.idealCompletion,
  };
  if (view.scope === "own")
    return { ...base, scope: "own", commitments: view.commitments.map(presentDetail) };
  return {
    ...base,
    scope: "others",
    commitments: view.commitments.map((row) =>
      row.kind === "detail"
        ? presentDetail(row)
        : {
            kind: "hidden" as const,
            commitmentId: row.commitmentId,
            weightPercent: row.weightPercent,
            points: row.points,
          },
    ),
  };
}
