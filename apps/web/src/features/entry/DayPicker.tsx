import type { PendingYesterdayItem, TodayRow } from "@pactjoy/app";
import { type ReactNode, useRef, useState } from "react";
import { weekdayDay } from "../../shared/format.ts";
import { Icon } from "../../ui/icon/Icon.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import styles from "./entry.module.css";

type Day = "hoy" | "ayer";

export interface DayChoice {
  /** Whether the registro is for yesterday. */
  readonly yesterday: boolean;
  /** The date to record for: yesterday's, or `undefined` for the day on display. */
  readonly forDate: string | undefined;
  /** The selector and the note under it, or `null` when there is nothing to choose or say. */
  readonly picker: ReactNode;
}

const lower = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/**
 * Hoy / Ayer in the entry sheet (design 21), while yesterday is still open. A day that is not
 * scheduled today can only be recorded for yesterday, so it has no choice to make, only the note.
 * Starts on Ayer when the sheet was opened from the De ayer card.
 */
export function useDayChoice(
  row: TodayRow,
  pending: PendingYesterdayItem | undefined,
  startOnYesterday: boolean,
): DayChoice {
  const todayAllowed = !(row.kind === "day" && !row.scheduledToday);
  const [day, setDay] = useState<Day>(() =>
    pending !== undefined && (startOnYesterday || !todayAllowed) ? "ayer" : "hoy",
  );
  // The item vanishes from the list after the save's refetch; what was chosen must not flip to Hoy
  // mid-confirmation, so the last one seen stays the one that counts.
  const remembered = useRef(pending);
  if (pending !== undefined) remembered.current = pending;
  const kept = pending ?? remembered.current;
  if (kept === undefined) return { yesterday: false, forDate: undefined, picker: null };
  pending = kept;
  const yesterday = day === "ayer";
  const label = lower(weekdayDay(pending.forDate));
  return {
    yesterday,
    forDate: yesterday ? pending.forDate : undefined,
    picker: (
      <>
        {todayAllowed && (
          <SegmentedControl<Day>
            label="Día del registro"
            value={day}
            onChange={setDay}
            options={[
              { value: "hoy", label: "Hoy" },
              { value: "ayer", label: `Ayer · ${label}` },
            ]}
          />
        )}
        {yesterday && (
          <div className={styles.dayNote}>
            <Icon name="history" />
            <p>
              {`Se guardará para el ${label} y aparecerá como “registrado posteriormente”. Cuenta igual.`}
            </p>
          </div>
        )}
      </>
    ),
  };
}
