import { useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { usePauseContext } from "../pause-context.ts";
import { PendingPauseCard } from "../pending/PendingPauseCard.tsx";
import { useMyPauseRequests } from "../queries.ts";
import { RequestPauseSheet } from "../request/RequestPauseSheet.tsx";
import styles from "./CommitmentPauseSection.module.css";

/**
 * The pause entry point on a Commitment's screen (design 24a, 24b). On the viewer's own Commitment
 * it shows the pending request that covers it, or "Pausar este compromiso" with the days left
 * (the sheet opens with this Commitment preselected, PS-1). On anyone else's it shows nothing: the
 * budgets list only the viewer's Commitments.
 */
export function CommitmentPauseSection({ commitmentId }: { readonly commitmentId: string }) {
  const online = useOnline();
  const requests = useMyPauseRequests();
  const { season } = usePauseContext();
  const [open, setOpen] = useState(false);
  const budget = requests.data?.budgets.find((b) => b.commitmentId === commitmentId);
  if (requests.data === undefined || budget === undefined || season === null) return null;

  const pending = requests.data.mine.find(
    (request) =>
      request.status === "pending" &&
      request.commitments.some((c) => c.commitmentId === commitmentId),
  );
  if (pending !== undefined) {
    return <PendingPauseCard request={pending} timeZone={season.timeZone} today={season.today} />;
  }
  const days = budget.remainingDays;
  return (
    <section className={styles.section} aria-label="Pausa">
      <Button variant="secondary" disabled={!online} onClick={() => setOpen(true)}>
        Pausar este compromiso
      </Button>
      <p className={styles.small}>{`Te quedan ${days} ${days === 1 ? "día" : "días"} de pausa`}</p>
      <RequestPauseSheet
        open={open}
        initialCommitmentId={commitmentId}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
