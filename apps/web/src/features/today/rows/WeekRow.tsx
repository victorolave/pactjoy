import type { ReactNode } from "react";
import { fromScaled } from "../../../shared/decimal.ts";
import { loggedToday } from "../../../shared/logged-totals.ts";
import {
  formatDecimal,
  quantityText,
  reachMarks,
  scheduleText,
  targetText,
  unitLabel,
} from "../../../shared/row-labels.ts";
import { useTodayDates } from "../../../shared/today-date-context.tsx";
import { ProgressBar } from "../../../ui/ProgressBar.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import type { WeekTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";
import { SessionBar } from "./SessionBar.tsx";

type Progress = NonNullable<WeekTodayRow["progress"]>;

function detailOf(row: WeekTodayRow, progress: Progress, today: string | undefined): string {
  const { measure } = row;
  if (measure.schedule.period === "perSession") {
    const week = `${progress.sessionsDone} de ${progress.sessionsTarget} esta semana`;
    const logged = loggedToday(row, today);
    // Design 22: "2 de 5 esta semana · llevas 25 min hoy".
    return logged > 0n ? `${week} · llevas ${quantityText(fromScaled(logged), measure)} hoy` : week;
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
  const dates = useTodayDates();
  const closed = row.opportunity.state === "closed";
  return (
    <RowFrame
      title={row.habitName}
      commitmentId={row.commitmentId}
      glyph="repeat"
      details={[
        progress === null ? scheduleText(row.measure) : detailOf(row, progress, dates?.refDate),
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
