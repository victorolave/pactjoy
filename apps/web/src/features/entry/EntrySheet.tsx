import type { TodayRow } from "@pactjoy/app";
import { useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Illustration } from "../../ui/Placeholder.tsx";
import { ProgressBar } from "../../ui/ProgressBar.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { formatDecimal, targetText, unitLabel } from "../today/row-labels.ts";
import styles from "./entry.module.css";
import {
  initialValue,
  nudge,
  presetsFor,
  quantityMeasureOf,
  type ReachQuantity,
  toSubmitValue,
} from "./entry-form.ts";
import { NoteField } from "./NoteField.tsx";
import { QuantityStepper } from "./QuantityStepper.tsx";
import { useQuantityEntry } from "./use-quantity-entry.ts";

/** How long the confirmation stays before the sheet closes itself (EN-R6). */
const CONFIRMATION_MS = 1200;

export interface EntrySheetProps {
  readonly row: TodayRow;
  readonly seasonId: string;
  readonly onClose: () => void;
}

/** The sheet for a reach quantity, per session or weekly total. */
export function EntrySheet({ row, seasonId, onClose }: EntrySheetProps) {
  const measure = quantityMeasureOf(row.measure);
  if (measure === null) return null;
  return <QuantitySheet row={row} seasonId={seasonId} measure={measure} onClose={onClose} />;
}

function QuantitySheet({
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
  const [note, setNote] = useState("");
  const entry = useQuantityEntry(row.commitmentId, seasonId);
  const unit = unitLabel(measure) ?? "";
  const weekly = row.kind === "week" && measure.schedule.period === "weeklyTotal";
  const toSend = toSubmitValue(value, measure.precision);
  const label = toSend === null ? "Registrar" : `Registrar ${formatDecimal(toSend)} ${unit}`.trim();

  useEffect(() => {
    if (entry.saved === null) return;
    const timer = setTimeout(onClose, CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [entry.saved, onClose]);

  if (entry.saved !== null) {
    return (
      <Sheet open title={row.habitName} onClose={onClose}>
        <div className={styles.confirmation}>
          <Illustration alt="Registro guardado" />
          <p className={styles.confirmationTitle}>Registro guardado.</p>
          <p className={styles.subtitle}>{entry.saved}</p>
          <Button block onClick={onClose}>
            Seguir con mi día
          </Button>
        </div>
      </Sheet>
    );
  }

  const noteError = entry.problem?.kind === "noteField" ? entry.problem.message : undefined;
  return (
    <Sheet open title={row.habitName} onClose={onClose}>
      <div className={styles.sheet}>
        <p className={styles.subtitle}>{subtitleOf(row, measure, weekly, unit)}</p>
        <QuantityStepper
          value={value}
          unit={unit}
          presets={presetsFor(measure)}
          invalid={toSend === null}
          onChange={setValue}
          onStep={(direction) => setValue((current) => nudge(current, direction, measure))}
        />
        <Card tone="sunken">
          <ProgressCard row={row} measure={measure} value={value} weekly={weekly} unit={unit} />
        </Card>
        <NoteField
          value={note}
          onChange={setNote}
          {...(noteError === undefined ? {} : { error: noteError })}
        />
        {entry.problem !== null && entry.problem.kind !== "noteField" && (
          <InlineMessage tone="error" title={entry.problem.message} />
        )}
        <div className={styles.actions}>
          <Button
            block
            disabled={toSend === null || entry.pending}
            onClick={() =>
              toSend !== null &&
              entry.submit(
                { kind: "quantity", value: toSend },
                note.trim() === "" ? null : note,
                `${row.habitName} · ${formatDecimal(toSend)} ${unit}`.trim(),
              )
            }
          >
            {label}
          </Button>
          {row.kind === "day" && (
            <Button
              variant="ghost"
              block
              disabled={entry.pending}
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

function subtitleOf(row: TodayRow, measure: ReachQuantity, weekly: boolean, unit: string): string {
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
      value={Number(typed ?? 0)}
      max={ideal}
      label={`${typed === null ? "0" : formatDecimal(typed)} / ${formatDecimal(measure.target.ideal)} ${unit}`.trim()}
      marks={marks}
    />
  );
}
