import { useState } from "react";
import { useClock } from "../../../context/clock-context.tsx";
import { useOnline } from "../../../context/connectivity-context.tsx";
import type { PauseDecision } from "../../../ports/pactjoy-api.ts";
import type { PauseApprovalDto } from "../../../ports/wire.ts";
import { memberName } from "../../../shared/member-name.ts";
import { Button } from "../../../ui/Button.tsx";
import { Card } from "../../../ui/Card.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { usePauseContext } from "../pause-context.ts";
import { commitmentList, periodText, reasonLabel, remainingApprovalText } from "../pause-format.ts";
import { pauseFailure } from "../pause-messages.ts";
import { useMyPauseRequests, useRespondToPause } from "../queries.ts";
import styles from "./PauseApprovalList.module.css";

/** A private Commitment reaches an approver without its name, so it is only ever "un objetivo privado". */
function targetsText(commitments: PauseApprovalDto["commitments"]): string {
  const visible = commitments.flatMap((c) => (c.kind === "visible" ? [c.habitName] : []));
  const hidden = commitments.length - visible.length;
  const parts = [...visible];
  if (hidden === 1) parts.push("un objetivo privado");
  if (hidden > 1) parts.push(`${hidden} objetivos privados`);
  return commitmentList(parts);
}

function ApprovalCard({
  item,
  today,
}: {
  readonly item: PauseApprovalDto;
  readonly today: string;
}) {
  const clock = useClock();
  const online = useOnline();
  const respond = useRespondToPause();
  const [failure, setFailure] = useState<string | null>(null);
  const title = `${memberName(item.requester.displayName)} pidió pausar ${targetsText(item.commitments)}`;

  const answer = async (decision: PauseDecision) => {
    if (respond.isPending) return;
    setFailure(null);
    try {
      await respond.mutateAsync({ id: item.id, decision });
    } catch (error) {
      setFailure(pauseFailure(error).message);
    }
  };
  const busy = respond.isPending || !online;

  return (
    <Card as="article" aria-label={title}>
      <div className={styles.card}>
        <p className={styles.title}>{title}</p>
        <p className={styles.small}>
          {`${reasonLabel(item.reason)} · ${periodText(item.startDate, item.endDate, today, "hasta que la reanude")}`}
        </p>
        {item.note !== null && <p className={styles.note}>{`“${item.note}”`}</p>}
        <div className={styles.answers}>
          <Button
            variant={item.myResponse === "reject" ? "primary" : "secondary"}
            aria-pressed={item.myResponse === "reject"}
            disabled={busy}
            onClick={() => answer("reject")}
          >
            Rechazar
          </Button>
          <Button
            variant={item.myResponse === "approve" ? "primary" : "secondary"}
            aria-pressed={item.myResponse === "approve"}
            disabled={busy}
            onClick={() => answer("approve")}
          >
            Aprobar
          </Button>
        </div>
        {item.myResponse === null ? (
          <p className={styles.small}>
            {`Se aprobará automáticamente ${remainingApprovalText(item.autoApproveAt, clock.nowMs())} si no respondes.`}
          </p>
        ) : (
          <>
            <p className={styles.answer}>
              {item.myResponse === "approve" ? "Aprobaste" : "Rechazaste"}
            </p>
            <p className={styles.small}>Puedes cambiar tu respuesta mientras siga pendiente.</p>
          </>
        )}
        {failure !== null && <InlineMessage tone="error" title={failure} />}
      </div>
    </Card>
  );
}

/**
 * Screen 28: pause requests waiting for the viewer's answer, in the Círculo tab (PS-8..PS-10).
 * It shows nothing while loading or when nobody waits, and there is NO activity feed here (Q8).
 */
export function PauseApprovalList() {
  const query = useMyPauseRequests();
  const { season } = usePauseContext();
  if (query.isError && query.data === undefined) {
    return (
      <InlineMessage
        tone="error"
        title="No pudimos cargar las solicitudes de pausa."
        action={
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }
  const items = query.data?.awaitingMe ?? [];
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Pausas por aprobar">
      <h2 className={styles.heading}>Pausas por aprobar</h2>
      {items.map((item) => (
        <ApprovalCard key={item.id} item={item} today={season?.today ?? ""} />
      ))}
    </section>
  );
}
