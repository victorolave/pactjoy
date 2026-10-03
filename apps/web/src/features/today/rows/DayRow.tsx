import type { ReactNode } from "react";
import { Tag } from "../../../ui/Tag.tsx";
import { entryText, scheduleText, targetText } from "../row-labels.ts";
import type { DayTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";

export function DayRow({
  row,
  action,
  below,
}: {
  readonly row: DayTodayRow;
  readonly action?: ReactNode;
  readonly below?: ReactNode;
}) {
  const { state } = row.opportunity;
  const logged = state === "logged" && row.entries.length > 0;
  const detail = !row.scheduledToday
    ? "No toca hoy"
    : state === "closed"
      ? "Cerrado"
      : (targetText(row.measure) ?? scheduleText(row.measure));
  return (
    <RowFrame
      title={row.habitName}
      glyph={logged ? "check" : "repeat"}
      tone={logged ? "done" : "default"}
      statuses={logged ? row.entries.map((entry) => entryText(entry, row.measure)) : []}
      details={logged ? [] : [detail]}
      badges={row.privacy === "private" ? <Tag>Privado</Tag> : undefined}
      action={action}
      below={below}
    />
  );
}
