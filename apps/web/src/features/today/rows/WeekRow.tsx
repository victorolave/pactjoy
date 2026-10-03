import type { ReactNode } from "react";
import { ProgressBar } from "../../../ui/ProgressBar.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import { formatDecimal, reachMarks, scheduleText, targetText, unitLabel } from "../row-labels.ts";
import type { WeekTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";
import { SessionBar } from "./SessionBar.tsx";

type Progress = NonNullable<WeekTodayRow["progress"]>;

function detailOf(row: WeekTodayRow, progress: Progress): string {
  const { measure } = row;
  if (measure.schedule.period === "perSession") {
    return `${progress.sessionsDone} de ${progress.sessionsTarget} esta semana`;
  }
  const unit = unitLabel(measure);
  const suffix = unit === null || unit === "" ? "" : ` ${unit}`;
  const value = formatDecimal(progress.value ?? "0");
  if (progress.target.direction === "reach") {
    return `${value} / ${formatDecimal(progress.target.ideal)}${suffix} esta semana`;
  }
  return `${value}${suffix} esta semana · ${targetText(measure) ?? ""}`;
}

function barOf(row: WeekTodayRow, progress: Progress): ReactNode {
  // A session row shows today's amount against its minimum and ideal (design proto).
  if (row.measure.schedule.period === "perSession") return <SessionBar row={row} />;
  // A weekly reach total reads against its ideal, with the minimum marked and no percent.
  if (progress.target.direction !== "reach") return undefined;
  return (
    <ProgressBar
      name={`Progreso de ${row.habitName}`}
      value={Number(progress.value ?? "0")}
      max={Number(progress.target.ideal)}
      minimum={Number(progress.target.minimum)}
      marks={reachMarks(row.measure)}
    />
  );
}

export function WeekRow({
  row,
  action,
  below,
}: {
  readonly row: WeekTodayRow;
  readonly action?: ReactNode;
  readonly below?: ReactNode;
}) {
  const { progress } = row;
  const closed = row.opportunity.state === "closed";
  return (
    <RowFrame
      title={row.habitName}
      glyph="repeat"
      details={[
        progress === null ? scheduleText(row.measure) : detailOf(row, progress),
        ...(closed ? ["Cerrada"] : []),
      ]}
      badges={row.privacy === "private" ? <Tag>Privado</Tag> : undefined}
      points={row.points.earned}
      action={action}
      below={
        <>
          {progress === null ? undefined : barOf(row, progress)}
          {below}
        </>
      }
    />
  );
}
