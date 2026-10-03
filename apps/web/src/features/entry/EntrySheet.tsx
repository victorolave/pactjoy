import type { MeasureView, TodayRow } from "@pactjoy/app";
import { type ReactNode, useState } from "react";
import { useOnline } from "../../app/connectivity-context.tsx";
import { toScaled } from "../../shared/decimal.ts";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { ProgressBar } from "../../ui/ProgressBar.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { loggedBefore } from "../today/logged-totals.ts";
import { formatDecimal, quantityText, targetText, unitLabel } from "../today/row-labels.ts";
import { useTodayDates } from "../today/today-date-context.tsx";
import { Confirmation, useAutoClose } from "./Confirmation.tsx";
import styles from "./entry.module.css";
import {
  initialValue,
  type LimitQuantity,
  limitMeasureOf,
  limitUsesGrid,
  nudge,
  presetsFor,
  quantityMeasureOf,
  type ReachQuantity,
  toSubmitValue,
} from "./entry-form.ts";
import { LimitGrid } from "./LimitGrid.tsx";
import { NoteField } from "./NoteField.tsx";
import { QuantityStepper } from "./QuantityStepper.tsx";
import { useEarnedGain } from "./use-earned-gain.ts";
import { useQuantityEntry } from "./use-quantity-entry.ts";
import { useSavedToast } from "./use-saved-toast.ts";

export interface EntrySheetProps {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly onClose: () => void;
}

const MINIMUM_MET = "Mínimo cumplido. Un paso más en tu meta.";

/** The record sheet: a stepper for a reach quantity, a grid for a limit. Done rows never open one. */
export function EntrySheet({ row, seasonId, onClose }: EntrySheetProps) {
  const reach = quantityMeasureOf(row.measure);
  if (reach !== null)
    return <ReachSheet row={row} seasonId={seasonId} measure={reach} onClose={onClose} />;
  const limit = limitMeasureOf(row.measure);
  if (limit !== null)
    return <LimitSheet row={row} seasonId={seasonId} measure={limit} onClose={onClose} />;
  return null;
}

interface ShellProps {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly measure: MeasureView;
  readonly subtitle: string;
  readonly hint?: string;
  /** The decimal string to send, or null while the input cannot be sent. */
  readonly toSend: string | null;
  readonly input: ReactNode;
  readonly card?: ReactNode;
  /** The line under the points on the confirmation, when there is one to say. */
  readonly confirmMessage?: string | null;
  readonly missedAllowed: boolean;
  readonly onClose: () => void;
}

/** Everything the two record sheets share: note, submit, confirmation, errors, Hoy no salió. */
function RecordShell({
  row,
  seasonId,
  measure,
  subtitle,
  hint,
  toSend,
  input,
  card,
  confirmMessage = null,
  missedAllowed,
  onClose,
}: ShellProps) {
  const [note, setNote] = useState("");
  const entry = useQuantityEntry(row.commitmentId, seasonId);
  const online = useOnline();
  const showSaved = useSavedToast();
  const gain = useEarnedGain(row.points.earned);

  // Closing after a save leaves the toast with Deshacer behind (design 20): the sheet is gone by then.
  const finish = () => {
    if (entry.saved !== null && entry.entryId !== null) {
      showSaved(
        gain === null
          ? `Registro guardado. ${entry.saved}`
          : `Registro guardado. ${row.habitName} · +${gain} pts`,
        entry.entryId,
      );
    }
    onClose();
  };
  useAutoClose(entry.saved, finish);

  if (entry.saved !== null) {
    return (
      <Sheet open headless title={row.habitName} onClose={finish}>
        <Confirmation
          detail={entry.saved}
          points={gain}
          message={confirmMessage}
          onClose={finish}
        />
      </Sheet>
    );
  }

  const noteError = entry.problem?.kind === "noteField" ? entry.problem.message : undefined;
  const amount = toSend === null ? null : quantityText(toSend, measure);
  return (
    <Sheet open title={row.habitName} onClose={onClose}>
      <div className={styles.sheet}>
        <p className={styles.subtitle}>{subtitle}</p>
        {hint !== undefined && <p className={styles.subtitle}>{hint}</p>}
        {input}
        {card !== undefined && <Card tone="sunken">{card}</Card>}
        <NoteField
          value={note}
          onChange={setNote}
          {...(noteError === undefined ? {} : { error: noteError })}
        />
        {entry.problem !== null && entry.problem.kind !== "noteField" && (
          <InlineMessage tone="error" title={entry.problem.message} />
        )}
        {!online && <InlineMessage tone="pending" title="Sin conexión: no se puede guardar." />}
        <div className={styles.actions}>
          <Button
            block
            disabled={toSend === null || entry.pending || !online}
            onClick={() =>
              toSend !== null &&
              entry.submit(
                { kind: "quantity", value: toSend },
                note.trim() === "" ? null : note,
                `${row.habitName} · ${amount}`,
              )
            }
          >
            {amount === null ? "Registrar" : `Registrar ${amount}`}
          </Button>
          {missedAllowed && row.kind === "day" && (
            <Button
              variant="ghost"
              block
              disabled={entry.pending || !online}
              onClick={() =>
                entry.submit({ kind: "missed" }, null, `${row.habitName} · Hoy no salió`)
              }
            >
              Hoy no salió
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function ReachSheet({
  row,
  seasonId,
  measure,
  onClose,
}: {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly measure: ReachQuantity;
  readonly onClose: () => void;
}) {
  const [value, setValue] = useState(() => initialValue(measure));
  const dates = useTodayDates();
  // Frozen when the sheet opens: after saving, Today refetches and the row already holds the new entry.
  const [startTotal] = useState(() => loggedBefore(row, dates?.refDate));
  const unit = unitLabel(measure) ?? "";
  const weekly = row.kind === "week" && measure.schedule.period === "weeklyTotal";
  const toSend = toSubmitValue(value, measure.precision);
  const minimumMet =
    toSend !== null &&
    startTotal + (toScaled(toSend) ?? 0n) >= (toScaled(measure.target.minimum) ?? 0n);
  return (
    <RecordShell
      row={row}
      seasonId={seasonId}
      measure={measure}
      subtitle={reachSubtitle(row, measure, weekly, unit)}
      toSend={toSend}
      confirmMessage={minimumMet ? MINIMUM_MET : null}
      missedAllowed
      onClose={onClose}
      input={
        <QuantityStepper
          value={value}
          unit={unit}
          presets={presetsFor(measure)}
          invalid={toSend === null}
          onChange={setValue}
          onStep={(direction) => setValue((current) => nudge(current, direction, measure))}
        />
      }
      card={<ProgressCard row={row} measure={measure} value={value} weekly={weekly} unit={unit} />}
    />
  );
}

function LimitSheet({
  row,
  seasonId,
  measure,
  onClose,
}: {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly measure: LimitQuantity;
  readonly onClose: () => void;
}) {
  const grid = limitUsesGrid(measure);
  // A grid choice is a number; a decimal limit types its value instead and starts at zero.
  const [chosen, setChosen] = useState<number | null>(null);
  const [typed, setTyped] = useState("0");
  const unit = unitLabel(measure) ?? "";
  const toSend = grid
    ? chosen === null
      ? null
      : toSubmitValue(String(chosen), "integer")
    : toSubmitValue(typed, measure.precision);
  const weekly = row.kind === "week" && measure.schedule.period === "weeklyTotal";
  const subtitle = weekly
    ? `Esta semana llevas ${quantityText(row.progress?.value ?? "0", measure)}`
    : `Hoy · ${targetText(measure) ?? ""}`;
  return (
    <RecordShell
      row={row}
      seasonId={seasonId}
      measure={measure}
      subtitle={subtitle}
      hint="Registra aunque sea 0."
      toSend={toSend}
      missedAllowed={false}
      onClose={onClose}
      input={
        grid ? (
          <LimitGrid
            unit={unit}
            ideal={Number(measure.target.ideal)}
            tolerance={Number(measure.target.tolerance)}
            value={chosen}
            onSelect={setChosen}
          />
        ) : (
          <QuantityStepper
            value={typed}
            unit={unit}
            presets={[]}
            invalid={toSend === null}
            onChange={setTyped}
            onStep={(direction) => setTyped((current) => nudge(current, direction, measure))}
          />
        )
      }
    />
  );
}

function reachSubtitle(
  row: TodayRow,
  measure: ReachQuantity,
  weekly: boolean,
  unit: string,
): string {
  if (weekly && row.kind === "week") {
    return `Esta semana llevas ${formatDecimal(row.progress?.value ?? "0")} ${unit}`.trim();
  }
  return `Hoy · ${targetText(measure) ?? ""}`;
}

function ProgressCard({
  row,
  measure,
  value,
  weekly,
  unit,
}: {
  readonly row: TodayRow;
  readonly measure: ReachQuantity;
  readonly value: string;
  readonly weekly: boolean;
  readonly unit: string;
}) {
  const ideal = Number(measure.target.ideal);
  const marks = [
    { at: Number(measure.target.minimum), label: `mín. ${formatDecimal(measure.target.minimum)}` },
    { at: ideal, label: `ideal ${formatDecimal(measure.target.ideal)} ${unit}`.trim() },
  ];
  if (weekly && row.kind === "week") {
    const current = row.progress?.value ?? "0";
    return (
      <ProgressBar
        name={`Cantidad de ${row.habitName}`}
        value={Number(current)}
        max={ideal}
        label={`${formatDecimal(current)} / ${formatDecimal(measure.target.ideal)} ${unit}`.trim()}
        valueLabel={`${row.progress?.percent ?? 0} %`}
        marks={marks}
        hint="Durante la semana solo se muestra el progreso."
      />
    );
  }
  const typed = toSubmitValue(value, measure.precision);
  return (
    <ProgressBar
      name={`Cantidad de ${row.habitName}`}
      value={Number(typed ?? 0)}
      max={ideal}
      label={`${typed === null ? "0" : formatDecimal(typed)} / ${formatDecimal(measure.target.ideal)} ${unit}`.trim()}
      marks={marks}
    />
  );
}
