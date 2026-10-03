import type { TodayEntry, TodayRow } from "@pactjoy/app";
import { type ReactNode, useState } from "react";
import { useOnline } from "../../app/connectivity-context.tsx";
import { longDate } from "../../shared/format.ts";
import { Button } from "../../ui/Button.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { Tag } from "../../ui/Tag.tsx";
import { entryText, quantityText, targetText, unitLabel } from "../today/row-labels.ts";
import { Confirmation, useAutoClose } from "./Confirmation.tsx";
import styles from "./entry.module.css";
import {
  limitMeasureOf,
  limitUsesGrid,
  nudge,
  quantityMeasureOf,
  toSubmitValue,
} from "./entry-form.ts";
import { LimitGrid } from "./LimitGrid.tsx";
import { NoteField } from "./NoteField.tsx";
import { QuantityStepper } from "./QuantityStepper.tsx";
import { useEntryDelete } from "./use-entry-delete.ts";
import { useEntryEdit } from "./use-entry-edit.ts";

export interface EditSheetProps {
  readonly row: TodayRow;
  readonly entry: TodayEntry;
  readonly onSelect: (entryId: string) => void;
  readonly onClose: () => void;
}

/**
 * Edits one of the viewer's entries. Every entry on the row is listed; the chosen one is edited.
 * The sheet stays mounted when another entry is chosen, only the form under it starts over.
 */
export function EditSheet(props: EditSheetProps) {
  return (
    <Sheet open title={props.row.habitName} onClose={props.onClose}>
      <EntryEditor key={props.entry.entryId} {...props} />
    </Sheet>
  );
}

function EntryEditor({ row, entry, onSelect, onClose }: EditSheetProps) {
  const edit = useEntryEdit(entry.entryId);
  const remove = useEntryDelete(entry.entryId);
  const online = useOnline();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [note, setNote] = useState(entry.note ?? "");
  const quantity = entry.value.kind === "quantity" ? entry.value.value : null;
  const [typed, setTyped] = useState(quantity ?? "0");
  const [chosen, setChosen] = useState<number | null>(quantity === null ? null : Number(quantity));
  const reach = quantityMeasureOf(row.measure);
  const limit = limitMeasureOf(row.measure);
  const grid = limit !== null && limitUsesGrid(limit);
  const measure = reach ?? limit;

  const finished = edit.saved ?? remove.deleted;
  useAutoClose(finished, onClose);
  if (edit.saved !== null) return <Confirmation detail={edit.saved} onClose={onClose} />;
  if (remove.deleted !== null) {
    return <Confirmation title="Registro borrado." detail={remove.deleted} onClose={onClose} />;
  }

  // What the sheet would send for the value, or null while it cannot be sent.
  const toSend =
    measure === null || quantity === null
      ? entry.value.kind
      : grid
        ? chosen === null
          ? null
          : toSubmitValue(String(chosen), "integer")
        : toSubmitValue(typed, measure.precision);
  const amount =
    measure !== null && quantity !== null && toSend !== null ? quantityText(toSend, measure) : null;
  const unit = measure === null ? "" : (unitLabel(measure) ?? "");
  const noteError = edit.problem?.kind === "noteField" ? edit.problem.message : undefined;

  const send = () => {
    if (toSend === null) return;
    const value =
      quantity === null
        ? ({ kind: entry.value.kind } as { kind: "done" } | { kind: "missed" })
        : { kind: "quantity" as const, value: toSend };
    edit.save(
      value,
      note.trim() === "" ? null : note,
      `${row.habitName} · ${amount ?? entryText(entry, row.measure)}`,
    );
  };

  return (
    <div className={styles.sheet}>
      <p className={styles.subtitle}>
        {longDate(entry.forDate)} · {entryText(entry, row.measure)}
      </p>
      {row.entries.length > 1 && (
        <div className={styles.presets}>
          {row.entries.map((other) => (
            <Tag
              key={other.entryId}
              selected={other.entryId === entry.entryId}
              onClick={() => onSelect(other.entryId)}
            >
              {entryText(other, row.measure)}
            </Tag>
          ))}
        </div>
      )}
      {quantity !== null && measure !== null && (
        <ValueInput
          grid={grid}
          limit={limit}
          unit={unit}
          typed={typed}
          chosen={chosen}
          invalid={toSend === null}
          onTyped={setTyped}
          onChosen={setChosen}
          onStep={(direction) => setTyped((current) => nudge(current, direction, measure))}
        />
      )}
      {measure !== null && quantity !== null && (
        <p className={styles.subtitle}>{`Hoy · ${targetText(measure) ?? ""}`}</p>
      )}
      <NoteField
        value={note}
        onChange={setNote}
        {...(noteError === undefined ? {} : { error: noteError })}
      />
      {row.opportunity.graceUntil !== null && (
        <InlineMessage
          tone="info"
          title={`Puedes cambiarlo hasta el ${longDate(row.opportunity.graceUntil, false)}.`}
        >
          Después del periodo de gracia, el registro queda bloqueado.
        </InlineMessage>
      )}
      {edit.problem !== null && edit.problem.kind !== "noteField" && (
        <InlineMessage tone="error" title={edit.problem.message} />
      )}
      {!online && <InlineMessage tone="pending" title="Sin conexión: no se puede guardar." />}
      {remove.problem !== null && <InlineMessage tone="error" title={remove.problem.message} />}
      {confirmingDelete ? (
        <div className={styles.actions}>
          <p className={styles.confirmationTitle}>¿Borrar este registro?</p>
          <Button
            block
            disabled={remove.pending || !online}
            onClick={() => remove.remove(`${row.habitName} · ${entryText(entry, row.measure)}`)}
          >
            Borrar
          </Button>
          <Button variant="ghost" block onClick={() => setConfirmingDelete(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button block disabled={toSend === null || edit.pending || !online} onClick={send}>
            {amount === null ? "Guardar cambios" : `Guardar ${amount}`}
          </Button>
          <Button
            variant="ghost"
            block
            leadingIcon="trash-2"
            disabled={!online}
            onClick={() => setConfirmingDelete(true)}
          >
            Borrar registro
          </Button>
        </div>
      )}
    </div>
  );
}

function ValueInput({
  grid,
  limit,
  unit,
  typed,
  chosen,
  invalid,
  onTyped,
  onChosen,
  onStep,
}: {
  readonly grid: boolean;
  readonly limit: ReturnType<typeof limitMeasureOf>;
  readonly unit: string;
  readonly typed: string;
  readonly chosen: number | null;
  readonly invalid: boolean;
  readonly onTyped: (value: string) => void;
  readonly onChosen: (value: number) => void;
  readonly onStep: (direction: 1 | -1) => void;
}): ReactNode {
  if (grid && limit !== null) {
    return (
      <LimitGrid
        unit={unit}
        ideal={Number(limit.target.ideal)}
        tolerance={Number(limit.target.tolerance)}
        value={chosen}
        onSelect={onChosen}
      />
    );
  }
  return (
    <QuantityStepper
      value={typed}
      unit={unit}
      presets={[]}
      invalid={invalid}
      onChange={onTyped}
      onStep={onStep}
    />
  );
}
