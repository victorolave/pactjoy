import type { TodayEntry, TodayRow } from "@pactjoy/app";
import { type ReactNode, useEffect, useState } from "react";
import { useOnline } from "../../../context/connectivity-context.tsx";
import { useToasts } from "../../../context/toast-context.tsx";
import { addDays } from "../../../shared/date.ts";
import { longDate, weekdayName } from "../../../shared/format.ts";
import { entryText, quantityText, targetPhrase, unitLabel } from "../../../shared/row-labels.ts";
import { useTodayDates } from "../../../shared/today-date-context.tsx";
import { Button } from "../../../ui/Button.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Sheet } from "../../../ui/Sheet.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import styles from "../entry.module.css";
import { OFFLINE_SAVE_LINE, QUEUED_SAVED } from "../entry-messages.ts";
import { Confirmation } from "../feedback/Confirmation.tsx";
import { useEarnedGain } from "../feedback/use-earned-gain.ts";
import { LimitGrid } from "../limit/LimitGrid.tsx";
import { PhotoField } from "../photo/PhotoField.tsx";
import { visibilityHint } from "../photo/photo-hint.ts";
import { isPhotoBusy, photoIdToSend } from "../photo/photo-upload.ts";
import { usePhotoUpload } from "../photo/use-photo-upload.ts";
import { QuantityStepper } from "../quantity/QuantityStepper.tsx";
import {
  limitMeasureOf,
  limitUsesGrid,
  nudge,
  quantityMeasureOf,
  toSubmitValue,
} from "../sheet/entry-form.ts";
import { NoteField } from "../sheet/NoteField.tsx";
import { useEntryDelete } from "./use-entry-delete.ts";
import { useEntryEdit } from "./use-entry-edit.ts";

export interface EditSheetProps {
  readonly row: TodayRow;
  readonly entry: TodayEntry;
  readonly seasonId: string;
  readonly onSelect: (entryId: string) => void;
  readonly onClose: () => void;
}

/**
 * Edits one of the viewer's entries. Every entry on the row is listed; the chosen one is edited.
 * The sheet stays mounted when another entry is chosen, only the form under it starts over.
 */
export function EditSheet(props: EditSheetProps) {
  // The confirmation after a save has no header, only the grabber (design 20).
  const [confirming, setConfirming] = useState(false);
  return (
    <Sheet open headless={confirming} title={props.row.habitName} onClose={props.onClose}>
      <EntryEditor key={props.entry.entryId} {...props} onConfirming={setConfirming} />
    </Sheet>
  );
}

function EntryEditor({
  row,
  entry,
  seasonId,
  onSelect,
  onClose,
  onConfirming,
}: EditSheetProps & { readonly onConfirming: (confirming: boolean) => void }) {
  // What a queued change tells the member if the server rejects it later.
  const context = { habitName: row.habitName, forDate: entry.forDate };
  const edit = useEntryEdit(entry.entryId, context);
  const photo = usePhotoUpload(seasonId, row.commitmentId);
  // The entry's current photo until the member removes it or picks another.
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const currentPhoto = entry.photo !== null && !removedPhoto ? entry.photo : null;
  const remove = useEntryDelete(entry.entryId, context);
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

  const toasts = useToasts();
  const gain = useEarnedGain(row.points.earned);
  const dates = useTodayDates();
  // A day-bound entry of another day (yesterday's) ends at its own day's grace, not the row's.
  const dayBound = row.kind === "day";
  const changeUntil =
    dayBound && dates !== undefined && entry.forDate !== dates.refDate
      ? addDays(entry.forDate, 1)
      : row.opportunity.graceUntil;

  // A change kept on the phone has no points to celebrate: it closes with a toast instead.
  const confirmed = edit.saved !== null && !edit.queued;
  useEffect(() => onConfirming(confirmed), [confirmed, onConfirming]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the change is queued
  useEffect(() => {
    if (edit.saved === null || !edit.queued) return;
    toasts.show({ message: QUEUED_SAVED });
    onClose();
  }, [edit.saved, edit.queued]);
  // The server turned the new photo down (expired, never arrived): the field offers to upload again.
  const rejected = edit.problem?.kind === "photo";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reject` is stable, the problem is the trigger
  useEffect(() => {
    if (rejected) photo.reject();
  }, [rejected, edit.problem]);
  // A delete closes the sheet (its hook says so in a toast): the entry is gone, nothing to edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the deletion lands
  useEffect(() => {
    if (remove.deleted === null) return;
    onClose();
  }, [remove.deleted]);
  if (edit.saved !== null) {
    return edit.queued ? null : (
      <Confirmation detail={edit.saved} points={gain} onClose={onClose} />
    );
  }
  if (remove.deleted !== null) return null;

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
    // A missed entry carries no photo: it leaves the field out (an edit to missed releases it).
    const photoId =
      entry.value.kind === "missed" ? undefined : photoIdToSend(photo.state, removedPhoto);
    edit.save(
      value,
      note.trim() === "" ? null : note,
      `${row.habitName} · ${amount ?? entryText(entry, row.measure)}`,
      photoId,
    );
  };

  return (
    <div className={styles.sheet}>
      <p className={styles.subtitle}>
        {longDate(entry.forDate)} · {entryText(entry, row.measure, dates?.refDate)}
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
        <p
          className={styles.subtitle}
        >{`${scopeOf(row, entry, dates?.today)} · ${targetPhrase(measure)}`}</p>
      )}
      <NoteField
        value={note}
        onChange={setNote}
        hint={visibilityHint(row.privacy)}
        startOpen={entry.photo !== null}
        onClear={() => {
          photo.remove();
          setRemovedPhoto(entry.photo !== null);
        }}
        photo={
          <PhotoField
            state={photo.state}
            existing={currentPhoto}
            online={online}
            missed={entry.value.kind === "missed"}
            onPick={(file) => {
              photo.pick(file);
            }}
            onRetry={photo.retry}
            onRemove={() => {
              if (photo.state.status === "idle") setRemovedPhoto(true);
              else photo.remove();
            }}
          />
        }
        {...(noteError === undefined ? {} : { error: noteError })}
      />
      {changeUntil !== null && (
        <InlineMessage
          tone="info"
          title={`Puedes cambiarlo hasta el ${longDate(changeUntil, false)}.`}
        >
          Después del periodo de gracia, el registro queda bloqueado.
        </InlineMessage>
      )}
      {edit.problem !== null &&
        edit.problem.kind !== "noteField" &&
        edit.problem.kind !== "photo" && (
          <InlineMessage tone="error" title={edit.problem.message} />
        )}
      {!online && <InlineMessage tone="pending" title={OFFLINE_SAVE_LINE} />}
      {remove.problem !== null && <InlineMessage tone="error" title={remove.problem.message} />}
      {confirmingDelete ? (
        <div className={styles.actions}>
          <p className={styles.confirmationTitle}>¿Borrar este registro?</p>
          <Button
            block
            disabled={remove.pending}
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
          <Button
            block
            disabled={toSend === null || edit.pending || isPhotoBusy(photo.state)}
            onClick={send}
          >
            {amount === null ? "Guardar cambios" : `Guardar ${amount}`}
          </Button>
          <Button
            variant="ghost"
            block
            leadingIcon="trash-2"
            onClick={() => setConfirmingDelete(true)}
          >
            Borrar registro
          </Button>
        </div>
      )}
    </div>
  );
}

/** What the thresholds under the form apply to: a weekly total's week, today, or another day. */
function scopeOf(row: TodayRow, entry: TodayEntry, today: string | undefined): string {
  if (row.measure.schedule.period === "weeklyTotal") return "Esta semana";
  if (today === undefined || entry.forDate === today) return "Hoy";
  const day = weekdayName(entry.forDate) ?? "ese día";
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
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
