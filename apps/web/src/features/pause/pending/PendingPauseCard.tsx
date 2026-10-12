import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { PauseRequestDto } from "../../../ports/wire.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { autoApproveText, commitmentList, periodText, reasonLabel } from "../pause-format.ts";
import { pauseFailure } from "../pause-messages.ts";
import { useCancelPauseRequest } from "../queries.ts";
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
  const cancel = useCancelPauseRequest();
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const names = commitmentList(request.commitments.map((c) => c.habitName));

  const confirm = async () => {
    if (cancel.isPending) return;
    setFailure(null);
    try {
      await cancel.mutateAsync(request.id);
      setConfirming(false);
    } catch (error) {
      setFailure(pauseFailure(error).message);
    }
  };

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
            Mientras tanto, esos días quedan en espera: no suman ni restan. Si alguien la rechaza,
            vuelven a contar con normalidad.
          </p>
          {request.approvers.length > 0 && (
            <ul className={styles.approvers}>
              {request.approvers.map((approver) => (
                <li key={approver.memberId}>
                  {`${approver.displayName}: ${responseText(approver.response)}`}
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" disabled={!online} onClick={() => setConfirming(true)}>
            Cancelar solicitud
          </Button>
        </div>
      </Card>
      <Sheet
        open={confirming}
        placement="center"
        title="¿Cancelar la solicitud?"
        onClose={cancel.isPending ? () => {} : () => setConfirming(false)}
        actions={
          <>
            <Button block disabled={cancel.isPending || !online} onClick={confirm}>
              Sí, cancelar
            </Button>
            <Button
              variant="ghost"
              block
              disabled={cancel.isPending}
              onClick={() => setConfirming(false)}
            >
              Mantener solicitud
            </Button>
          </>
        }
      >
        <p>
          Esos días vuelven a contar y tendrás hasta el final de mañana para registrar lo que quedó
          en espera.
        </p>
        {failure !== null && <InlineMessage tone="error" title={failure} />}
      </Sheet>
    </>
  );
}
