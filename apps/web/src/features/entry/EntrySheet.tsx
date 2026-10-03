import type { TodayRow } from "@pactjoy/app";
import { useState } from "react";
import { Card } from "../../ui/Card.tsx";
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
import { QuantityStepper } from "./QuantityStepper.tsx";

export interface EntrySheetProps {
  readonly row: TodayRow;
  readonly onClose: () => void;
}

/** The sheet for a reach quantity (per session or weekly total). Done and limit rows have their own. */
export function EntrySheet({ row, onClose }: EntrySheetProps) {
  const measure = quantityMeasureOf(row.measure);
  // Weekly totals have their own sheet (EN-R4).
  if (measure === null || measure.schedule.period === "weeklyTotal") return null;
  return <QuantitySheet row={row} measure={measure} onClose={onClose} />;
}

function QuantitySheet({
  row,
  measure,
  onClose,
}: {
  readonly row: TodayRow;
  readonly measure: ReachQuantity;
  readonly onClose: () => void;
}) {
  const [value, setValue] = useState(() => initialValue(measure));
  const unit = unitLabel(measure) ?? "";
  const valid = toSubmitValue(value, measure.precision) !== null;

  return (
    <Sheet open title={row.habitName} onClose={onClose}>
      <div className={styles.sheet}>
        <p className={styles.subtitle}>Hoy · {targetText(measure)}</p>
        <QuantityStepper
          value={value}
          unit={unit}
          presets={presetsFor(measure)}
          invalid={!valid}
          onChange={setValue}
          onStep={(direction) => setValue((current) => nudge(current, direction, measure))}
        />
        <Card tone="sunken">
          <ProgressCard measure={measure} value={value} unit={unit} />
        </Card>
      </div>
    </Sheet>
  );
}

function ProgressCard({
  measure,
  value,
  unit,
}: {
  readonly measure: ReachQuantity;
  readonly value: string;
  readonly unit: string;
}) {
  const ideal = Number(measure.target.ideal);
  const marks = [
    { at: Number(measure.target.minimum), label: `mín. ${formatDecimal(measure.target.minimum)}` },
    { at: ideal, label: `ideal ${formatDecimal(measure.target.ideal)} ${unit}`.trim() },
  ];
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
