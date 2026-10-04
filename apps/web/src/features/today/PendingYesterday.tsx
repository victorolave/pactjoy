import type { PendingYesterdayItem, TodayEntry } from "@pactjoy/app";
import { useOnline } from "../../context/connectivity-context.tsx";
import { weekdayDay } from "../../shared/format.ts";
import { quantityText } from "../../shared/row-labels.ts";
import { Card } from "../../ui/Card.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Icon } from "../../ui/icon/Icon.tsx";
import { CheckCircle, useEntrySheet, useOneTap } from "../entry/index.ts";
import styles from "./PendingYesterday.module.css";
import type { YesterdayRegistered } from "./today-view-model.ts";

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
  // Once the tap went out (or its entry exists) the item can take no second registro, whichever
  // button it came from: both controls rest while it is still listed (as `RowWithControls` does).
  const sent = oneTap.optimisticDone || oneTap.entryId !== null;
  return (
    <div className={styles.entry}>
      <div className={styles.line}>
        <div className={styles.text}>
          <div className={styles.name}>{item.habitName}</div>
          <div className={styles.day}>{weekdayDay(item.forDate)}</div>
        </div>
        <div className={styles.actions}>
          {isDone ? (
            <>
              {/* The same one-tap circle as Today: it fills at once, the server confirms. */}
              <CheckCircle
                label={`Registrar ${item.habitName} de ayer`}
                pressed={sent}
                disabled={!online || sent}
                onClick={oneTap.done}
              />
              <IconButton
                icon="x"
                label={`Ayer no salió: ${item.habitName}`}
                disabled={oneTap.pending || sent || !online}
                onClick={oneTap.missed}
              />
            </>
          ) : (
            <IconButton
              icon="plus"
              variant="outline"
              label={`Registrar ${item.habitName} de ayer`}
              disabled={!online}
              onClick={() => sheet.open(item.commitmentId, undefined, { yesterday: true })}
            />
          )}
        </div>
      </div>
      {oneTap.message !== null && <InlineMessage tone="error" title={oneTap.message} />}
    </div>
  );
}

/** "Registrado", "No salió" or the amount: what yesterday's entry says, without a day (it is in the line). */
function stateOf(registered: YesterdayRegistered): string {
  const { entry, row } = registered;
  switch (entry.value.kind) {
    case "done":
      return "Registrado";
    case "missed":
      return "No salió";
    case "quantity":
      return quantityText(entry.value.value, row.measure);
  }
}

function RegisteredItem({ registered }: { readonly registered: YesterdayRegistered }) {
  const sheet = useEntrySheet();
  const online = useOnline();
  const { row, entry } = registered;
  const edited: TodayEntry = entry;
  return (
    <div className={styles.entry}>
      <div className={styles.line}>
        <div className={styles.text}>
          <div className={styles.name}>{row.habitName}</div>
          <div
            className={styles.day}
          >{`${weekdayDay(edited.forDate)} · ${stateOf(registered)}`}</div>
        </div>
        <IconButton
          icon="pencil"
          label={`Editar registro de ${row.habitName} de ayer`}
          disabled={!online}
          onClick={() => sheet.open(row.commitmentId, entry.entryId)}
        />
      </div>
    </div>
  );
}

/**
 * "De ayer" (design 15d): everything about yesterday while its window is open, per commitment: what
 * is still pending (Registrar, Ayer no salió) and what was registered (its state and a pencil that
 * edits THAT entry). Today's rows show only today's entries.
 */
export function PendingYesterday({
  items,
  registered,
  seasonId,
}: {
  readonly items: readonly PendingYesterdayItem[];
  readonly registered: readonly YesterdayRegistered[];
  readonly seasonId: string;
}) {
  if (items.length === 0 && registered.length === 0) return null;
  return (
    <Card as="section" tone="warm" flush>
      <div className={styles.card}>
        <div className={styles.head}>
          <Icon name="history" />
          <h2 className={styles.title}>De ayer</h2>
        </div>
        <p className={styles.lead}>
          {items.length > 0
            ? "Puedes registrarlo hasta el final de hoy. Cuenta igual."
            : "Puedes cambiarlo hasta el final de hoy."}
        </p>
        {items.map((item) => (
          <PendingItem key={item.commitmentId} item={item} seasonId={seasonId} />
        ))}
        {registered.map((entry) => (
          <RegisteredItem key={entry.entry.entryId} registered={entry} />
        ))}
      </div>
    </Card>
  );
}
