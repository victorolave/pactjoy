import type { ReactNode } from "react";
import { ProgressBar, type ProgressMark } from "../../../ui/ProgressBar.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import { formatDecimal, scheduleText, targetText, unitLabel } from "../row-labels.ts";
import type { WeekTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";

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
  const valueLabel = `${progress.percent} %`;
  // Sessions are scored by the server: the bar shows its percent as is.
  if (row.measure.schedule.period === "perSession") {
    return <ProgressBar value={progress.percent} max={100} valueLabel={valueLabel} />;
  }
  // A weekly reach total reads against its ideal, with the minimum marked.
  if (progress.target.direction !== "reach") return undefined;
  const unit = unitLabel(row.measure);
  const marks: ProgressMark[] = [
    {
      at: Number(progress.target.minimum),
      label: `mín. ${formatDecimal(progress.target.minimum)}`,
    },
    {
      at: Number(progress.target.ideal),
      label: `ideal ${formatDecimal(progress.target.ideal)}${unit === null || unit === "" ? "" : ` ${unit}`}`,
    },
  ];
  return (
    <ProgressBar
      value={Number(progress.value ?? "0")}
      max={Number(progress.target.ideal)}
      valueLabel={valueLabel}
      marks={marks}
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
