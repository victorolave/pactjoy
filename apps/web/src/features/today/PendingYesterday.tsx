import type { PendingYesterdayItem } from "@pactjoy/app";
import { useOnline } from "../../app/connectivity-context.tsx";
import { weekdayDay } from "../../shared/format.ts";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { useEntrySheet } from "../entry/use-entry-sheet.ts";
import { useOneTap } from "../entry/use-one-tap.ts";
import styles from "./PendingYesterday.module.css";

/** A limit counts its real value, 0 included: it has no "Hoy no salió" (server: MissedNotAllowed). */
const isLimit = (item: PendingYesterdayItem): boolean =>
  item.measure.unit !== "done" && item.measure.target.direction === "limit";

function PendingItem({
  item,
  seasonId,
}: {
  readonly item: PendingYesterdayItem;
  readonly seasonId: string;
}) {
  const oneTap = useOneTap(item.commitmentId, seasonId, item.forDate);
  const sheet = useEntrySheet();
  // No write queue (P1): every write control is off until the network is back.
  const online = useOnline();
  const isDone = item.measure.unit === "done";
  return (
    <div className={styles.item}>
      <div className={styles.entry}>
        <div className={styles.text}>
          <div className={styles.name}>{item.habitName}</div>
          <div className={styles.day}>{weekdayDay(item.forDate)}</div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Registrar ${item.habitName} de ayer`}
          disabled={!online}
          onClick={
            isDone
              ? oneTap.done
              : () => sheet.open(item.commitmentId, undefined, { yesterday: true })
          }
        >
          Registrar
        </Button>
      </div>
      {!isLimit(item) && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Hoy no salió: ${item.habitName} de ayer`}
          disabled={oneTap.pending || !online}
          onClick={oneTap.missed}
        >
          Hoy no salió
        </Button>
      )}
      {oneTap.message !== null && <InlineMessage tone="error" title={oneTap.message} />}
    </div>
  );
}

/** "De ayer" (design 15d): what yesterday left open, registrable until the end of today. */
export function PendingYesterday({
  items,
  seasonId,
}: {
  readonly items: readonly PendingYesterdayItem[];
  readonly seasonId: string;
}) {
  if (items.length === 0) return null;
  return (
    <Card as="section" tone="warm" flush>
      <div className={styles.card}>
        <div className={styles.head}>
          <Icon name="history" />
          <h2 className={styles.title}>De ayer</h2>
        </div>
        <p className={styles.lead}>Puedes registrarlo hasta el final de hoy. Cuenta igual.</p>
        {items.map((item) => (
          <PendingItem key={item.commitmentId} item={item} seasonId={seasonId} />
        ))}
      </div>
    </Card>
  );
}
