import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { PauseRequestDto } from "../../../ports/wire.ts";
import { dayMonth } from "../../../shared/format.ts";
import { memberName } from "../../../shared/member-name.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { autoApproveText, commitmentList, periodText, reasonLabel } from "../pause-format.ts";
import { CancelPauseSheet } from "./CancelPauseSheet.tsx";
import styles from "./PendingPauseCard.module.css";

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function responseText(response: PauseRequestDto["approvers"][number]["response"]): string {
  return response === "approve"
    ? "aprobó"
    : response === "reject"
      ? "rechazó"
      : "aún sin responder";
}

/**
 * Screen 27: the requester's view of a request nobody has settled yet. The Commitments it covers
 * are on hold; it approves itself at the stated time unless someone rejects it. "Todos" is ONE
 * item, so one cancel covers the whole group (PS-7).
 */
export function PendingPauseCard({
  request,
  timeZone,
  today,
}: {
  readonly request: PauseRequestDto;
  /** The season's zone: the promised time is read there, not on the device (PS-6). */
  readonly timeZone: string;
  /** The viewer's today in that zone. */
  readonly today: string;
}) {
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);
  const names = commitmentList(request.commitments.map((c) => c.habitName));

  return (
    <>
      <Card as="section" aria-label="Pausa en espera">
        <div className={styles.card}>
          <Badge tone="pending" icon="circle-pause">
            En espera
          </Badge>
          <h3 className={styles.title}>Pausa en espera</h3>
          <p className={styles.summary}>{`${names} · ${reasonLabel(request.reason)}`}</p>
          <p className={styles.small}>
            {capitalized(periodText(request.startDate, request.endDate, today))}
          </p>
          <p className={styles.small}>
            {`Se aprobará automáticamente el ${autoApproveText(request.autoApproveAt, timeZone)}.`}
          </p>
          <p className={styles.small}>
            Mientras tanto, esos días quedan en espera: no suman ni restan.
          </p>
          <p className={styles.small}>
            {`Si se aprueba, se pausan desde ${request.startDate === today ? "hoy" : `el ${dayMonth(request.startDate)}`}.`}
          </p>
          <p className={styles.small}>
            Si la rechazan, cuentan con normalidad y podrás registrarlas hasta el final del día
            siguiente al rechazo.
          </p>
          {request.approvers.length > 0 && (
            <ul className={styles.approvers}>
              {request.approvers.map((approver) => (
                <li key={approver.memberId}>
                  {`${memberName(approver.displayName)}: ${responseText(approver.response)}`}
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" disabled={!online} onClick={() => setConfirming(true)}>
            Cancelar solicitud
          </Button>
        </div>
      </Card>
      <CancelPauseSheet
        pauseRequestId={request.id}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
