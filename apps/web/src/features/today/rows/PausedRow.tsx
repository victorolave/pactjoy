import type { TodayRow } from "@pactjoy/app";
import { Badge } from "../../../ui/Badge.tsx";
import { RowFrame } from "./RowFrame.tsx";

/** A paused or on-hold row is read-only: no register control, no Reanudar (A2 is out of scope). */
export function PausedRow({ row }: { readonly row: TodayRow }) {
  return (
    <RowFrame
      title={row.habitName}
      commitmentId={row.commitmentId}
      glyph="circle-pause"
      tone="muted"
      badges={
        <Badge tone="pending" icon="circle-pause">
          {row.opportunity.state === "onHold" ? "En espera" : "En pausa"}
        </Badge>
      }
    />
  );
}
