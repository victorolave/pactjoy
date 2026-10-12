import type { TodayRow } from "@pactjoy/app";
import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { usePauseContext } from "../pause-context.ts";
import { CancelPauseSheet } from "../pending/CancelPauseSheet.tsx";
import { PendingPauseCard } from "../pending/PendingPauseCard.tsx";
import { useMyPauseRequests } from "../queries.ts";
import { ResumeSheet } from "../resume/ResumeSheet.tsx";
import styles from "./RowPauseActions.module.css";

export interface RowPauseActionsProps {
  /** The pause the row belongs to (`TodayRow.pause`, never `null` here). */
  readonly pause: NonNullable<TodayRow["pause"]>;
  readonly commitmentId: string;
  readonly habitName: string;
}

/**
 * What the member can do about a Today row's pause (screen 29, PS-11): Reanudar an approved one
 * (labelled as a cancel when it has not started yet, PS-12), or look at / cancel a pending one.
 * Writes need a connection (no write queue).
 */
export function RowPauseActions({ pause, commitmentId, habitName }: RowPauseActionsProps) {
  const online = useOnline();
  const requests = useMyPauseRequests();
  const { season } = usePauseContext();
  const [dialog, setDialog] = useState<"resume" | "view" | "cancel" | null>(null);
  const close = () => setDialog(null);

  const request = requests.data?.mine.find((r) => r.id === pause.pauseRequestId);
  // `TodayPause` carries no start, so the request itself says whether the pause is still ahead.
  const startsLater = request !== undefined && season !== null && request.startDate > season.today;

  if (!pause.canResume && !pause.canCancel) return null;
  return (
    <div className={styles.actions}>
      {pause.canResume && (
        <Button
          size="sm"
          variant="secondary"
          disabled={!online}
          onClick={() => setDialog("resume")}
        >
          {startsLater ? "Cancelar pausa" : "Reanudar"}
        </Button>
      )}
      {pause.canCancel && (
        <>
          {request !== undefined && season !== null && (
            <Button size="sm" variant="secondary" onClick={() => setDialog("view")}>
              Ver solicitud
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => setDialog("cancel")}>
            Cancelar solicitud
          </Button>
        </>
      )}
      <ResumeSheet
        open={dialog === "resume"}
        onClose={close}
        pauseRequestId={pause.pauseRequestId}
        commitmentId={commitmentId}
        subject={habitName}
        startsLater={startsLater}
      />
      <CancelPauseSheet
        pauseRequestId={pause.pauseRequestId}
        open={dialog === "cancel"}
        onClose={close}
      />
      <Sheet open={dialog === "view"} title="Tu solicitud de pausa" onClose={close}>
        {request !== undefined && season !== null && (
          <PendingPauseCard request={request} timeZone={season.timeZone} today={season.today} />
        )}
      </Sheet>
    </div>
  );
}
