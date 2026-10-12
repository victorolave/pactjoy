import type { TodayRow } from "@pactjoy/app";
import { Badge } from "../../../ui/Badge.tsx";
import { RowPauseActions, reasonLabel } from "../../pause/index.ts";
import { RowFrame } from "./RowFrame.tsx";

/**
 * A paused or on-hold row is read-only: no register control. An approved pause says why and offers
 * Reanudar; a request still waiting says "En espera" and offers to look at it or cancel it (screen 29).
 */
export function PausedRow({ row }: { readonly row: TodayRow }) {
  const onHold = row.opportunity.state === "onHold";
  const { pause } = row;
  return (
    <RowFrame
      title={row.habitName}
      commitmentId={row.commitmentId}
      glyph="circle-pause"
      tone="muted"
      badges={
        <Badge tone="pending" icon="circle-pause">
          {onHold
            ? "En espera"
            : pause === null
              ? "En pausa"
              : `En pausa · ${reasonLabel(pause.reason)}`}
        </Badge>
      }
      below={
        pause === null ? undefined : (
          <RowPauseActions
            pause={pause}
            commitmentId={row.commitmentId}
            habitName={row.habitName}
          />
        )
      }
    />
  );
}
