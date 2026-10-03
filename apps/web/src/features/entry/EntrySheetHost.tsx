import type { TodayRow } from "@pactjoy/app";
import { EditSheet } from "./EditSheet.tsx";
import { EntrySheet } from "./EntrySheet.tsx";
import { useEntrySheet } from "./use-entry-sheet.ts";

/** Renders the sheet the URL asks for, if that commitment is in Today: edit an entry, or add one. */
export function EntrySheetHost({
  rows,
  seasonId,
}: {
  readonly rows: readonly TodayRow[];
  readonly seasonId: string;
}) {
  const { commitmentId, entryId, select, close } = useEntrySheet();
  const row = rows.find((candidate) => candidate.commitmentId === commitmentId);
  if (row === undefined) return null;
  const entry = row.entries.find((candidate) => candidate.entryId === entryId);
  if (entry !== undefined) {
    return <EditSheet row={row} entry={entry} onSelect={select} onClose={close} />;
  }
  return <EntrySheet key={row.commitmentId} row={row} seasonId={seasonId} onClose={close} />;
}
