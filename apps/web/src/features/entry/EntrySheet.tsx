import type { MeasureView, TodayRow } from "@pactjoy/app";
import { type ReactNode, useState } from "react";
import { useOnline } from "../../app/connectivity-context.tsx";
import { fromScaled, toScaled } from "../../shared/decimal.ts";
import { pointsText } from "../../shared/format.ts";
import { Button } from "../../ui/Button.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { loggedBefore } from "../today/logged-totals.ts";
import { quantityText, targetPhrase, unitLabel } from "../today/row-labels.ts";
import { useTodayDates } from "../today/today-date-context.tsx";
import { Confirmation } from "./Confirmation.tsx";
import { DraftCard } from "./DraftCard.tsx";
import { dailyPreview, weeklyPreview } from "./draft-preview.ts";
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

const MINIMUM_MET = "Mínimo cumplido. Un paso más en tu meta.";

export interface EntrySheetProps {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly onClose: () => void;
}

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
  /** "Registrar" for the first entry of the opportunity, "Añadir" when adding to what is logged. */
  readonly verb?: string;
  /** The decimal string to send, or null while the input cannot be sent. */
  readonly toSend: string | null;
  readonly input: ReactNode;
  readonly card?: ReactNode;
  /** A line under the card or the input (the legend of the limit grid, the weekly note). */
  readonly legend?: string | undefined;
  /** The line under the points on the confirmation, when there is one to say. */
  readonly confirmMessage?: string | null;
  readonly onClose: () => void;
}

/** Everything the two record sheets share: note, submit, confirmation and errors. */
function RecordShell({
  row,
  seasonId,
  measure,
  subtitle,
  verb = "Registrar",
  toSend,
  input,
  card,
  legend,
  confirmMessage = null,
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
          : `Registro guardado. ${row.habitName} · ${pointsText(gain)}`,
        entry.entryId,
      );
    }
    onClose();
  };

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
        {input}
        {card}
        {legend !== undefined && <p className={styles.subtitle}>{legend}</p>}
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
            {amount === null ? verb : `${verb} ${amount}`}
          </Button>
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
  const dates = useTodayDates();
  // Frozen when the sheet opens: after saving, Today refetches and the row already holds the new entry.
  const [before] = useState(() => loggedBefore(row, dates?.refDate));
  const weekly = measure.schedule.period === "weeklyTotal";
  // A weekly total always starts from its usual value; a day with entries adds on top of them.
  const adding = !weekly && before > 0n;
  const [value, setValue] = useState(() =>
    adding ? (presetsFor(measure)[0] ?? initialValue(measure)) : initialValue(measure),
  );
  const unit = unitLabel(measure) ?? "";
  const toSend = toSubmitValue(value, measure.precision);
  const draft = toScaled(toSend ?? "0") ?? 0n;
  const thresholds = {
    minimum: toScaled(measure.target.minimum) ?? 0n,
    ideal: toScaled(measure.target.ideal) ?? 0n,
    before,
    draft,
    unit,
  };
  const preview = weekly
    ? weeklyPreview(thresholds)
    : dailyPreview({ ...thresholds, perOpportunity: row.points.perOpportunity });
  const minimumAt =
    thresholds.ideal === 0n ? 0 : Number(thresholds.minimum) / Number(thresholds.ideal);
  const subtitle = weekly
    ? `Esta semana llevas ${quantityText(fromScaled(before), measure)}`
    : adding
      ? `Llevas ${quantityText(fromScaled(before), measure)} hoy`
      : `Hoy · ${targetPhrase(measure)}`;
  return (
    <RecordShell
      row={row}
      seasonId={seasonId}
      measure={measure}
      subtitle={subtitle}
      verb={adding ? "Añadir" : "Registrar"}
      toSend={toSend}
      confirmMessage={preview.reached ? MINIMUM_MET : null}
      legend={
        weekly
          ? "Durante la semana solo se muestra el progreso. Los puntos se asignan al cerrar la semana."
          : undefined
      }
      onClose={onClose}
      input={
        <QuantityStepper
          value={value}
          unit={unit}
          presets={presetsFor(measure)}
          invalid={toSend === null}
          {...(adding ? { prefix: "+" } : {})}
          onChange={setValue}
          onStep={(direction) => setValue((current) => nudge(current, direction, measure))}
        />
      }
      card={
        <DraftCard
          name={`Cantidad de ${row.habitName}`}
          preview={preview}
          minimumAt={minimumAt}
          {...(weekly ? { caption: "Progreso de la semana", twoLayers: true } : {})}
        />
      }
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
    : "Registra lo de hoy, aunque sea 0.";
  const scored = row.points.limitPercents !== null;
  return (
    <RecordShell
      row={row}
      seasonId={seasonId}
      measure={measure}
      subtitle={subtitle}
      toSend={toSend}
      legend={`${targetPhrase(measure)}.${grid && scored ? " Cada opción muestra lo que puntúa antes de elegirla." : ""}`}
      onClose={onClose}
      input={
        grid ? (
          <LimitGrid
            unit={unit}
            ideal={Number(measure.target.ideal)}
            tolerance={Number(measure.target.tolerance)}
            value={chosen}
            percents={row.points.limitPercents}
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
