import type { TodayView } from "@pactjoy/app";
import type { OutboxItem, SentRecord } from "../../../ports/outbox-store.ts";
import { addDays } from "../../../shared/date.ts";
import { isLocalRef, localRef } from "./queue.ts";

type Running = Extract<TodayView, { state: "active" | "ended" }>;
type Row = Running["rows"][number];
type Entry = Row["entries"][number];

/** What is waiting on the phone for a row or an entry. */
export type PendingKind = "record" | "edit" | "delete";

export interface PendingMarks {
  /** By commitment id: the most notable change queued for that row (record, then edit, then delete). */
  readonly rows: ReadonlyMap<string, PendingKind>;
  /** By entry id: local records (`local:<id>`) and server entries with a queued edit. */
  readonly entries: ReadonlyMap<string, PendingKind>;
  /** How many items are queued (the footnote and the syncing line are about the whole queue). */
  readonly count: number;
}

/** Design 15g copy, plus the edit and delete variants (listed for owner approval). */
export const PENDING_BADGE = "Pendiente de sincronizar";
export const PENDING_FOOTNOTE = "Puntos y clasificación se actualizan al sincronizar.";
const PENDING_LINE: Record<PendingKind, string> = {
  record: "Registrado en este teléfono",
  edit: "Cambio guardado en este teléfono",
  delete: "Borrado en este teléfono",
};
export const pendingLine = (kind: PendingKind): string => PENDING_LINE[kind];

export const NO_MARKS: PendingMarks = { rows: new Map(), entries: new Map(), count: 0 };

const RANK: Record<PendingKind, number> = { record: 3, edit: 2, delete: 1 };

/**
 * Lays the queued items over the server's Today (design 15g, OE-R7). Rows show what the member did on
 * the phone: a queued record adds a local entry, an edit changes the value shown, a delete hides the
 * entry. Nothing else moves: the row state, earned points, week progress, summary and standings stay
 * the server's, because only the server scores (no optimistic scoring). Pure; an empty queue returns
 * the very same view.
 */
export function overlayToday(
  view: TodayView,
  items: readonly OutboxItem[],
  sent: readonly SentRecord[] = [],
): { readonly view: TodayView; readonly marks: PendingMarks } {
  if (view.state !== "active" && view.state !== "ended") {
    return items.length === 0
      ? { view, marks: NO_MARKS }
      : { view, marks: { ...NO_MARKS, count: items.length } };
  }
  // Sent, but the Today on screen was fetched before: it still has to show them, or the row looks
  // open and a second tap would record the same day again.
  const awaiting = sent.filter(
    (record) =>
      !view.rows.some((row) => row.entries.some((entry) => entry.entryId === record.entryId)),
  );
  if (items.length === 0 && awaiting.length === 0) return { view, marks: NO_MARKS };
  let rows: readonly Row[] = view.rows;
  let pendingYesterday = view.pendingYesterday;
  const rowMarks = new Map<string, PendingKind>();
  const entryMarks = new Map<string, PendingKind>();
  const deletedFrom = new Set<string>();
  // A row's mark follows what is left on it: its pending records and edits, else a deletion.
  const markRow = (commitmentId: string): void => {
    let best: PendingKind | undefined;
    for (const entry of rows.find((row) => row.commitmentId === commitmentId)?.entries ?? []) {
      const kind = entryMarks.get(entry.entryId);
      if (kind !== undefined && (best === undefined || RANK[kind] > RANK[best])) best = kind;
    }
    if (best === undefined && deletedFrom.has(commitmentId)) best = "delete";
    if (best === undefined) rowMarks.delete(commitmentId);
    else rowMarks.set(commitmentId, best);
  };
  const yesterday = addDays(view.today, -1);
  const change = (match: (row: Row) => boolean, edit: (row: Row) => Row): void => {
    rows = rows.map((row) => (match(row) ? edit(row) : row));
  };
  const holds = (entryId: string) => (row: Row) =>
    row.entries.some((entry) => entry.entryId === entryId);

  const addRecord = (record: Pick<SentRecord, "command">, entryId: string): void => {
    const { command } = record;
    if (command.seasonId !== view.season.id) return;
    if (!rows.some((row) => row.commitmentId === command.commitmentId)) return;
    const entry: Entry = {
      entryId: entryId as Entry["entryId"],
      forDate: command.forDate as Entry["forDate"],
      value: command.value,
      note: command.note,
      photo: null,
    };
    change(
      (row) => row.commitmentId === command.commitmentId,
      (row) => ({ ...row, entries: [...row.entries, entry] }),
    );
    entryMarks.set(entry.entryId, "record");
    markRow(command.commitmentId);
    // Pending is not "still open": the open item for that day gives way to the queued record.
    if (command.forDate === yesterday && pendingYesterday !== undefined) {
      pendingYesterday = pendingYesterday.filter(
        (open) => open.commitmentId !== command.commitmentId,
      );
    }
  };

  for (const record of awaiting) addRecord(record, record.entryId);
  for (const item of items) {
    if (item.kind === "record") {
      addRecord(item, localRef(item.localId));
    } else if (item.kind === "edit") {
      const owner = rows.find(holds(item.target));
      if (owner === undefined) continue;
      change(holds(item.target), (row) => ({
        ...row,
        entries: row.entries.map((entry) =>
          entry.entryId === item.target ? { ...entry, value: item.value, note: item.note } : entry,
        ),
      }));
      // A record still on the phone stays a record, whatever was changed in it since.
      if (!isLocalRef(item.target)) {
        entryMarks.set(item.target, "edit");
        markRow(owner.commitmentId);
      }
    } else {
      const owner = rows.find(holds(item.target));
      if (owner === undefined) continue;
      change(holds(item.target), (row) => ({
        ...row,
        entries: row.entries.filter((entry) => entry.entryId !== item.target),
      }));
      entryMarks.delete(item.target);
      deletedFrom.add(owner.commitmentId);
      markRow(owner.commitmentId);
    }
  }
  return {
    view: { ...view, rows, ...(pendingYesterday === undefined ? {} : { pendingYesterday }) },
    marks: { rows: rowMarks, entries: entryMarks, count: items.length + awaiting.length },
  };
}
